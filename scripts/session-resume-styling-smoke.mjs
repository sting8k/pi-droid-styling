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

	console.log("session resume styling smoke: ok");
} finally {
	proto.render = originalRender;
	if (originalGlobalPatchFlag === undefined) delete globalThis[globalPatchFlag];
	else globalThis[globalPatchFlag] = originalGlobalPatchFlag;
}
