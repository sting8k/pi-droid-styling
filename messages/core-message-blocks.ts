import { Markdown } from "@earendil-works/pi-tui";
import { renderBoxedMessageBlock } from "./boxed-message-block.js";

const PATCH_FLAG = "__droidCoreMessageBlocksPatched__";

let cachedTheme: any = null;

export function setCoreMessageBlockTheme(theme: any): void {
	cachedTheme = theme;
}

type ComponentCtor = { prototype?: any };

export function installCoreMessageBlockStyling(ctors: {
	CompactionSummaryMessageComponent?: ComponentCtor;
	SkillInvocationMessageComponent?: ComponentCtor;
	BranchSummaryMessageComponent?: ComponentCtor;
	CustomMessageComponent?: ComponentCtor;
}): void {
	const globalState = globalThis as Record<string, unknown>;
	if (globalState[PATCH_FLAG]) return;
	globalState[PATCH_FLAG] = true;

	patchCompaction(ctors.CompactionSummaryMessageComponent);
	patchSkill(ctors.SkillInvocationMessageComponent);
	patchBranch(ctors.BranchSummaryMessageComponent);
	patchCustomMessage(ctors.CustomMessageComponent);
}

function createMarkdownBody(text: string, markdownTheme: any, theme: any): (contentWidth: number) => string[] {
	const md = new Markdown(text || "", 0, 0, markdownTheme, {
		color: (t: string) => theme.fg("customMessageText", t),
	});
	return (contentWidth: number) => md.render(contentWidth);
}

function patchCompaction(ctor?: ComponentCtor): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const base = proto.updateDisplay;
	proto.updateDisplay = function patchedCompactionUpdateDisplay(this: any) {
		const theme = cachedTheme;
		if (!theme || this.message == null) return base.call(this);

		const tokensBefore = this.message.tokensBefore;
		if (tokensBefore == null) return base.call(this);

		this.clear();

		const expanded = Boolean(this.expanded);
		const summary = typeof this.message.summary === "string" ? this.message.summary : "";
		const markdownTheme = this.markdownTheme;

		const body = expanded && summary && markdownTheme
			? createMarkdownBody(summary, markdownTheme, theme)
			: () => [];

		const tokenStr = tokensBefore.toLocaleString();

		try {
			const block = renderBoxedMessageBlock(theme, {
				kind: "Compaction",
				title: `${tokenStr} tokens`,
				right: expanded ? undefined : "(Ctrl+O to expand)",
				body,

				hasDivider: expanded,
			});
			this.addChild(block);
		} catch {
			return base.call(this);
		}
	};
}

function patchSkill(ctor?: ComponentCtor): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const base = proto.updateDisplay;
	proto.updateDisplay = function patchedSkillUpdateDisplay(this: any) {
		const theme = cachedTheme;
		if (!theme || this.skillBlock == null) return base.call(this);

		const skillName = this.skillBlock.name;
		if (!skillName) return base.call(this);

		this.clear();

		const expanded = Boolean(this.expanded);
		const content = typeof this.skillBlock.content === "string" ? this.skillBlock.content : "";
		const markdownTheme = this.markdownTheme;

		const body = expanded && content && markdownTheme
			? createMarkdownBody(content, markdownTheme, theme)
			: () => [];

		try {
			const block = renderBoxedMessageBlock(theme, {
				kind: "Skill",
				title: skillName,
				right: expanded ? undefined : "(Ctrl+O to expand)",
				body,

				hasDivider: expanded,
			});
			this.addChild(block);
		} catch {
			return base.call(this);
		}
	};
}

function patchBranch(ctor?: ComponentCtor): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.updateDisplay !== "function") return;

	const base = proto.updateDisplay;
	proto.updateDisplay = function patchedBranchUpdateDisplay(this: any) {
		const theme = cachedTheme;
		if (!theme) return base.call(this);

		this.clear();

		const expanded = Boolean(this.expanded);
		const summary = typeof this.message?.summary === "string" ? this.message.summary : "";
		const markdownTheme = this.markdownTheme;

		const body = expanded && summary && markdownTheme
			? createMarkdownBody(summary, markdownTheme, theme)
			: () => [];

		try {
			const block = renderBoxedMessageBlock(theme, {
				kind: "Branch",
				right: expanded ? undefined : "(Ctrl+O to expand)",
				body,

				hasDivider: expanded,
			});
			this.addChild(block);
		} catch {
			return base.call(this);
		}
	};
}

function patchCustomMessage(ctor?: ComponentCtor): void {
	const proto = ctor?.prototype;
	if (!proto || typeof proto.rebuild !== "function") return;

	const base = proto.rebuild;
	proto.rebuild = function patchedCustomMessageRebuild(this: any) {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(this.message, { expanded: this._expanded }, cachedTheme);
				if (component) {
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		// Default rendering: use boxed message block
		const theme = cachedTheme;
		if (!theme) return base.call(this);

		// Extract text content
		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else if (Array.isArray(this.message.content)) {
			text = this.message.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");
		} else {
			text = "";
		}

		const customType = this.message.customType || "Custom";
		const markdownTheme = this.markdownTheme;

		const body = text && markdownTheme
			? createMarkdownBody(text, markdownTheme, theme)
			: () => [];

		try {
			const block = renderBoxedMessageBlock(theme, {
				kind: "Custom",
				title: customType,
				body,

				hasDivider: Boolean(text),
			});
			this.customComponent = block;
			this.addChild(block);
		} catch {
			return base.call(this);
		}
	};
}
