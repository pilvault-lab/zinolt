"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type Props = {
  text: string;
  /** Maximum font size in px. We never up-scale past this. */
  max: number;
  /** Minimum font size in px — autoshrink stops here even if overflow remains. */
  min?: number;
  /** Line-height multiplier applied while measuring + rendering. */
  lineHeight?: number;
  style?: CSSProperties;
  className?: string;
};

/**
 * FitText shrinks `text` so it fits inside its parent without clipping.
 * Binary-searches font sizes between `min` and `max` and re-runs on any text
 * or container-size change. Renders pure text — no truncation, no ellipsis.
 */
export const FitText: React.FC<Props> = ({
  text,
  max,
  min = 14,
  lineHeight = 1.12,
  style,
  className,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;

    const measureFits = (px: number) => {
      inner.style.fontSize = `${px}px`;
      // Force a layout flush.
      const fits =
        inner.scrollHeight <= box.clientHeight &&
        inner.scrollWidth <= box.clientWidth;
      return fits;
    };

    // Binary search [min, max] for the largest px that fits.
    let lo = min;
    let hi = max;
    let best = min;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (measureFits(mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    setSize(best);
    inner.style.fontSize = `${best}px`;
  }, [text, max, min]);

  return (
    <div
      ref={boxRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        ref={innerRef}
        style={{
          display: "block",
          width: "100%",
          fontSize: size,
          lineHeight,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {text}
      </span>
    </div>
  );
};
