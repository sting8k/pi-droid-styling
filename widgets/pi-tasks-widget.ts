import { safeTruncateToWidth } from "../render-budget.js";
import type { TasksWidgetStyle } from "../config.js";
import { stripAnsi } from "../theme/ansi.js";

type ThemeLike = {
	fg?(color: string, text: string): string;
	bold?(text: string): string;
	strikethrough?(text: string): string;
};

type TuiLike = {
	terminal?: {
		columns?: number;
	};
};

type WidgetFactory = (tui: TuiLike, theme: ThemeLike) => any;

type SessionUiLike = {
	theme?: ThemeLike;
	terminal?: { columns?: number };
	setWidget?(key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void;
};

type TaskRow = {
	kind: "task";
	status: "active" | "running" | "completed" | "pending";
	id: string;
	text: string;
	suffix: string;
};

type HeaderCounts = {
	total: number;
	completed: number;
	inProgress: number;
	pending: number;
};

type ParsedLine =
	| { kind: "header"; text: string; counts?: HeaderCounts }
	| { kind: "overflow"; text: string }
	| TaskRow
	| { kind: "unknown"; text: string };

const PATCH_STATE = Symbol.for("pi-droid-styling.pi-tasks-widget.state");
const WRAPPED_FACTORY = Symbol.for("pi-droid-styling.pi-tasks-widget.factory");
const WRAPPED_COMPONENT = Symbol.for("pi-droid-styling.pi-tasks-widget.component");
const SPINNER_PATTERN = /[✳✴✵✶✷✸✹✺✻✼✽]/g;
const SPINNER_CHARS = "✳✴✵✶✷✸✹✺✻✼✽";
const TASK_ROW_PATTERN = /^\s*([✳✴✵✶✷✸✹✺✻✼✽✔◼◻])\s+#(\S+)\s+(.+)$/;
const BLOCKED_SUFFIX = " › blocked by ";
const WIDGET_ROW_PREFIX = "   ";
const TASK_CYCLE_MS = 3000;

function color(theme: ThemeLike, colorName: string, text: string): string {
	return typeof theme?.fg === "function" ? theme.fg(colorName, text) : text;
}

function bold(theme: ThemeLike, text: string): string {
	return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

function strike(theme: ThemeLike, text: string): string {
	return typeof theme?.strikethrough === "function" ? theme.strikethrough(text) : text;
}

function normalizeWidgetLineForCache(line: string): string {
	return stripAnsi(line).replace(SPINNER_PATTERN, "●");
}

function parseHeaderCounts(text: string): HeaderCounts | undefined {
	const match = text.match(/^(\d+)\s+tasks?\s+\((.*)\)$/);
	if (!match) return undefined;
	const counts: HeaderCounts = { total: Number(match[1]), completed: 0, inProgress: 0, pending: 0 };
	for (const part of match[2]!.split(/,\s*/)) {
		const done = part.match(/^(\d+)\s+done$/);
		if (done) { counts.completed = Number(done[1]); continue; }
		const running = part.match(/^(\d+)\s+in progress$/);
		if (running) { counts.inProgress = Number(running[1]); continue; }
		const open = part.match(/^(\d+)\s+open$/);
		if (open) { counts.pending = Number(open[1]); }
	}
	return counts;
}

function parseTaskWidgetLine(line: string): ParsedLine {
	const text = stripAnsi(line).trimEnd();
	const headerMatch = text.match(/^●\s+(.+)$/);
	if (headerMatch) {
		const rawText = headerMatch[1]!;
		return { kind: "header", text: rawText.replace(/\bin progress\b/g, "running"), counts: parseHeaderCounts(rawText) };
	}

	const overflowMatch = text.match(/^\s*…\s+and\s+\d+\s+more$/);
	if (overflowMatch) return { kind: "overflow", text: text.trim() };

	const taskMatch = text.match(TASK_ROW_PATTERN);
	if (!taskMatch) return { kind: "unknown", text };

	const icon = taskMatch[1]!;
	const status = SPINNER_CHARS.includes(icon)
		? "active"
		: icon === "✔"
			? "completed"
			: icon === "◼"
				? "running"
				: "pending";

	let body = taskMatch[3]!.trimEnd();
	let suffix = "";
	const suffixStart = body.indexOf(BLOCKED_SUFFIX);
	if (suffixStart >= 0) {
		suffix = body.slice(suffixStart);
		body = body.slice(0, suffixStart).trimEnd();
	}

	return {
		kind: "task",
		status,
		id: taskMatch[2]!,
		text: body,
		suffix,
	};
}

// Upstream pi-tasks metrics are terminal suffixes. Strip only recognized
// metric shapes; leave ordinary task parentheses like `(3 files)` untouched.
const TIME_SEGMENT_PATTERN = /^(?:\d+s|\d+m(?: \d+s)?|\d+h(?: \d+m)?|\d+(?:\.\d+)?[smh](?:\d+[smh])*)$/;
const ARROW_TOKENS_PATTERN = /^(?:[↑↓]\s+\d+(?:\.\d+)?k?)(?:\s+[↑↓]\s+\d+(?:\.\d+)?k?)*$/;
const LEGACY_TOKEN_PATTERN = /^~?\d+(?:\.\d+)?k?(?:\s*(?:tok|tokens?))?$/i;
const TASK_STATS_PATTERN = /\s+\(([^)]*)\)$/;

function isTokenMetrics(text: string): boolean {
	const trimmed = text.trim();
	return ARROW_TOKENS_PATTERN.test(trimmed) || LEGACY_TOKEN_PATTERN.test(trimmed);
}

function splitDotMetrics(text: string): { body: string; time: string } | undefined {
	const parts = text.split(/\s+·\s+/);
	if (parts.length < 2) return undefined;
	const last = parts[parts.length - 1]!.trim();
	if (TIME_SEGMENT_PATTERN.test(last)) {
		return { body: parts.slice(0, -1).join(" · ").trimEnd(), time: last };
	}
	const maybeTime = parts[parts.length - 2]!.trim();
	if (TIME_SEGMENT_PATTERN.test(maybeTime) && isTokenMetrics(last)) {
		return { body: parts.slice(0, -2).join(" · ").trimEnd(), time: maybeTime };
	}
	return undefined;
}

function splitStats(text: string): { body: string; time: string } {
	const parenthesized = text.match(TASK_STATS_PATTERN);
	if (parenthesized) {
		const body = text.slice(0, parenthesized.index).trimEnd();
		const inner = parenthesized[1]!.trim();
		const metrics = splitDotMetrics(inner);
		if (metrics?.time) return { body, time: metrics.time };
		if (TIME_SEGMENT_PATTERN.test(inner)) return { body, time: inner };
	}

	const trailing = splitDotMetrics(text);
	if (trailing?.time) return trailing;
	return { body: text, time: "" };
}

function renderHeader(theme: ThemeLike, text: string): string {
	const label = color(theme, "accent", bold(theme, "Tasks"));
	const separator = color(theme, "dim", " · ");
	return `${WIDGET_ROW_PREFIX}${label}${separator}${color(theme, "dim", text)}`;
}

function renderOverflow(theme: ThemeLike, text: string): string {
	return `${WIDGET_ROW_PREFIX}${color(theme, "dim", text.replace(/^…/, "⋯"))}`;
}

function renderTaskIcon(theme: ThemeLike, status: TaskRow["status"]): string {
	if (status === "completed") return color(theme, "success", "✓");
	if (status === "pending") return color(theme, "dim", "○");
	return color(theme, "accent", "●");
}

function renderTaskText(theme: ThemeLike, row: TaskRow): string {
	const parsed = row.status === "active" || row.status === "running"
		? splitStats(row.text)
		: { body: row.text, time: "" };
	const timeStyled = parsed.time ? color(theme, "dim", ` · ${parsed.time}`) : "";
	if (row.status === "completed") return color(theme, "dim", strike(theme, parsed.body));
	if (row.status === "active") return `${color(theme, "accent", parsed.body)}${timeStyled}`;
	if (row.status === "running") return `${parsed.body}${timeStyled}`;
	return parsed.body;
}

function renderTaskRow(theme: ThemeLike, row: TaskRow, idWidth: number): string {
	const id = color(theme, "dim", `#${row.id.padStart(idWidth)}`);
	const icon = renderTaskIcon(theme, row.status);
	const text = renderTaskText(theme, row);
	const suffix = row.suffix ? color(theme, "dim", row.suffix) : "";
	return `${WIDGET_ROW_PREFIX}${icon} ${id}  ${text}${suffix}`;
}

function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}

function parseOverflowCount(parsed: ParsedLine[]): number {
	const ov = parsed.find((p): p is { kind: "overflow"; text: string } => p.kind === "overflow");
	if (!ov) return 0;
	const m = ov.text.match(/(\d+)\s+more/);
	return m ? Number(m[1]) : 0;
}

function getTaskCycleBucket(now = Date.now()): number {
	return Math.floor(now / TASK_CYCLE_MS);
}

function pickCurrentTask(tasks: TaskRow[], now = Date.now()): TaskRow | undefined {
	const active = tasks.filter((t) => t.status === "active");
	const candidates = active.length > 0 ? active : tasks.filter((t) => t.status === "running");
	if (candidates.length === 0) return undefined;
	return candidates[getTaskCycleBucket(now) % candidates.length];
}

function getCounts(parsed: ParsedLine[], tasks: TaskRow[]): HeaderCounts {
	const header = parsed.find((p): p is { kind: "header"; text: string; counts: HeaderCounts } => p.kind === "header" && Boolean(p.counts));
	if (header) return header.counts;
	return {
		total: tasks.length + parseOverflowCount(parsed),
		completed: tasks.filter((t) => t.status === "completed").length,
		inProgress: tasks.filter((t) => t.status === "active" || t.status === "running").length,
		pending: tasks.filter((t) => t.status === "pending").length,
	};
}

function renderCompactLine(parsed: ParsedLine[], theme: ThemeLike, width: number): string[] {
	const renderWidth = Math.max(1, Math.floor(width));
	const tasks = parsed.filter((p): p is TaskRow => p.kind === "task");
	const counts = getCounts(parsed, tasks);
	const total = counts.total;
	const label = `${WIDGET_ROW_PREFIX}${color(theme, "accent", "●")} ${color(theme, "accent", bold(theme, "Tasks"))}`;

	if (tasks.length === 0 && total === 0) {
		return [`${label}${color(theme, "dim", " · idle")}`];
	}

	const blocked = tasks.filter((t) => Boolean(t.suffix)).length;
	const current = pickCurrentTask(tasks);
	const allDone = counts.completed === total && total > 0;

	const tailParts: string[] = [];
	if (allDone) {
		tailParts.push(color(theme, "success", " done"));
	} else if (!current && counts.inProgress > 0) {
		tailParts.push(color(theme, "dim", " running"));
	} else if (!current) {
		tailParts.push(color(theme, "dim", " idle"));
	}
	tailParts.push(color(theme, "dim", ` (${counts.completed}/${total})`));
	if (blocked > 0) tailParts.push(color(theme, "dim", ` ${blocked} blocked`));
	const tail = tailParts.join("");

	if (!current || allDone) {
		const base = `${label}${tail}`;
		return [visibleWidth(base) > renderWidth ? safeTruncateToWidth(base, renderWidth, "…") : base];
	}

	const marker = color(theme, "accent", bold(theme, "› "));
	const idPrefix = color(theme, "dim", `[${current.id}] `);
	const spacer = " ";
	const parsedCurrent = splitStats(current.text);
	let body = parsedCurrent.body.replace(/…$/, "");
	let timeStyled = parsedCurrent.time ? color(theme, "dim", ` · ${parsedCurrent.time}`) : "";
	let timeWidth = visibleWidth(timeStyled);
	const fixedWidth = visibleWidth(label) + visibleWidth(spacer) + visibleWidth(marker) + visibleWidth(idPrefix) + visibleWidth(tail);
	const budget = renderWidth - fixedWidth;
	if (budget < 1) {
		const base = `${label}${tail}`;
		return [visibleWidth(base) > renderWidth ? safeTruncateToWidth(base, renderWidth, "…") : base];
	}
	if (budget - timeWidth < 1 && timeStyled) {
		timeStyled = "";
		timeWidth = 0;
	}
	const bodyBudget = Math.max(1, budget - timeWidth);
	if (visibleWidth(body) > bodyBudget) {
		body = safeTruncateToWidth(body, bodyBudget, "…");
	}
	return [`${label}${spacer}${marker}${idPrefix}${body}${timeStyled}${tail}`];
}

export function stylePiTasksWidgetLines(lines: string[], theme: ThemeLike, width: number, style: TasksWidgetStyle = "default"): string[] {
	if (style === "compact") {
		return renderCompactLine(lines.map(parseTaskWidgetLine), theme, Math.max(1, Math.floor(width)));
	}
	const parsed = lines.map(parseTaskWidgetLine);
	const idWidth = parsed.reduce((max, line) => line.kind === "task" ? Math.max(max, line.id.length) : max, 1);
	const maxWidth = Math.max(1, Math.floor(width));

	return parsed.map((line) => {
		const rendered = line.kind === "header"
			? renderHeader(theme, line.text)
			: line.kind === "overflow"
				? renderOverflow(theme, line.text)
				: line.kind === "task"
					? renderTaskRow(theme, line, idWidth)
					: line.text;
		return safeTruncateToWidth(rendered, maxWidth, "…");
	});
}

function getRenderWidth(args: unknown[], tui: TuiLike): number {
	const first = args[0];
	if (typeof first === "number" && Number.isFinite(first)) return first;
	const columns = tui?.terminal?.columns;
	return typeof columns === "number" && Number.isFinite(columns) ? columns : 80;
}

function wrapTaskWidgetComponent(component: any, tui: TuiLike, theme: ThemeLike, style: TasksWidgetStyle): any {
	if (!component || typeof component.render !== "function") return component;
	const meta = component[WRAPPED_COMPONENT];
	if (meta && meta.style === style) return component;
	const baseRender = (meta ? meta.baseRender : component.render.bind(component));
	component[WRAPPED_COMPONENT] = { baseRender, style };
	let cachedKey = "";
	let cachedLines: string[] | undefined;

	component.render = (...args: unknown[]) => {
		const lines = baseRender(...args);
		if (!Array.isArray(lines)) return lines;
		const width = getRenderWidth(args, tui);
		const cycleKey = style === "compact" ? `\ncycle:${getTaskCycleBucket()}` : "";
		const cacheKey = `${width}\n${style}${cycleKey}\n${lines.map(normalizeWidgetLineForCache).join("\n")}`;
		if (cachedLines && cachedKey === cacheKey) return cachedLines;
		cachedKey = cacheKey;
		cachedLines = stylePiTasksWidgetLines(lines, theme, width, style);
		return cachedLines;
	};

	return component;
}

function wrapTaskWidgetFactory(factory: WidgetFactory, style: TasksWidgetStyle): WidgetFactory {
	const meta = (factory as any)[WRAPPED_FACTORY];
	if (meta && meta.style === style) return factory;
	const base = meta ? meta.base : factory;
	const wrapped = ((tui: TuiLike, theme: ThemeLike) => wrapTaskWidgetComponent(base(tui, theme), tui, theme, style)) as WidgetFactory;
	(wrapped as any)[WRAPPED_FACTORY] = { base, style };
	return wrapped;
}

function styleStaticTaskWidgetLines(content: string[], theme: ThemeLike | undefined, style: TasksWidgetStyle, width = 80): string[] {
	return stylePiTasksWidgetLines(content, theme ?? {}, width, style);
}

export function installPiTasksWidgetStyling(sessionUi: SessionUiLike, style: TasksWidgetStyle = "default"): (() => void) | undefined {
	if (!sessionUi || typeof sessionUi.setWidget !== "function") return undefined;
	const host = sessionUi as SessionUiLike & { [PATCH_STATE]?: { dispose(): void } };
	if (host[PATCH_STATE]) return () => host[PATCH_STATE]?.dispose();

	const originalSetWidget = sessionUi.setWidget;
	const patchedSetWidget = function patchedPiTasksSetWidget(key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void {
		if (key !== "tasks" || content === undefined) {
			return originalSetWidget.call(sessionUi, key, content, options);
		}
		if (Array.isArray(content)) {
			const cols = sessionUi.terminal?.columns;
			const width = typeof cols === "number" && Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 80;
			return originalSetWidget.call(sessionUi, key, styleStaticTaskWidgetLines(content, sessionUi.theme, style, width), options);
		}
		if (typeof content === "function") {
			return originalSetWidget.call(sessionUi, key, wrapTaskWidgetFactory(content, style), options);
		}
		return originalSetWidget.call(sessionUi, key, content, options);
	};

	const state = {
		dispose() {
			if (sessionUi.setWidget === patchedSetWidget) sessionUi.setWidget = originalSetWidget;
			delete host[PATCH_STATE];
		},
	};

	host[PATCH_STATE] = state;
	sessionUi.setWidget = patchedSetWidget;
	return () => state.dispose();
}
