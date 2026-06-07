import type { Component } from "@earendil-works/pi-tui";
import {
  boxBorder,
  boxInsetDivider,
  boxLine,
  boxLineWithRight,
  boxWidth,
  boxInnerWidth,
} from "../tool-tags/common.js";
import { fgHex, isHexColor } from "../theme/ansi.js";
import { getThemeExtra } from "../theme/theme-extras.js";

export type MessageBlockOptions = {
  kind: string;
  title?: string;
  right?: string;
  body: (contentWidth: number) => string[];
  hasDivider?: boolean;
  icon?: string;
};

function formatMessageBlockTitle(theme: any, kind: string, title?: string, icon = "➔"): string {
  const rawTitle = title ? `${icon} ${kind} | ${title}` : `${icon} ${kind}`;
  const bashPromptColor = getThemeExtra(theme, "bashPromptColor");
  const coloredTitle = bashPromptColor && isHexColor(bashPromptColor)
    ? fgHex(theme, bashPromptColor, rawTitle)
    : theme.fg("bashMode", rawTitle);
  return typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
}

/**
 * Render a boxed message block.
 *
 * Returns only border/content lines with foreground styling.
 * Background is applied by the parent Box (all patched components extend
 * Box with customMessageBg bgFn), so this helper must NOT apply background
 * itself — that would create a double-background conflict.
 */
export function renderBoxedMessageBlock(
  theme: any,
  options: MessageBlockOptions,
): Component {
  const {
    kind,
    title,
    right,
    body,
    icon = "➔",
    hasDivider = true,
  } = options;

  let cache: { width: number; lines: string[] } | null = null;

  return {
    invalidate() { cache = null; },
    render(width: number): string[] {
      if (cache?.width === width) return cache.lines;

      const renderedWidth = boxWidth(width);
      const contentWidth = boxInnerWidth(renderedWidth);
      const titleLine = formatMessageBlockTitle(theme, kind, title, icon);

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

      cache = { width, lines };
      return lines;
    },
  };
}
