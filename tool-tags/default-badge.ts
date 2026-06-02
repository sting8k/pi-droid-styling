import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { loadConfig } from "../config.js";
import { formatBoxedFooter, formatToolName, formatToolParamLines, renderBoxedToolCall, renderBoxedToolResult, renderLines } from "./common.js";
import { annotateToolResultMetrics } from "./elapsed.js";

const PATCH_FLAG = "__defaultBadgePatched__";
const RENDERED_FLAG = Symbol("__defaultBadge_rendered__");
const BOXED_FALLBACK_FLAG = Symbol("__defaultBadge_boxedFallback__");
const EXECUTION_STARTED_AT_FLAG = Symbol("__defaultBadge_executionStartedAt__");

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

type FallbackRenderCache = {
	width: number;
	theme: any;
	result: any;
	expanded: boolean;
	maxLines: number;
	isError: boolean;
	isPartial: boolean;
	hasResult: boolean;
	lines: string[];
};

function createBoxedFallbackComponent(owner: any): Component {
	let cache: FallbackRenderCache | null = null;
	return {
		invalidate() { cache = null; },
		render(width: number): string[] {
			const theme = getRenderTheme();
			const isError = Boolean(owner.result?.isError);
			const isPartial = Boolean(owner.isPartial);
			const hasResult = Boolean(owner.result);
			const expanded = Boolean(owner.expanded);
			const maxLines = hasResult && expanded ? loadConfig().maxExpandedLines : MAX_FALLBACK_PREVIEW_LINES;
			if (
				cache &&
				cache.width === width &&
				cache.theme === theme &&
				cache.result === owner.result &&
				cache.expanded === expanded &&
				cache.maxLines === maxLines &&
				cache.isError === isError &&
				cache.isPartial === isPartial &&
				cache.hasResult === hasResult
			) {
				return cache.lines;
			}

			const call = renderBoxedToolCall(theme, formatToolName(String(owner.toolName ?? "Tool")), formatToolParamLines(owner.args, theme), {
				isError,
				isPartial,
				isPending: isPartial && !hasResult,
			});
			if (!hasResult) {
				const lines = call.render(width);
				cache = { width, theme, result: owner.result, expanded, maxLines, isError, isPartial, hasResult, lines };
				return lines;
			}

			const output = getTextOutput(owner);
			const renderOptions = { expanded, isPartial };
			const result = renderBoxedToolResult(theme, (contentWidth) => {
				const body = renderLines(theme, output, renderOptions, {
					maxLines,
					color: isError ? "error" : "toolOutput",
					width: contentWidth,
				});
				return body ? body.split("\n") : [];
			}, {
				footerLines: [formatBoxedFooter(theme, owner.result)],
				renderLineBudget: maxLines,
				isError,
				isPartial,
			});
			const lines = [...call.render(width), ...result.render(width)];
			cache = { width, theme, result: owner.result, expanded, maxLines, isError, isPartial, hasResult, lines };
			return lines;
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

	const baseMarkExecutionStarted = proto.markExecutionStarted;
	if (typeof baseMarkExecutionStarted === "function") {
		proto.markExecutionStarted = function patchedDefaultBadgeMarkExecutionStarted(this: any, ...args: any[]) {
			this[EXECUTION_STARTED_AT_FLAG] = performance.now();
			return baseMarkExecutionStarted.apply(this, args);
		};
	}

	const baseUpdateResult = proto.updateResult;
	if (typeof baseUpdateResult === "function") {
		proto.updateResult = function patchedDefaultBadgeUpdateResult(this: any, result: any, isPartial: boolean = false, ...rest: any[]) {
			if (!isPartial && result && typeof result === "object") {
				const startedAt = typeof this[EXECUTION_STARTED_AT_FLAG] === "number" ? this[EXECUTION_STARTED_AT_FLAG] : undefined;
				const elapsedMs = startedAt === undefined ? undefined : Math.max(0, performance.now() - startedAt);
				annotateToolResultMetrics(result, elapsedMs);
			}
			return baseUpdateResult.call(this, result, isPartial, ...rest);
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
