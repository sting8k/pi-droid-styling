import { renderBashCall, renderBashResult } from "./bash.js";
import { renderEditCall, renderEditResult } from "./edit.js";
import { renderFindCall, renderFindResult } from "./find.js";
import { renderGrepCall, renderGrepResult } from "./grep.js";
import { renderLsCall, renderLsResult } from "./ls.js";
import { renderReadCall, renderReadResult } from "./read.js";
import { renderWriteCall, renderWriteResult } from "./write.js";

const CALL_PATCHED = Symbol.for("pi-droid-styling.builtin-tool-renderers.call.patched");
const RESULT_PATCHED = Symbol.for("pi-droid-styling.builtin-tool-renderers.result.patched");
const SHELL_PATCHED = Symbol.for("pi-droid-styling.builtin-tool-renderers.shell.patched");

// Applied name-first: for these builtin tool names the droid renderer wins
// regardless of which definition survived registry dedup (issue #24).
const BUILTIN_TOOL_RENDERERS: Record<string, { call: Function; result: Function }> = {
	read: { call: renderReadCall, result: renderReadResult },
	write: { call: renderWriteCall, result: renderWriteResult },
	edit: { call: renderEditCall, result: renderEditResult },
	ls: { call: renderLsCall, result: renderLsResult },
	find: { call: renderFindCall, result: renderFindResult },
	grep: { call: renderGrepCall, result: renderGrepResult },
	bash: { call: renderBashCall, result: renderBashResult },
};

export function installBuiltinToolRenderers(ToolExecutionComponentClass: any): void {
	const proto = ToolExecutionComponentClass?.prototype;
	if (!proto) return;

	if (!proto[CALL_PATCHED] && typeof proto.getCallRenderer === "function") {
		proto[CALL_PATCHED] = true;
		const baseGetCallRenderer = proto.getCallRenderer;
		proto.getCallRenderer = function patchedBuiltinToolCallRenderer(this: any, ...args: any[]) {
			const renderer = BUILTIN_TOOL_RENDERERS[this.toolName]?.call;
			if (renderer) return renderer;
			return baseGetCallRenderer.apply(this, args);
		};
	}

	if (!proto[RESULT_PATCHED] && typeof proto.getResultRenderer === "function") {
		proto[RESULT_PATCHED] = true;
		const baseGetResultRenderer = proto.getResultRenderer;
		proto.getResultRenderer = function patchedBuiltinToolResultRenderer(this: any, ...args: any[]) {
			const renderer = BUILTIN_TOOL_RENDERERS[this.toolName]?.result;
			if (renderer) return renderer;
			return baseGetResultRenderer.apply(this, args);
		};
	}

	if (!proto[SHELL_PATCHED] && typeof proto.getRenderShell === "function") {
		proto[SHELL_PATCHED] = true;
		const baseGetRenderShell = proto.getRenderShell;
		proto.getRenderShell = function patchedBuiltinToolRenderShell(this: any, ...args: any[]) {
			if (BUILTIN_TOOL_RENDERERS[this.toolName]) return "default";
			return baseGetRenderShell.apply(this, args);
		};
	}
}
