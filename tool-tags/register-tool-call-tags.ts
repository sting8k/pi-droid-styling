import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ToolRegistrar = (pi: ExtensionAPI) => void | Promise<void>;
type ToolRegistrarModule = Record<string, ToolRegistrar>;

async function loadRegistrar(specifier: string, exportName: string): Promise<ToolRegistrar> {
	const module = await import(specifier) as ToolRegistrarModule;
	const register = module[exportName];
	if (typeof register !== "function") throw new Error(`Missing tool registrar ${exportName}`);
	return register;
}

export async function registerToolCallTags(pi: ExtensionAPI): Promise<void> {
	const registers = await Promise.all([
		loadRegistrar("./read.js", "registerReadTool"),
		loadRegistrar("./write.js", "registerWriteTool"),
		loadRegistrar("./edit.js", "registerEditTool"),
		loadRegistrar("./ls.js", "registerLsTool"),
		loadRegistrar("./find.js", "registerFindTool"),
		loadRegistrar("./grep.js", "registerGrepTool"),
		loadRegistrar("./bash.js", "registerBashTool"),
	]);
	await Promise.all(registers.map((register) => register(pi)));
}
