import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { BoxEditor } from "./editor/box-editor.js";
import { installAssistantMessagePrefix } from "./messages/assistant-prefix.js";
import { installUserMessagePrefix } from "./messages/user-prefix.js";
import { installRenderThrottle } from "./render-throttle.js";
import { setFullTheme } from "./theme-extras.js";
import { installCompactToolSpacing, setToolSpacingTheme } from "./tool-tags/compact-tool-spacing.js";
import { installDefaultBadge, setDefaultBadgeTheme } from "./tool-tags/default-badge.js";
import { installLoaderAccent } from "./tool-tags/loader-accent.js";
import { registerToolCallTags } from "./tool-tags/register-tool-call-tags.js";
import { installTuiPadding } from "./tui-padding.js";
import { virtualizeChatContainer } from "./virtualize-chat.js";

export default function (pi: ExtensionAPI) {
	installCompactToolSpacing();
	installDefaultBadge();
	installLoaderAccent();

	pi.on("session_start", (_event, ctx) => {
		registerToolCallTags(pi);

		// No setTheme() call — use whatever theme is selected in settings
		installAssistantMessagePrefix(ctx.ui.theme);
		installUserMessagePrefix(ctx.ui.theme);
		setFullTheme(ctx.ui.theme);
		setDefaultBadgeTheme(ctx.ui.theme);
		setToolSpacingTheme(ctx.ui.theme);

		ctx.ui.setEditorComponent((tui, theme, kb) => {
			installRenderThrottle(tui as any);
			virtualizeChatContainer(tui as any);
			installTuiPadding(tui as any);
			return new BoxEditor(tui, theme, kb, ctx.ui.theme ?? theme);
		});
	});
}
