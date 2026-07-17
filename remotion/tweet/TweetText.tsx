import React from "react";
import { Img } from "remotion";
import { splitTwemoji } from "@/lib/twemoji";

// Absorb 404s so a missing emoji doesn't cancel the whole render. Remotion's
// default onError calls cancelRender; supplying our own turns the failure
// into "just don't render this emoji". Unicode moves faster than the twemoji
// asset packs, so we always want to degrade gracefully rather than fail.
const swallowImgError = () => {
  /* intentionally empty */
};

export const TweetText: React.FC<{
  text: string;
  fontSize: number;
  color: string;
}> = ({ text, fontSize, color }) => {
  const lines = text.split("\n");
  return (
    <div
      style={{
        fontSize,
        color,
        lineHeight: 1.35,
        letterSpacing: -0.2,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, li) => (
        <React.Fragment key={li}>
          {splitTwemoji(line).map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <Img
                key={i}
                src={seg.url}
                onError={swallowImgError}
                style={{
                  height: "1em",
                  width: "1em",
                  verticalAlign: "-0.15em",
                  display: "inline-block",
                  margin: "0 0.05em",
                }}
              />
            ),
          )}
          {li < lines.length - 1 ? <br /> : null}
        </React.Fragment>
      ))}
    </div>
  );
};
