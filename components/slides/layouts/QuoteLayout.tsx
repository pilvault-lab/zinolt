import React from "react";
import type { LayoutRenderProps } from "@/lib/slide-layouts";

const BADGE_TYPE =
  "'AngelList', system-ui, -apple-system, sans-serif";

// Sane defaults — normal weight, comfortable leading, no negative tracking.
// The studio's typography controls override these on a per-slide basis.
const DEFAULT_FONT_SIZE = 130;
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_LINE_HEIGHT = 1.4;
const DEFAULT_LETTER_SPACING = 0;

export const QuoteLayout: React.FC<LayoutRenderProps> = ({
  values,
  typography,
}) => {
  const quote =
    values.quote || "A short, well-formed quote that anchors the slide.";

  const fontSize = typography?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontWeight = typography?.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const lineHeight = typography?.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const letterSpacing = typography?.letterSpacing ?? DEFAULT_LETTER_SPACING;

  return (
    // 85%-wide block, beautifully framed against the badge. BadgeShell's
    // outer flex provides 3rem padding; this wrapper just sets the editorial
    // left margin / max-width. Color inherits from BadgeShell so the type
    // adapts (light card → dark text, dark card → light text).
    <div
      style={{
        width: "85%",
        maxWidth: "85%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        color: "currentColor",
      }}
    >
      <p
        style={{
          fontFamily: BADGE_TYPE,
          fontSize,
          fontWeight,
          lineHeight,
          letterSpacing: `${letterSpacing}em`,
          color: "currentColor",
          margin: 0,
          overflowWrap: "break-word",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          textRendering: "optimizeLegibility",
        }}
      >
        {quote}
      </p>
    </div>
  );
};
