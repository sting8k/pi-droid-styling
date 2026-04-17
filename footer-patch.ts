import { FooterComponent } from "@mariozechner/pi-coding-agent";

const PATCHED = Symbol("footerStatsPatch");

export function installFooterStatsPatch() {
	const proto = FooterComponent.prototype as any;
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const origRender = proto.render;
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

		// lines[0] = pwd/branch, lines[1] = stats, lines[2+] = extension statuses
		// Remove the stats line (index 1)
		if (lines.length >= 2) {
			lines.splice(1, 1);
		}
		return lines;
	};
}
