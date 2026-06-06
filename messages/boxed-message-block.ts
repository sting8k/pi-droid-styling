import type { Component } from "@earendil-works/pi-tui";
import {
  boxBgLines,
  boxBorder,
  boxInsetDivider,
  boxLine,
  boxLineWithRight,
  boxWidth,
  boxInnerWidth,
} from "../tool-tags/common.js";
import { fgHex, isHexColor } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";
import { safeVisibleWidth } from "../render-budget.js";

export type MessageBlockTone = "info" | "success" | "error" | "pending";

export type MessageBlockOptions = {
  kind: string;
  title?: string;
  right?: string;
  body: (contentWidth: number) => string[];
  bgName?: string;
  hasDivider?: boolean;
  tone?: MessageBlockTone;
};

function formatMessageBlockTitle(theme: any, kind: string, title?: string): string {
  const rawTitle = title ? `➔ ${kind} | ${title}` : `➔ ${kind}`;
  const bashPromptColor = getThemeExtra(theme, "bashPromptColor");
  const coloredTitle = bashPromptColor && isHexColor(bashPromptColor)
    ? fgHex(theme, bashPromptColor, rawTitle)
    : theme.fg("bashMode", rawTitle);
  return typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
}

export function renderBoxedMessageBlock(
  theme: any,
  options: MessageBlockOptions,
): Component {
  const {
    kind,
    title,
    right,
    body,
    bgName = "customMessageBg",
    hasDivider = true,
    tone = "info",
  } = options;

  let cache: { width: number; lines: string[] } | null = null;

  return {
    invalidate() { cache = null; },
    render(width: number): string[] {
      if (cache?.width === width) return cache.lines;

      const renderedWidth = boxWidth(width);
      const contentWidth = boxInnerWidth(renderedWidth);
      const titleLine = formatMessageBlockTitle(theme, kind, title);

      const lines: string[] = [];
      lines.push(boxBorder(theme, "┌", "┐", renderedWidth));

      if (right) {
        const rightStyled = theme.fg("dim", right);
        lines.push(boxLineWithRight(theme, titleLine, rightStyled, renderedWidth));
      } else {
        lines.push(boxLine(theme, titleLine, renderedWidth));
      }

      if (hasDivider) {
        lines.push(boxInsetDivider(theme, renderedWidth));
      }

      const bodyLines = body(contentWidth);
      for (const line of bodyLines) {
        lines.push(boxLine(theme, line, renderedWidth));
      }

      lines.push(boxBorder(theme, "└", "┘", renderedWidth));

      const rendered = boxBgLines(theme, lines, bgName);
      cache = { width, lines: rendered };
      return rendered;
    },
  };
}
