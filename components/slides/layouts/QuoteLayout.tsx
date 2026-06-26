import React from "react";
import type { LayoutRenderProps } from "@/lib/slide-layouts";

// All badge typography sits in Tenor Sans. Sizes are tuned to the
// 900-pixel-wide source div that BadgeShell rasterises into the card face;
// the editorial proportions stay the same once mapped onto the 4K export.
const BADGE_TYPE = "'Tenor Sans', Helvetica, Arial, sans-serif";

export const QuoteLayout: React.FC<LayoutRenderProps> = ({ values }) => {
  const quote =
    values.quote || "A short, well-formed quote that anchors the slide.";

  return (
    // 80%-wide block, beautifully centered as a unit within the card.
    // BadgeShell's outer flex container handles vertical centering; this
    // wrapper just enforces the editorial side margins and left rhythm.
    <div
      style={{
        width: "80%",
        maxWidth: "80%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        gap: 32,
      }}
    >
      {/* Top accent — sharp, intentional micro-label. */}
      <span
        style={{
          fontFamily: BADGE_TYPE,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(26,26,26,0.6)",
        }}
      >
        From the Studio
      </span>

      {/* Hero quote — editorial exhibition label: large soft-charcoal type,
          generous line-height, left-aligned within the centred block, with
          natural wrapping inside the 80% container. */}
      <p
        style={{
          fontFamily: BADGE_TYPE,
          // Sized in source-div pixels so it lands at a confident hero scale
          // when the 900-wide card texture maps onto the rendered output —
          // ~60px in 1080 exports, much larger at 4K. Reads as a real
          // exhibition-label quote at every preview & export size.
          fontSize: 80,
          lineHeight: 1.5,
          letterSpacing: "0.005em",
          fontWeight: 700,
          color: "#1A1A1A",
          margin: 0,
          overflowWrap: "break-word",
        }}
      >
        {quote}
      </p>
    </div>
  );
};
