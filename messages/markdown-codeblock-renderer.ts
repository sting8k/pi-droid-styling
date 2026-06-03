import { Markdown } from "@earendil-works/pi-tui";

const PATCHED = Symbol.for("pi-droid-styling.markdown-codeblock-renderer.patched");
const DEFAULT_CODE_BLOCK_RAIL = "┃ ";

interface MarkdownLike {
	theme?: {
		codeBlock?: (text: string) => string;
		codeBlockBorder?: (text: string) => string;
		italic?: (text: string) => string;
		highlightCode?: (code: string, lang?: string) => string[];
	};
}

interface CodeTokenLike {
	type?: string;
	text?: string;
	lang?: string;
}

function getCodeLanguage(token: CodeTokenLike): string | undefined {
	const raw = typeof token.lang === "string" ? token.lang.trim() : "";
	if (!raw) return undefined;
	return raw.split(/\s+/, 1)[0];
}

function styleCodeLine(component: MarkdownLike, line: string): string {
	const codeBlock = component.theme?.codeBlock;
	return typeof codeBlock === "function" ? codeBlock(line) : line;
}

function styleCodeBlockRail(component: MarkdownLike): string {
	const codeBlockBorder = component.theme?.codeBlockBorder;
	return typeof codeBlockBorder === "function" ? codeBlockBorder(DEFAULT_CODE_BLOCK_RAIL) : DEFAULT_CODE_BLOCK_RAIL;
}

function styleCodeBlockLanguage(component: MarkdownLike, language: string): string {
	const italic = component.theme?.italic;
	const codeBlockBorder = component.theme?.codeBlockBorder;
	const label = `#${language}`;
	const styledLabel = typeof italic === "function" ? italic(label) : label;
	return typeof codeBlockBorder === "function" ? codeBlockBorder(styledLabel) : styledLabel;
}

function renderHighlightedCode(component: MarkdownLike, code: string, language: string | undefined): string[] {
	const highlightCode = component.theme?.highlightCode;
	if (typeof highlightCode === "function") {
		try {
			const highlighted = highlightCode(code, language);
			if (Array.isArray(highlighted)) return highlighted;
		} catch {
			// Fall back to the normal code-block color below.
		}
	}
	return code.split("\n").map((line) => styleCodeLine(component, line));
}

function renderCodeBlock(component: MarkdownLike, token: CodeTokenLike, nextTokenType: string | undefined): string[] {
	const lines: string[] = [];
	const language = getCodeLanguage(token);
	const code = typeof token.text === "string" ? token.text : "";
	const rail = styleCodeBlockRail(component);

	if (language) {
		lines.push(`${rail}${styleCodeBlockLanguage(component, language)}`);
	}

	for (const line of renderHighlightedCode(component, code, language)) {
		lines.push(`${rail}${line}`);
	}

	if (nextTokenType && nextTokenType !== "space") {
		lines.push("");
	}
	return lines;
}

export function installMarkdownCodeBlockRenderer(MarkdownClass: any = Markdown): void {
	const proto = MarkdownClass?.prototype;
	if (!proto || proto[PATCHED]) return;

	const baseRenderToken = proto.renderToken;
	if (typeof baseRenderToken !== "function") return;
	proto[PATCHED] = true;

	proto.renderToken = function patchedMarkdownCodeBlockRenderer(this: MarkdownLike, token: any, width: number, nextTokenType?: string, styleContext?: any): string[] {
		if (token?.type === "code") {
			return renderCodeBlock(this, token, nextTokenType);
		}
		return baseRenderToken.call(this, token, width, nextTokenType, styleContext);
	};
}
