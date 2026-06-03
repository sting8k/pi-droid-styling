import { profileCount, profileDuration, profileNow, profileSample } from "./profiler.js";

const ASSISTANT_PATCHED = Symbol.for("pi-droid-styling.finished-render-cache.assistant.patched");
const TOOL_PATCHED = Symbol.for("pi-droid-styling.finished-render-cache.tool.patched");
const CACHE_KEY = Symbol("finished-render-cache");
const SIGNATURE_KEY = Symbol("finished-render-signature");

type RenderCache = {
	width: number;
	key: string;
	lines: string[];
};

type SignatureCache = {
	source: any;
	signature: string;
};

type FinishedKeyGetter = (component: any) => string | undefined;

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function getObjectId(value: any): string {
	if (!value || typeof value !== "object") return String(value);
	let id = objectIds.get(value);
	if (!id) {
		id = nextObjectId++;
		objectIds.set(value, id);
	}
	return String(id);
}

function clearFinishedRenderCache(component: any, kind: string, reason: string): void {
	if (!component || typeof component !== "object") return;
	if (component[CACHE_KEY]) {
		profileCount(`finishedRender.${kind}.invalidated`);
		profileCount(`finishedRender.${kind}.invalidated.${reason}`);
	}
	component[CACHE_KEY] = undefined;
	component[SIGNATURE_KEY] = undefined;
}

function wrapInvalidator(proto: any, methodName: string, kind: string): void {
	const base = proto?.[methodName];
	if (typeof base !== "function") return;
	proto[methodName] = function patchedFinishedRenderInvalidator(this: any, ...args: any[]) {
		clearFinishedRenderCache(this, kind, methodName);
		return base.apply(this, args);
	};
}

function wrapRenderCache(proto: any, kind: string, getFinishedKey: FinishedKeyGetter): void {
	const baseRender = proto?.render;
	if (typeof baseRender !== "function") return;

	proto.render = function patchedFinishedRenderCache(this: any, width: number): string[] {
		const key = getFinishedKey(this);
		if (!key) {
			profileCount(`finishedRender.${kind}.bypass`);
			return baseRender.call(this, width);
		}

		const cache = this[CACHE_KEY] as RenderCache | undefined;
		if (cache && cache.width === width && cache.key === key) {
			profileCount(`finishedRender.${kind}.hit`);
			profileSample(`finishedRender.${kind}.lines.count`, cache.lines.length);
			return cache.lines;
		}

		profileCount(`finishedRender.${kind}.miss`);
		const start = profileNow();
		const lines = baseRender.call(this, width);
		profileDuration(`finishedRender.${kind}.render.ms`, start);
		this[CACHE_KEY] = { width, key, lines } satisfies RenderCache;
		profileSample(`finishedRender.${kind}.lines.count`, lines.length);
		return lines;
	};
}

function getCachedSignature(component: any, source: any, build: () => string): string {
	const cached = component[SIGNATURE_KEY] as SignatureCache | undefined;
	if (cached && cached.source === source) return cached.signature;
	const signature = build();
	component[SIGNATURE_KEY] = { source, signature } satisfies SignatureCache;
	return signature;
}

function getAssistantFinishedKey(component: any): string | undefined {
	const message = component?.lastMessage;
	if (!message || message.stopReason === undefined || message.stopReason === null) return undefined;
	const signature = getCachedSignature(component, message, () => [
		"assistant",
		getObjectId(message),
		String(message.stopReason ?? ""),
		String(message.errorMessage ?? ""),
		`hide:${Boolean(component.hideThinkingBlock)}`,
		`label:${String(component.hiddenThinkingLabel ?? "")}`,
		`theme:${getObjectId(component.markdownTheme)}`,
		`toolCalls:${Boolean(component.hasToolCalls)}`,
	].join("|"));
	return signature;
}

function getToolFinishedKey(component: any): string | undefined {
	if (!component?.result || component.isPartial) return undefined;
	const result = component.result;
	if (Array.isArray(result.content) && result.content.some((block: any) => block?.type === "image")) return undefined;
	if (Array.isArray(component.imageComponents) && component.imageComponents.length > 0) return undefined;
	const convertedImages = component.convertedImages instanceof Map ? component.convertedImages.size : 0;
	const signature = getCachedSignature(component, result, () => [
		"tool",
		String(component.toolName ?? ""),
		String(component.toolCallId ?? ""),
		`args:${getObjectId(component.args)}`,
		`result:${getObjectId(result)}`,
		`expanded:${Boolean(component.expanded)}`,
		`showImages:${Boolean(component.showImages)}`,
		`imageWidth:${Number(component.imageWidthCells ?? 0)}`,
		`converted:${convertedImages}`,
		`hidden:${Boolean(component.hideComponent)}`,
	].join("|"));
	return signature;
}

export function installFinishedRenderCache(AssistantMessageClass: any, ToolExecutionClass: any): void {
	const assistantProto = AssistantMessageClass?.prototype;
	if (assistantProto && !assistantProto[ASSISTANT_PATCHED]) {
		assistantProto[ASSISTANT_PATCHED] = true;
		wrapInvalidator(assistantProto, "updateContent", "assistant");
		wrapInvalidator(assistantProto, "invalidate", "assistant");
		wrapInvalidator(assistantProto, "setHideThinkingBlock", "assistant");
		wrapInvalidator(assistantProto, "setHiddenThinkingLabel", "assistant");
		wrapRenderCache(assistantProto, "assistant", getAssistantFinishedKey);
	}

	const toolProto = ToolExecutionClass?.prototype;
	if (toolProto && !toolProto[TOOL_PATCHED]) {
		toolProto[TOOL_PATCHED] = true;
		wrapInvalidator(toolProto, "updateArgs", "tool");
		wrapInvalidator(toolProto, "markExecutionStarted", "tool");
		wrapInvalidator(toolProto, "setArgsComplete", "tool");
		wrapInvalidator(toolProto, "updateResult", "tool");
		wrapInvalidator(toolProto, "updateDisplay", "tool");
		wrapInvalidator(toolProto, "setExpanded", "tool");
		wrapInvalidator(toolProto, "setShowImages", "tool");
		wrapInvalidator(toolProto, "setImageWidthCells", "tool");
		wrapInvalidator(toolProto, "invalidate", "tool");
		wrapRenderCache(toolProto, "tool", getToolFinishedKey);
	}
}
