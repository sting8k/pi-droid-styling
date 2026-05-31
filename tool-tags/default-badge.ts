import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { formatBoxedFooter, formatToolName, formatToolParamLines, renderBoxedToolCall, renderBoxedToolResult, renderLines } from "./common.js";

const PATCH_FLAG = "__defaultBadgePatched__";
const RENDERED_FLAG = Symbol("__defaultBadge_rendered__");
const BOXED_FALLBACK_FLAG = Symbol("__defaultBadge_boxedFallback__");

const CUSTOM_TOOLS = new Set(["read", "write", "edit", "bash", "ls", "find", "grep", "quick_edit", "substitute_edit", "target_edit"]);
const MAX_FALLBACK_PREVIEW_LINES = 10;

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
			const isError = Boolean(owner.result?.isError);
			const isPartial = Boolean(owner.isPartial);
			const hasResult = Boolean(owner.result);
			const call = renderBoxedToolCall(theme, formatToolName(String(owner.toolName ?? "Tool")), formatToolParamLines(owner.args, theme), {
				isError,
				isPartial,
				isPending: isPartial && !hasResult,
			});
			if (!hasResult) return call.render(width);

			const output = getTextOutput(owner);
			const renderOptions = { expanded: Boolean(owner.expanded), isPartial };
			const result = renderBoxedToolResult(theme, (contentWidth) => {
				const body = renderLines(theme, output, renderOptions, {
					maxLines: MAX_FALLBACK_PREVIEW_LINES,
					color: isError ? "error" : "toolOutput",
					width: contentWidth,
				});
				return body ? body.split("\n") : [];
			}, {
				footerLines: [formatBoxedFooter(theme, owner.result)],
				isError,
				isPartial,
			});
			return [...call.render(width), ...result.render(width)];
		},
	};
}

function tightenBoxedContainer(thisArg: any): void {
	const renderShell = typeof thisArg.getRenderShell === "function" ? thisArg.getRenderShell() : "default";
	const container = renderShell === "self" ? thisArg.selfRenderContainer : thisArg.contentBox;
	if (!container) return;
	container.paddingX = 0;
	container.paddingY = 0;
	if (typeof container.setBgFn === "function") container.setBgFn((text: string) => text);
	if (typeof container.invalidateCache === "function") container.invalidateCache();
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
		tightenBoxedContainer(thisArg);
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

	const baseGetRenderContext = proto.getRenderContext;
	if (typeof baseGetRenderContext === "function") {
		proto.getRenderContext = function patchedBoxedRenderContext(this: any, ...args: any[]) {
			const context = baseGetRenderContext.apply(this, args);
			return { ...context, hasResult: Boolean(this.result) };
		};
	}

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
		if (!toolName) return result;
		if (CUSTOM_TOOLS.has(toolName)) {
			tightenBoxedContainer(this);
			return result;
		}

		installBoxedFallback(this);
		this[BOXED_FALLBACK_FLAG]?.invalidate?.();
		return result;
	};
}
