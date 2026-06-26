import { FooterComponent } from "@earendil-works/pi-coding-agent";

const PATCHED = Symbol.for("pi-droid-styling.footer-stats.patched");
const ORIGINAL_RENDER = Symbol.for("pi-droid-styling.footer-stats.original-render");
const FOOTER_STATE = Symbol.for("pi-droid-styling.footer-stats.state");
const PATCH_VERSION = 5;

const ANSI_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g;

type FooterState = {
	latestStatusLines: string[];
	latestTokenUsageLine: string | null;
};

function footerState(): FooterState {
	const globalState = globalThis as Record<symbol, FooterState | undefined>;
	let state = globalState[FOOTER_STATE];
	if (!state) {
		state = { latestStatusLines: [], latestTokenUsageLine: null };
		globalState[FOOTER_STATE] = state;
	}
	return state;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function readExtensionStatusLines(owner: any): string[] {
	try {
		const statuses = owner?.footerData?.getExtensionStatuses?.();
		if (!(statuses instanceof Map) || statuses.size === 0) return [];
		return Array.from(statuses.entries())
			.sort(([a], [b]) => String(a).localeCompare(String(b)))
			.map(([, text]) => sanitizeStatusText(String(text ?? "")))
			.filter(Boolean);
	} catch {
		return [];
	}
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function formatCompactToken(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function computeTokenUsageLine(session: any): string | null {
	if (!session?.sessionManager?.getEntries) return null;
	const entries = session.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "message" && entry?.message?.role === "assistant") {
			const u = entry.message.usage;
			if (!u || entry.message.stopReason === "aborted" || entry.message.stopReason === "error") continue;
			const inp = formatCompactToken(u.input ?? 0);
			const out = formatCompactToken(u.output ?? 0);
			const cr = formatCompactToken(u.cacheRead ?? 0);
			return `[↑${inp} ↓${out} R${cr}]`;
		}
	}
	return null;
}

export function getFooterTokenUsageLine(): string | null {
	return footerState().latestTokenUsageLine;
}

export function getFooterStatusLine(): string | null {
	const statusLines = footerState().latestStatusLines;
	return statusLines.length > 0 ? statusLines.join("  ") : null;
}

export function installFooterStatsPatch() {
	const proto = FooterComponent.prototype as any;
	if (proto[PATCHED] === PATCH_VERSION) return;

	const origRender = proto[ORIGINAL_RENDER] ?? proto.render;
	proto[ORIGINAL_RENDER] = origRender;
	proto[PATCHED] = PATCH_VERSION;
	proto.render = function (width: number): string[] {
		const lines: string[] = origRender.call(this, width);

		// Sanitize: each array element must be exactly 1 physical line.
		// Session name from session_info can contain literal "\n" which
		// corrupts Pi's line-diff renderer → whole TUI overlaps/smears.
		// Also cap length so a huge sessionName doesn't blow out footer.
		const MAX_LEN = 125;
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			if (!l) continue;
			let sanitized = l;
			if (/[\r\n]/.test(sanitized)) {
				sanitized = sanitized.replace(/[\r\n]+/g, " ");
			}
			// Length check on raw string (ANSI codes included — rough but safe).
			// Uses truncateToWidth logic would be ideal but we lack visible-width here;
			// raw char cap is enough to prevent the pathological multi-line case.
			if (sanitized.length > MAX_LEN) {
				sanitized = sanitized.slice(0, MAX_LEN - 1) + "…";
			}
			if (sanitized !== l) lines[i] = sanitized;
		}

		// Capture extension statuses and compute token usage directly from session
		// entries (not parsed from the rendered stats line, which can be truncated).
		const directStatusLines = readExtensionStatusLines(this);
		const statusLines = directStatusLines.length > 0
			? directStatusLines
			: lines.slice(2).filter((line) => Boolean(line?.trim()));
		if (statusLines.length > 0) footerState().latestStatusLines = statusLines;
		footerState().latestTokenUsageLine = computeTokenUsageLine(this.session);
		return [];
	};
}
