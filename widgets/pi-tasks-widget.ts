import { safeTruncateToWidth } from "../render-budget.js";
import type { TasksWidgetStyle } from "../config.js";
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
	terminal?: { columns?: number };
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

// Upstream pi-tasks renders trailing stats as a parenthesized cluster:
//   (2m 49s · ↑ 4.1k ↓ 1.2k)   |   (2m 49s)   |   (1h 3m)
// We keep only the elapsed time (dim) and drop the token arrows.
const TIME_INNER_PATTERN = /\d+s|\d+m(?: \d+s)?|\d+h(?: \d+m)?/;
const TOKEN_ARROW_PATTERN = /[↑↓]\s+\d+(?:\.\d+)?k?/;
const TASK_STATS_PATTERN = /\s+\(([^)]*)\)$/;

function splitStats(text: string): { body: string; time: string; stats: string } {
	const m = text.match(TASK_STATS_PATTERN);
	if (!m) return { body: text, time: "", stats: "" };
	const body = text.slice(0, m.index).trimEnd();
	const inner = m[1]!.trim();
	const dotIdx = inner.indexOf("·");
	if (dotIdx >= 0) {
		const left = inner.slice(0, dotIdx).trim();
		const right = inner.slice(dotIdx + 1).trim();
		if (TIME_INNER_PATTERN.test(left) && TOKEN_ARROW_PATTERN.test(right)) {
			return { body, time: left, stats: "" };
		}
	} else if (TIME_INNER_PATTERN.test(inner)) {
		return { body, time: inner, stats: "" };
	}
	// Not a metrics cluster: keep the raw parenthetical as generic stats.
	return { body, time: "", stats: m[0] };
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
	const { body, time, stats } = splitStats(row.text);
	const timeStyled = time ? color(theme, "dim", ` · ${time}`) : "";
	const statsStyled = stats ? color(theme, "dim", stats) : "";
	if (row.status === "completed") return `${color(theme, "dim", strike(theme, body))}${statsStyled}${timeStyled}`;
	if (row.status === "active") return `${color(theme, "accent", body)}${statsStyled}${timeStyled}`;
	if (row.status === "running") return `${body}${statsStyled}${timeStyled}`;
	return `${body}${statsStyled}${timeStyled}`;
}

function renderTaskRow(theme: ThemeLike, row: TaskRow, idWidth: number): string {
	const id = color(theme, "dim", `#${row.id.padStart(idWidth)}`);
	const icon = renderTaskIcon(theme, row.status);
	const text = renderTaskText(theme, row);
	const suffix = row.suffix ? color(theme, "dim", row.suffix) : "";
	return `${WIDGET_ROW_PREFIX}${icon} ${id}  ${text}${suffix}`;
}

function visibleWidth(s: string): number {
	return stripAnsi(s).length;
}

function parseOverflowCount(parsed: ParsedLine[]): number {
	const ov = parsed.find((p): p is { kind: "overflow"; text: string } => p.kind === "overflow");
	if (!ov) return 0;
	const m = ov.text.match(/(\d+)\s+more/);
	return m ? Number(m[1]) : 0;
}

function pickCurrentTask(tasks: TaskRow[]): TaskRow | undefined {
	return tasks.find((t) => t.status === "running") ?? tasks.find((t) => t.status === "active");
}

function renderCompactLine(parsed: ParsedLine[], theme: ThemeLike, width: number): string[] {
	// The tasks widget sits above the editor at full terminal width; assume at
	// least 100 cols so task names are not truncated aggressively on wide terms.
	const renderWidth = Math.max(width, 100);
	const tasks = parsed.filter((p): p is TaskRow => p.kind === "task");
	const overflowN = parseOverflowCount(parsed);
	const total = tasks.length + overflowN;
	const label = `${WIDGET_ROW_PREFIX}${color(theme, "accent", "●")} ${color(theme, "accent", bold(theme, "Tasks"))}`;

	if (tasks.length === 0 && overflowN === 0) {
		return [`${label}${color(theme, "dim", " · idle")}`];
	}

	const completed = tasks.filter((t) => t.status === "completed").length;
	const blocked = tasks.filter((t) => Boolean(t.suffix)).length;
	const current = pickCurrentTask(tasks);
	const allDone = completed === total && total > 0;

	const tailParts: string[] = [];
	if (allDone) {
		tailParts.push(color(theme, "success", " done"));
	} else if (!current) {
		tailParts.push(color(theme, "dim", " idle"));
	}
	tailParts.push(color(theme, "dim", `  (${completed}/${total})`));
	if (blocked > 0) tailParts.push(color(theme, "dim", `  ${blocked} blocked`));
	const tail = tailParts.join("");

	if (!current || allDone) {
		return [`${label}${tail}`];
	}

	const marker = color(theme, "accent", bold(theme, "› "));
	const spacer = " ";
	// Drop token arrows; keep time (same dim as the counts) so the compact line stays glanceable.
	const { body: bodyNoMetrics, time } = splitStats(current.text);
	const timeStyled = time ? color(theme, "dim", ` · ${time}`) : "";
	const timeWidth = visibleWidth(timeStyled);
	const fixedWidth = visibleWidth(label) + visibleWidth(spacer) + visibleWidth(marker) + visibleWidth(tail);
	const budget = renderWidth - fixedWidth;
	// Need room for `› ` + at least one body char (+ optional time). Otherwise
	// drop the current-task segment and keep label + counts (never overflow).
	if (budget < 1 + timeWidth) {
		const base = `${label}${tail}`;
		return visibleWidth(base) > renderWidth ? [safeTruncateToWidth(base, renderWidth, "…")] : [base];
	}
	let body = bodyNoMetrics;
	const bodyBudget = budget - timeWidth;
	if (visibleWidth(body) > bodyBudget) {
		body = safeTruncateToWidth(body, Math.max(1, bodyBudget), "…");
	}
	return [`${label}${spacer}${marker}${body}${timeStyled}${tail}`];
}

export function stylePiTasksWidgetLines(lines: string[], theme: ThemeLike, width: number, style: TasksWidgetStyle = "default"): string[] {
	if (style === "compact") {
		return renderCompactLine(lines.map(parseTaskWidgetLine), theme, Math.max(1, Math.floor(width)));
	}
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

function wrapTaskWidgetComponent(component: any, tui: TuiLike, theme: ThemeLike, style: TasksWidgetStyle): any {
	if (!component || typeof component.render !== "function") return component;
	const meta = component[WRAPPED_COMPONENT];
	if (meta && meta.style === style) return component;
	const baseRender = (meta ? meta.baseRender : component.render.bind(component));
	component[WRAPPED_COMPONENT] = { baseRender, style };
	let cachedKey = "";
	let cachedLines: string[] | undefined;

	component.render = (...args: unknown[]) => {
		const lines = baseRender(...args);
		if (!Array.isArray(lines)) return lines;
		const width = getRenderWidth(args, tui);
		const cacheKey = `${width}\n${style}\n${lines.map(normalizeWidgetLineForCache).join("\n")}`;
		if (cachedLines && cachedKey === cacheKey) return cachedLines;
		cachedKey = cacheKey;
		cachedLines = stylePiTasksWidgetLines(lines, theme, width, style);
		return cachedLines;
	};

	return component;
}

function wrapTaskWidgetFactory(factory: WidgetFactory, style: TasksWidgetStyle): WidgetFactory {
	const meta = (factory as any)[WRAPPED_FACTORY];
	if (meta && meta.style === style) return factory;
	const base = meta ? meta.base : factory;
	const wrapped = ((tui: TuiLike, theme: ThemeLike) => wrapTaskWidgetComponent(base(tui, theme), tui, theme, style)) as WidgetFactory;
	(wrapped as any)[WRAPPED_FACTORY] = { base, style };
	return wrapped;
}

function styleStaticTaskWidgetLines(content: string[], theme: ThemeLike | undefined, style: TasksWidgetStyle, width = 80): string[] {
	return stylePiTasksWidgetLines(content, theme ?? {}, width, style);
}

export function installPiTasksWidgetStyling(sessionUi: SessionUiLike, style: TasksWidgetStyle = "default"): (() => void) | undefined {
	if (!sessionUi || typeof sessionUi.setWidget !== "function") return undefined;
	const host = sessionUi as SessionUiLike & { [PATCH_STATE]?: { dispose(): void } };
	if (host[PATCH_STATE]) return () => host[PATCH_STATE]?.dispose();

	const originalSetWidget = sessionUi.setWidget;
	const patchedSetWidget = function patchedPiTasksSetWidget(key: string, content: string[] | WidgetFactory | undefined, options?: unknown): void {
		if (key !== "tasks" || content === undefined) {
			return originalSetWidget.call(sessionUi, key, content, options);
		}
		if (Array.isArray(content)) {
			const cols = sessionUi.terminal?.columns;
			const width = typeof cols === "number" && Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 80;
			return originalSetWidget.call(sessionUi, key, styleStaticTaskWidgetLines(content, sessionUi.theme, style, width), options);
		}
		if (typeof content === "function") {
			return originalSetWidget.call(sessionUi, key, wrapTaskWidgetFactory(content, style), options);
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
