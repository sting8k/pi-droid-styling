#!/usr/bin/env node

import { createJiti } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const repoRoot = process.cwd();
const alias = {
	"@earendil-works/pi-coding-agent": new URL("../node_modules/@earendil-works/pi-coding-agent/dist/index.js", import.meta.url).pathname,
	"@earendil-works/pi-tui": new URL("../node_modules/@earendil-works/pi-tui/dist/index.js", import.meta.url).pathname,
};
const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};
const proto = ToolExecutionComponent.prototype;
const originalRender = proto.render;
const globalPatchFlag = "__compactToolSpacingPatched__";
const originalGlobalPatchFlag = globalThis[globalPatchFlag];

try {
	proto.render = function baseResumeToolRender() {
		return ["┌box", "│ body", "└box"];
	};
	delete globalThis[globalPatchFlag];

	const runtimeA = createJiti(import.meta.url, { moduleCache: false, alias });
	const modulesA = await runtimeA.import(`${repoRoot}/session-modules.ts`);
	modulesA.setPresentationStyle("droid");
	modulesA.setToolSpacingTheme(theme);
	modulesA.installCompactToolSpacing(ToolExecutionComponent);
	const droidLines = proto.render.call({ expanded: false }, 40);
	assert(droidLines.length === 3 && droidLines[0] === "┌box", "runtime A should retain the boxed Droid tool");

	const runtimeB = createJiti(import.meta.url, { moduleCache: false, alias });
	const modulesB = await runtimeB.import(`${repoRoot}/session-modules.ts`);
	modulesB.setPresentationStyle("reasonix");
	modulesB.setToolSpacingTheme(theme);
	modulesB.installCompactToolSpacing(ToolExecutionComponent);
	const resumedLines = proto.render.call({ expanded: false }, 40);
	assert(resumedLines[0] === "┌box", "runtime B should preserve the tool title");
	assert(resumedLines.length === 2 && resumedLines.at(-1) === "", "runtime B should take ownership and collapse restored Droid tool framing");

	const restoredTool = {
		toolName: "read",
		toolDefinition: { renderCall: () => "stale" },
		refreshCount: 0,
		updateDisplay() { this.refreshCount++; },
	};
	const currentDefinition = { renderCall: () => "current" };
	const hiddenRestoredTool = {
		toolName: "bash",
		toolDefinition: { renderCall: () => "stale" },
		refreshCount: 0,
		updateDisplay() { this.refreshCount++; },
	};
	const virtualizedState = Symbol.for("pi-droid-styling.virtualized-chat.state");
	class FakeInteractiveMode {
		session = { getToolDefinition: (name) => name === "read" || name === "bash" ? currentDefinition : undefined };
		chatContainer = {
			children: [restoredTool],
			[virtualizedState]: { hiddenChildren: [hiddenRestoredTool] },
		};
		ui = { requestRender() {} };
		renderCurrentSessionState() {}
	}
	modulesB.installResumeToolRefresh(FakeInteractiveMode);
	const mode = new FakeInteractiveMode();
	mode.renderCurrentSessionState();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(restoredTool.toolDefinition === currentDefinition, "resume refresh should rebind the current tool definition");
	assert(restoredTool.refreshCount === 1, "resume refresh should rebuild each restored tool renderer once");
	assert(hiddenRestoredTool.toolDefinition === currentDefinition, "resume refresh should rebind virtualized hidden tools");
	assert(hiddenRestoredTool.refreshCount === 1, "resume refresh should rebuild virtualized hidden tools once");

	console.log("session resume styling smoke: ok");
} finally {
	proto.render = originalRender;
	if (originalGlobalPatchFlag === undefined) delete globalThis[globalPatchFlag];
	else globalThis[globalPatchFlag] = originalGlobalPatchFlag;
}
