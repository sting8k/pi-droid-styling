import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerBashTool } from "./bash.js";
import { registerEditTool } from "./edit.js";
import { registerFindTool } from "./find.js";
import { registerGrepTool } from "./grep.js";
import { registerLsTool } from "./ls.js";
import { registerReadTool } from "./read.js";
import { registerWriteTool } from "./write.js";

const toolRegistry: Record<string, (pi: ExtensionAPI) => void> = {
	read: registerReadTool,
	write: registerWriteTool,
	edit: registerEditTool,
	ls: registerLsTool,
	find: registerFindTool,
	grep: registerGrepTool,
	bash: registerBashTool,
};

export function registerToolCallTags(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools();
	const activeSet = new Set(activeTools);

	for (const [name, register] of Object.entries(toolRegistry)) {
		if (activeSet.has(name)) {
			register(pi);
		}
	}
}
