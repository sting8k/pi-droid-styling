/**
 * Smooth reveal of a streamed assistant answer: the text appears progressively, character by character.
 *
 * The streamed message is rendered in full as usual (markdown parsed once per content change by
 * the presentation buffer + streaming cache). `revealBody` then cuts the rendered rows at a reveal
 * cursor measured in visible characters (graphemes) and fades the newest few characters in from
 * the theme's `dim` color toward their own color. Cutting the finished render, rather than the source text, keeps
 * half-typed markdown (`**bo`, `[a](ht`) from ever flashing as raw syntax.
 *
 * - The cursor advances on a ~30fps ticker that runs only while some message is behind its text.
 *   Pacing is a playout buffer: each time new text arrives the rate is set so the backlog lasts until the
 *   next text is expected (the measured gap between arrivals + 25%, within MIN/MAX_HORIZON_S). Text that
 *   arrives in bursts then shows at a steady pace instead of a sprint followed by a stop.
 * - The fade spans the chars revealed in the last FADE_S, so a fast stream fades in rather than pops.
 * - Only a component that is on the live stream when first rendered reveals, so history, resume and
 *   finished messages render instantly. When its stream ends the remainder finishes within END_BUDGET_MS.
 * - Rows that are not in the fade window are passed through untouched; the cost per frame is one
 *   cached length lookup per row plus a tokenize of the one or two rows at the cursor.
 */
import { parseFgAnsiToRgb } from "../theme/ansi.js";
import { isComponentOnActiveStream } from "./assistant-streaming-state.js";

/** Chars per second when caught up (~11ms per char). */
const BASE_RATE = 90;
/** Until the gap between arrivals is known, a burst drains within this long. */
const FIRST_HORIZON_S = 0.35;
/**
 * The backlog is spread over the expected gap to the next arrival, clamped to this range: the floor keeps
 * the pace from following every chunk-size wobble, the ceiling bounds the delay behind the stream.
 */
const MIN_HORIZON_S = 0.25;
const MAX_HORIZON_S = 0.5;
/** A long pause (a tool call) counts as this much, so one pause does not slow the pace for long. */
const MAX_GAP_S = 1;
/** After the stream ends, whatever is left is shown within this long (spec: <= 300ms incl. tick jitter). */
const END_BUDGET_MS = 250;
/** The chars revealed in the last FADE_S are partially faded, at least MIN_FADE and at most MAX_FADE of them. */
const FADE_S = 0.066;
const MIN_FADE = 6;
const MAX_FADE = 40;
const FRAME_MS = 33;
/** A stalled event loop must not turn into one big jump. */
const MAX_DT_MS = 100;

interface RevealState {
	component: object;
	/** Cursor in units (visible chars + 1 per row); may run `fade` past `total` so the tail settles to full color. */
	revealed: number;
	total: number;
	rate: number;
	/** Width of the fade in units, from `rate`. */
	fade: number;
	lastAt: number;
	endedAt: number;
	/** When text last arrived, and the smoothed gap between arrivals in seconds (unset until two arrivals). */
	arrivedAt: number;
	gapS: number | undefined;
	/** Length cache for the rows of the last render, keyed by row string. */
	counts: Map<string, number>;
}

const states = new WeakMap<object, RevealState>();
const ticking = new Set<RevealState>();
let timer: ReturnType<typeof setTimeout> | undefined;
let requestRender: (() => void) | undefined;
let activeTheme: any = null;

/** The UI theme the fade colors come from (set with the assistant prefix install, so it follows theme switches). */
export function setRevealTheme(theme: unknown): void {
	activeTheme = theme;
}

/** Same requester as the presentation buffer; `undefined` (session shutdown) also stops the ticker. */
export function setRevealRenderRequester(requester: (() => void) | undefined): void {
	requestRender = requester;
	if (!requester) stopTicker();
}

/** Always on; `PI_REDUCED_MOTION=1` falls back to the chunked drip of performance/debounce-update.ts. */
export function isRevealEnabled(): boolean {
	return process.env.PI_REDUCED_MOTION !== "1";
}

/** True while the component's rows are still being revealed (its render must not be cached). */
export function isRevealing(component: unknown): boolean {
	return typeof component === "object" && component !== null && states.has(component);
}

function stopTicker(): void {
	if (timer !== undefined) clearTimeout(timer);
	timer = undefined;
	ticking.clear();
}

const isDone = (s: RevealState): boolean => s.revealed >= s.total + s.fade;

function setRate(s: RevealState, rate: number): void {
	s.rate = Math.max(BASE_RATE, rate);
	s.fade = Math.min(MAX_FADE, Math.max(MIN_FADE, Math.round(s.rate * FADE_S)));
}

/** New text: spread the backlog over the time until the next text is expected. */
function onArrival(s: RevealState, now: number): void {
	if (s.arrivedAt !== 0) {
		const gap = Math.min(now - s.arrivedAt, MAX_GAP_S * 1000) / 1000;
		s.gapS = s.gapS === undefined ? gap : s.gapS + (gap - s.gapS) * 0.3;
	}
	s.arrivedAt = now;
	const horizon = s.gapS === undefined ? FIRST_HORIZON_S : Math.min(MAX_HORIZON_S, Math.max(MIN_HORIZON_S, s.gapS * 1.25));
	setRate(s, (s.total - s.revealed) / horizon);
}

function advance(s: RevealState, now: number): void {
	if (s.endedAt === 0 && !isComponentOnActiveStream(s.component)) s.endedAt = now;
	const dt = Math.min(now - s.lastAt, MAX_DT_MS) / 1000;
	s.lastAt = now;
	if (s.endedAt !== 0 && now - s.endedAt >= END_BUDGET_MS) {
		s.revealed = Number.MAX_SAFE_INTEGER;
		return;
	}
	const backlog = s.total - s.revealed;
	if (s.endedAt !== 0 && backlog > 0) setRate(s, Math.max(s.rate, backlog / Math.max(0.03, (END_BUDGET_MS - (now - s.endedAt)) / 1000)));
	s.revealed = Math.max(s.revealed, Math.min(s.revealed + s.rate * dt, s.total + s.fade));
}

function tick(): void {
	timer = undefined;
	const now = Date.now();
	for (const s of ticking) {
		advance(s, now);
		if (isDone(s)) ticking.delete(s);
	}
	try {
		requestRender?.();
	} catch {
		// a disposed TUI must not break the ticker
	}
	if (ticking.size > 0) timer = setTimeout(tick, FRAME_MS);
}

function startTicking(s: RevealState): void {
	if (!ticking.has(s)) {
		ticking.add(s);
		s.lastAt = Date.now();
	}
	if (timer === undefined) timer = setTimeout(tick, FRAME_MS);
}

// ── ANSI-aware measuring and cutting ──────────────────────────────────────────────────────────

const RE_ANSI = /\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const RE_ANSI_AT = /\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/y;
const RE_ASCII = /^[\x00-\x7f]*$/;
const RESET = "\x1b[0m";
const HYPERLINK_CLOSE = "\x1b]8;;\x1b\\";
const Segmenter = (Intl as any).Segmenter;
const segmenter = typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function graphemes(run: string): string[] {
	if (RE_ASCII.test(run)) return run.split("");
	return segmenter ? Array.from(segmenter.segment(run), (part: any) => part.segment as string) : Array.from(run);
}

/** Visible graphemes up to the last non-blank one (a row's padding does not take time to "type"). */
function rowChars(row: string): number {
	const plain = row.replace(RE_ANSI, "").trimEnd();
	return RE_ASCII.test(plain) ? plain.length : graphemes(plain).length;
}

type Rgb = [number, number, number];
/** Used when the theme gives no truecolor value (e.g. `text` left to the terminal default). */
const FALLBACK_FAINT: Rgb = [102, 102, 102];
const FALLBACK_INK: Rgb = [204, 204, 204];

function themeRgb(token: string, fallback: Rgb): Rgb {
	try {
		const rgb = parseFgAnsiToRgb(activeTheme?.getFgAnsi?.(token) ?? "");
		return rgb ? [rgb.r, rgb.g, rgb.b] : fallback;
	} catch {
		return fallback;
	}
}

/** Fade start (`dim`) and the target for chars on the default foreground (`text`); null when the fade is off. */
function fadePalette(): { faint: Rgb; ink: Rgb } | null {
	const mode = typeof activeTheme?.getColorMode === "function" ? activeTheme.getColorMode() : "truecolor";
	if (mode !== "truecolor") return null;
	return { faint: themeRgb("dim", FALLBACK_FAINT), ink: themeRgb("text", FALLBACK_INK) };
}

/** Fold one SGR sequence into the tracked foreground (`null` = default). */
function foldFg(sequence: string, fg: Rgb | null): Rgb | null {
	if (!sequence.endsWith("m")) return fg;
	const p = sequence.slice(2, -1).split(/[;:]/);
	for (let i = 0; i < p.length; i++) {
		const v = p[i];
		if (v === "" || v === "0" || v === "39") fg = null;
		else if (v === "38" && p[i + 1] === "2") {
			fg = [Number(p[i + 2]), Number(p[i + 3]), Number(p[i + 4])];
			i += 4;
		} else if (v === "38" && p[i + 1] === "5") {
			const rgb = parseFgAnsiToRgb(`38;5;${p[i + 2]}`);
			fg = rgb ? [rgb.r, rgb.g, rgb.b] : fg;
			i += 2;
		}
	}
	return fg;
}

function fadeColor(alpha: number, faint: Rgb, target: Rgb): string {
	const c = (k: 0 | 1 | 2) => Math.round(faint[k] + (target[k] - faint[k]) * alpha);
	return `\x1b[38;2;${c(0)};${c(1)};${c(2)}m`;
}

/**
 * One row starting at unit `start` with `n` visible chars: keep the chars below the cursor `revealed`,
 * and (truecolor) color the ones within the fade width of it between faint and their own color.
 * Escape sequences are copied whole and graphemes are never split.
 */
function cutRow(row: string, start: number, n: number, revealed: number, fade: { faint: Rgb; ink: Rgb; width: number } | null): string {
	const limit = Math.min(n, Math.ceil(revealed - start));
	const partial = limit < n;
	let out = "";
	let j = 0;
	let pos = 0;
	let fg: Rgb | null = null;
	while (pos < row.length) {
		const esc = row.indexOf("\x1b", pos);
		const run = row.slice(pos, esc < 0 ? row.length : esc);
		for (const ch of run ? graphemes(run) : []) {
			if (j >= n) {
				out += ch; // trailing padding of a fully shown row
				continue;
			}
			if (j >= limit) return out + RESET + (row.includes("\x1b]8;") ? HYPERLINK_CLOSE : "");
			const age = revealed - (start + j);
			out += fade && age < fade.width && ch.trim() !== "" ? fadeColor(age / fade.width, fade.faint, fg ?? fade.ink) + ch : ch;
			j++;
		}
		if (esc < 0) break;
		RE_ANSI_AT.lastIndex = esc;
		const token = RE_ANSI_AT.exec(row)?.[0] ?? "\x1b";
		fg = foldFg(token, fg);
		out += token;
		pos = esc + token.length;
	}
	return partial ? out + RESET : out;
}

/** Cut `rows` (a streamed message body) at the component's reveal cursor; rows pass through untouched when not revealing. */
export function revealBody(component: object, rows: string[]): string[] {
	if (rows.length === 0) return rows;
	let s = states.get(component);
	if (!isRevealEnabled()) {
		if (s) {
			states.delete(component);
			ticking.delete(s);
		}
		return rows;
	}
	if (!s) {
		if (!isComponentOnActiveStream(component)) return rows;
		s = { component, revealed: 0, total: 0, rate: BASE_RATE, fade: MIN_FADE, lastAt: Date.now(), endedAt: 0, arrivedAt: 0, gapS: undefined, counts: new Map() };
		states.set(component, s);
	}

	const counts = new Array<number>(rows.length);
	const cache = new Map<string, number>();
	let total = 0;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		const n = s.counts.get(row) ?? rowChars(row);
		cache.set(row, n);
		counts[i] = n;
		total += n + 1;
	}
	s.counts = cache;
	const grew = total > s.total;
	s.total = total;
	if (grew && s.endedAt === 0) onArrival(s, Date.now());

	if (isDone(s)) {
		if (!isComponentOnActiveStream(component)) states.delete(component);
		return rows;
	}
	startTicking(s);

	const fade = fadePalette();
	const shown: string[] = [];
	let start = 0;
	for (let i = 0; i < rows.length && start < s.revealed; i++) {
		const n = counts[i]!;
		shown.push(start + n - 1 + s.fade <= s.revealed ? rows[i]! : cutRow(rows[i]!, start, n, s.revealed, fade && { ...fade, width: s.fade }));
		start += n + 1;
	}
	return shown;
}
