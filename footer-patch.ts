import { FooterComponent } from "@mariozechner/pi-coding-agent";

const PATCHED = Symbol("footerStatsPatch");

export function installFooterStatsPatch() {
	const proto = FooterComponent.prototype as any;
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const origRender = proto.render;
	proto.render = function (width: number): string[] {
		const lines: string[] = origRender.call(this, width);
		// lines[0] = pwd/branch, lines[1] = stats, lines[2+] = extension statuses
		// Remove the stats line (index 1)
		if (lines.length >= 2) {
			lines.splice(1, 1);
		}
		return lines;
	};
}
