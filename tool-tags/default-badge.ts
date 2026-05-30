import { ToolExecutionComponent } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";

import { boxBorder, boxedWrappedLines, boxWidth, formatBoxedFooter, formatBoxedToolTitle, formatToolName, formatToolParamLines } from "./common.js";

const PATCH_FLAG = "__defaultBadgePatched__";
const RENDERED_FLAG = Symbol("__defaultBadge_rendered__");
const BOXED_FALLBACK_FLAG = Symbol("__defaultBadge_boxedFallback__");

const CUSTOM_TOOLS = new Set(["read", "write", "edit", "bash", "ls", "find", "grep", "quick_edit", "substitute_edit", "target_edit"]);

let cachedTheme: any = null;

const fallbackTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function getRenderTheme(): any {
	return cachedTheme ?? fallbackTheme;
}

function getTextOutput(owner: any): string {
	try {
		if (typeof owner.getTextOutput === "function") return String(owner.getTextOutput() ?? "").replace(/\r/g, "").trimEnd();
	} catch {
		// Fall back to raw result content below.
	}
	const content = owner.result?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: any) => block?.type === "text")
		.map((block: any) => String(block.text ?? ""))
		.join("\n")
		.replace(/\r/g, "")
		.trimEnd();
}

function createBoxedFallbackComponent(owner: any): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			const theme = getRenderTheme();
			const renderedWidth = boxWidth(width);
			const title = formatBoxedToolTitle(theme, formatToolName(String(owner.toolName ?? "Tool")), Boolean(owner.result?.isError));
			const paramLines = formatToolParamLines(owner.args, theme);
			const output = getTextOutput(owner);
			const rawOutputLines = output ? output.split("\n") : [];
			const outputLines = rawOutputLines.length > 0 ? rawOutputLines : [theme.fg("muted", "∅ (no output)")];
			if (owner.result?.isError) outputLines.unshift(theme.fg("error", "✗ Error"));

			const lines = [
				boxBorder(theme, "┌", "┐", renderedWidth, title),
				...paramLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
			];

			if (owner.result) {
				lines.push(
					boxBorder(theme, "├", "┤", renderedWidth),
					...outputLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth)),
					...boxedWrappedLines(theme, formatBoxedFooter(theme, owner.result), renderedWidth),
				);
			}

			lines.push(boxBorder(theme, "└", "┘", renderedWidth));
			return lines;
		},
	};
}

function installBoxedFallback(thisArg: any): void {
	const component = thisArg[BOXED_FALLBACK_FLAG] ?? createBoxedFallbackComponent(thisArg);
	thisArg[BOXED_FALLBACK_FLAG] = component;

	const hasRendererDefinition = Boolean(thisArg.hasRendererDefinition?.());
	const usesSelfRenderShell = hasRendererDefinition && thisArg.getRenderShell?.() === "self";
	const targetContainer = usesSelfRenderShell ? thisArg.selfRenderContainer : thisArg.contentBox;
	if (targetContainer && typeof targetContainer.clear === "function" && typeof targetContainer.addChild === "function") {
		// Boxed fallback owns its own visual boundary; avoid container-level bg
		// so the status background does not spill beyond the box.
		if (!hasRendererDefinition && typeof targetContainer.setBgFn === "function") {
			targetContainer.setBgFn((text: string) => text);
		}
		targetContainer.clear();
		targetContainer.addChild(component);
	}

	const childIndex = Array.isArray(thisArg.children) ? thisArg.children.indexOf(thisArg.contentText) : -1;
	if (childIndex >= 0) thisArg.children[childIndex] = thisArg.contentBox;
}

export function setDefaultBadgeTheme(theme: any): void {
	cachedTheme = theme;
}

export function installDefaultBadge(): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	const proto = ToolExecutionComponent.prototype as any;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const baseUpdateDisplay = proto.updateDisplay;
	proto.updateDisplay = function patchedDefaultBadge(this: any, ...args: any[]) {
		// Force invalidate cached renderer on first render to fix resume render issue
		// (only for completed tools that haven't been rendered yet)
		if (!this[RENDERED_FLAG] && this.resultRendererComponent && typeof this.resultRendererComponent.invalidate === "function") {
			try {
				this.resultRendererComponent.invalidate();
			} catch {
				// best effort
			}
		}
		this[RENDERED_FLAG] = true;

		const result = baseUpdateDisplay.apply(this, args);

		const toolName: string | undefined = this.toolName;
		if (!toolName || CUSTOM_TOOLS.has(toolName)) return result;

		installBoxedFallback(this);
		this[BOXED_FALLBACK_FLAG]?.invalidate?.();
		return result;
	};
}
