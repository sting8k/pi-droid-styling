import { getPresentationDesign } from "../presentation/state.js";
import { getReasonixCollapsedRowWidth } from "../presentation/reasonix-layout.js";
import { isImageRenderLine, safeTruncateToWidth, safeVisibleWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";

/**
 * claudecode: fold a run of consecutive tool calls (and the text-less assistant
 * turns that issued them) under one `● Running(…)` / `● Done(…)` summary row with
 * each member's collapsed rows hanging from a `├─` / `└─` tree, the pi-pretty-tui
 * activity group without its mouse/session machinery.
 *
 * Grouping is a pure projection of the chat children at render time: nothing is
 * persisted, Ctrl+O (any member expanded) shows every member as before, and a
 * single tool call keeps its own row.
 */
const MIN_GROUPED_TOOLS = 2;

let groupTheme: any = null;

export function setToolGroupTheme(theme: any): void {
	groupTheme = theme;
}

function fg(color: string, text: string): string {
	return typeof groupTheme?.fg === "function" ? groupTheme.fg(color, text) : text;
}

function bold(text: string): string {
	return typeof groupTheme?.bold === "function" ? groupTheme.bold(text) : text;
}

function isToolComponent(component: any): boolean {
	return typeof component?.toolCallId === "string" && typeof component?.toolName === "string";
}

/** Assistant turns with no visible answer text that issued tool calls belong to the tool run. */
function toolOnlyAssistantContent(component: any): any[] | null {
	const message = component?.lastMessage;
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return null;
	if (message.stopReason === "error" || message.stopReason === "aborted") return null;
	const content = message.content as any[];
	if (content.some((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim())) return null;
	return content.some((block) => block?.type === "toolCall") ? content : null;
}

function isGroupMember(component: any): boolean {
	return isToolComponent(component) || toolOnlyAssistantContent(component) !== null;
}

function hasThought(component: any): boolean {
	const content = toolOnlyAssistantContent(component);
	return Boolean(content?.some((block) => block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()));
}

function isRunning(tool: any): boolean {
	return !tool.result || Boolean(tool.isPartial);
}

function toolLabel(tool: any): string {
	const label = tool.toolDefinition?.label;
	return typeof label === "string" && label ? label : String(tool.toolName);
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function renderToolGroupSummary(members: any[], width: number): string[] {
	const tools = members.filter(isToolComponent);
	const running = tools.filter(isRunning);
	const failed = tools.filter((tool) => Boolean(tool.result?.isError)).length;
	const thoughts = members.filter(hasThought).length;

	const parts = [fg("muted", plural(tools.length, "tool call"))];
	if (thoughts > 0) parts.push(fg("muted", plural(thoughts, "thought")));
	if (failed > 0) parts.push(fg("error", `${failed} failed`));
	if (running.length > 0) parts.push(fg("muted", toolLabel(running[running.length - 1])));

	const dot = fg(running.length > 0 ? "dim" : failed > 0 ? "error" : "success", "●");
	const state = bold(fg("text", running.length > 0 ? "Running" : "Done"));
	const row = `${dot} ${state}${fg("dim", "(")}${parts.join(fg("dim", " · "))}${fg("dim", ")")}`;
	const rowWidth = getReasonixCollapsedRowWidth(width);
	const fitted = safeVisibleWidth(row) > rowWidth ? safeTruncateToWidth(row, rowWidth, fg("dim", " …")) : row;
	return ["", fitted];
}

const TREE_BRANCH = "├─ ";
const TREE_LAST = "└─ ";
const TREE_PIPE = "│  ";
const TREE_INDENT = "  ";
// Members keep their own status color but use a smaller dot than the group row.
const MEMBER_MARKER = "●";
const TREE_MEMBER_MARKER = "•";

function shrinkMemberMarker(line: string): string {
	return stripAnsi(line).startsWith(MEMBER_MARKER) ? line.replace(MEMBER_MARKER, TREE_MEMBER_MARKER) : line;
}

/** Each member's own collapsed rows, blank spacers and image payloads dropped, hung from the tree. */
function renderToolGroupTree(members: any[], width: number): string[] {
	const guideWidth = TREE_INDENT.length + TREE_BRANCH.length;
	const childWidth = Math.max(1, width - guideWidth);
	const blocks = members
		.map((member) => (member.render(childWidth) as string[])
			.filter((line) => !isImageRenderLine(line) && stripAnsi(line).trim().length > 0))
		.filter((block) => block.length > 0);
	const lines: string[] = [];
	blocks.forEach((block, blockIndex) => {
		const last = blockIndex === blocks.length - 1;
		block.forEach((line, lineIndex) => {
			const guide = lineIndex === 0 ? (last ? TREE_LAST : TREE_BRANCH) : (last ? "   " : TREE_PIPE);
			lines.push(`${TREE_INDENT}${fg("dim", guide)}${lineIndex === 0 ? shrinkMemberMarker(line) : line}`);
		});
	});
	// Members' own spacer rows were dropped above; restore one so the next turn does not touch the tree.
	if (lines.length > 0) lines.push("");
	return lines;
}

function pushLines(target: string[], lines: string[]): void {
	for (let i = 0; i < lines.length; i++) target.push(lines[i]);
}

/** Renders chat children in order, folding claudecode tool runs into summary rows. */
export function renderChatChildren(children: any[], width: number): string[] {
	const lines: string[] = [];
	const grouping = getPresentationDesign().toolCallStyle === "claudecode";
	let index = 0;
	while (index < children.length) {
		let end = index;
		if (grouping) while (end < children.length && isGroupMember(children[end])) end++;
		if (end === index) {
			pushLines(lines, children[index].render(width));
			index++;
			continue;
		}
		const members = children.slice(index, end);
		const tools = members.filter(isToolComponent);
		if (tools.length < MIN_GROUPED_TOOLS || tools.some((tool) => tool.expanded)) {
			for (const member of members) pushLines(lines, member.render(width));
		} else {
			pushLines(lines, renderToolGroupSummary(members, width));
			pushLines(lines, renderToolGroupTree(members, width));
		}
		index = end;
	}
	return lines;
}
