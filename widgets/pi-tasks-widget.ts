import { safeTruncateToWidth } from "../render-budget.js";
import { stripAnsi } from "../theme/ansi.js";

type ThemeLike = {
	fg?(color: string, text: string): string;
	bold?(text: string): string;
	strikethrough?(text: string): string;
};

type TuiLike = {
	terminal?: {
		columns?: number;
	};
};

type WidgetFactory = (tui: TuiLike, theme: ThemeLike) => any;

type SessionUiLike = {
	theme?: ThemeLike;
	setWidget?(key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void;
};

type TaskRow = {
	kind: "task";
	status: "active" | "running" | "completed" | "pending";
	id: string;
	text: string;
	suffix: string;
};

type ParsedLine =
	| { kind: "header"; text: string }
	| { kind: "overflow"; text: string }
	| TaskRow
	| { kind: "unknown"; text: string };

const PATCH_STATE = Symbol.for("pi-droid-styling.pi-tasks-widget.state");
const WRAPPED_FACTORY = Symbol.for("pi-droid-styling.pi-tasks-widget.factory");
const WRAPPED_COMPONENT = Symbol.for("pi-droid-styling.pi-tasks-widget.component");
const SPINNER_PATTERN = /[✳✴✵✶✷✸✹✺✻✼✽]/g;
const SPINNER_CHARS = "✳✴✵✶✷✸✹✺✻✼✽";
const TASK_ROW_PATTERN = /^\s*([✳✴✵✶✷✸✹✺✻✼✽✔◼◻])\s+#(\d+)\s+(.+)$/;
const BLOCKED_SUFFIX = " › blocked by ";
const WIDGET_ROW_PREFIX = "   ";

function color(theme: ThemeLike, colorName: string, text: string): string {
	return typeof theme?.fg === "function" ? theme.fg(colorName, text) : text;
}

function bold(theme: ThemeLike, text: string): string {
	return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

function strike(theme: ThemeLike, text: string): string {
	return typeof theme?.strikethrough === "function" ? theme.strikethrough(text) : text;
}

function normalizeWidgetLineForCache(line: string): string {
	return stripAnsi(line).replace(SPINNER_PATTERN, "●");
}

function parseTaskWidgetLine(line: string): ParsedLine {
	const text = stripAnsi(line).trimEnd();
	const headerMatch = text.match(/^●\s+(.+)$/);
	if (headerMatch) {
		return { kind: "header", text: headerMatch[1]!.replace(/\bin progress\b/g, "running") };
	}

	const overflowMatch = text.match(/^\s*…\s+and\s+\d+\s+more$/);
	if (overflowMatch) return { kind: "overflow", text: text.trim() };

	const taskMatch = text.match(TASK_ROW_PATTERN);
	if (!taskMatch) return { kind: "unknown", text };

	const icon = taskMatch[1]!;
	const status = SPINNER_CHARS.includes(icon)
		? "active"
		: icon === "✔"
			? "completed"
			: icon === "◼"
				? "running"
				: "pending";

	let body = taskMatch[3]!.trimEnd();
	let suffix = "";
	const suffixStart = body.indexOf(BLOCKED_SUFFIX);
	if (suffixStart >= 0) {
		suffix = body.slice(suffixStart);
		body = body.slice(0, suffixStart).trimEnd();
	}

	return {
		kind: "task",
		status,
		id: taskMatch[2]!,
		text: body,
		suffix,
	};
}

function splitStats(text: string): { body: string; stats: string } {
	const match = text.match(/^(.*?)(\s+\([^)]*\))$/);
	if (!match) return { body: text, stats: "" };
	return { body: match[1]!.trimEnd(), stats: match[2]! };
}

function renderHeader(theme: ThemeLike, text: string): string {
	const label = color(theme, "accent", bold(theme, "Tasks"));
	const separator = color(theme, "dim", " · ");
	return `${WIDGET_ROW_PREFIX}${label}${separator}${color(theme, "dim", text)}`;
}

function renderOverflow(theme: ThemeLike, text: string): string {
	return `${WIDGET_ROW_PREFIX}${color(theme, "dim", text.replace(/^…/, "⋯"))}`;
}

function renderTaskIcon(theme: ThemeLike, status: TaskRow["status"]): string {
	if (status === "completed") return color(theme, "success", "✓");
	if (status === "pending") return color(theme, "dim", "○");
	return color(theme, "accent", "●");
}

function renderTaskText(theme: ThemeLike, row: TaskRow): string {
	const { body, stats } = splitStats(row.text);
	if (row.status === "completed") return color(theme, "dim", strike(theme, body));
	if (row.status === "active") return `${color(theme, "accent", body)}${color(theme, "dim", stats)}`;
	if (row.status === "running") return `${body}${color(theme, "dim", stats)}`;
	return body;
}

function renderTaskRow(theme: ThemeLike, row: TaskRow, idWidth: number): string {
	const id = color(theme, "dim", `#${row.id.padStart(idWidth)}`);
	const icon = renderTaskIcon(theme, row.status);
	const text = renderTaskText(theme, row);
	const suffix = row.suffix ? color(theme, "dim", row.suffix) : "";
	return `${WIDGET_ROW_PREFIX}${icon} ${id}  ${text}${suffix}`;
}

export function stylePiTasksWidgetLines(lines: string[], theme: ThemeLike, width: number): string[] {
	const parsed = lines.map(parseTaskWidgetLine);
	const idWidth = parsed.reduce((max, line) => line.kind === "task" ? Math.max(max, line.id.length) : max, 1);
	const maxWidth = Math.max(1, Math.floor(width));

	return parsed.map((line) => {
		const rendered = line.kind === "header"
			? renderHeader(theme, line.text)
			: line.kind === "overflow"
				? renderOverflow(theme, line.text)
				: line.kind === "task"
					? renderTaskRow(theme, line, idWidth)
					: line.text;
		return safeTruncateToWidth(rendered, maxWidth, "…");
	});
}

function getRenderWidth(args: unknown[], tui: TuiLike): number {
	const first = args[0];
	if (typeof first === "number" && Number.isFinite(first)) return first;
	const columns = tui?.terminal?.columns;
	return typeof columns === "number" && Number.isFinite(columns) ? columns : 80;
}

function wrapTaskWidgetComponent(component: any, tui: TuiLike, theme: ThemeLike): any {
	if (!component || typeof component.render !== "function" || component[WRAPPED_COMPONENT]) return component;
	component[WRAPPED_COMPONENT] = true;
	const baseRender = component.render.bind(component);
	let cachedKey = "";
	let cachedLines: string[] | undefined;

	component.render = (...args: unknown[]) => {
		const lines = baseRender(...args);
		if (!Array.isArray(lines)) return lines;
		const width = getRenderWidth(args, tui);
		const cacheKey = `${width}\n${lines.map(normalizeWidgetLineForCache).join("\n")}`;
		if (cachedLines && cachedKey === cacheKey) return cachedLines;
		cachedKey = cacheKey;
		cachedLines = stylePiTasksWidgetLines(lines, theme, width);
		return cachedLines;
	};

	return component;
}

function wrapTaskWidgetFactory(factory: WidgetFactory): WidgetFactory {
	if ((factory as any)[WRAPPED_FACTORY]) return factory;
	const wrapped = ((tui: TuiLike, theme: ThemeLike) => wrapTaskWidgetComponent(factory(tui, theme), tui, theme)) as WidgetFactory;
	(wrapped as any)[WRAPPED_FACTORY] = true;
	return wrapped;
}

function styleStaticTaskWidgetLines(content: string[], theme: ThemeLike | undefined): string[] {
	return stylePiTasksWidgetLines(content, theme ?? {}, 80);
}

export function installPiTasksWidgetStyling(sessionUi: SessionUiLike): (() => void) | undefined {
	if (!sessionUi || typeof sessionUi.setWidget !== "function") return undefined;
	const host = sessionUi as SessionUiLike & { [PATCH_STATE]?: { dispose(): void } };
	if (host[PATCH_STATE]) return () => host[PATCH_STATE]?.dispose();

	const originalSetWidget = sessionUi.setWidget;
	const patchedSetWidget = function patchedPiTasksSetWidget(key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void {
		if (key !== "tasks" || content === undefined) {
			return originalSetWidget.call(sessionUi, key, content, options);
		}
		if (Array.isArray(content)) {
			return originalSetWidget.call(sessionUi, key, styleStaticTaskWidgetLines(content, sessionUi.theme), options);
		}
		if (typeof content === "function") {
			return originalSetWidget.call(sessionUi, key, wrapTaskWidgetFactory(content), options);
		}
		return originalSetWidget.call(sessionUi, key, content, options);
	};

	const state = {
		dispose() {
			if (sessionUi.setWidget === patchedSetWidget) sessionUi.setWidget = originalSetWidget;
			delete host[PATCH_STATE];
		},
	};

	host[PATCH_STATE] = state;
	sessionUi.setWidget = patchedSetWidget;
	return () => state.dispose();
}
