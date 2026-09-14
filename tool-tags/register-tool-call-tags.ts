import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ToolRegistrar = (pi: ExtensionAPI) => void | Promise<void>;
type ToolRegistrarModule = Record<string, ToolRegistrar>;

async function loadRegistrar(specifier: string, exportName: string): Promise<ToolRegistrar> {
	const module = await import(specifier) as ToolRegistrarModule;
	const register = module[exportName];
	if (typeof register !== "function") throw new Error(`Missing tool registrar ${exportName}`);
	return register;
}

/**
 * Registers the enhanced-edit bridge tool only. Builtin tool styling is
 * attached by installBuiltinToolRenderers.
 */
export async function registerToolCallTags(pi: ExtensionAPI): Promise<void> {
	const register = await loadRegistrar("./edit.js", "registerEditTool");
	await register(pi);
}
