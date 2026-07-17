import React from "react";
import { Img } from "remotion";
import { TweetText } from "./TweetText";
import type { CardIdentity, CardTheme } from "./types";
import type { FetchedTweet } from "@/lib/tweet-fetch";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function bucketCaptionSize(chars: number): number {
  if (chars <= 60) return 68;
  if (chars <= 120) return 56;
  if (chars <= 200) return 44;
  if (chars <= 280) return 36;
  return 32;
}

const VerifiedBadge: React.FC<{ size: number; color: string }> = ({
  size,
  color,
}) => (
  <svg
    viewBox="0 0 22 22"
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      display: "inline-block",
      verticalAlign: "-0.15em",
      marginLeft: 4,
    }}
    aria-hidden
  >
    <path
      fill={color}
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
    />
  </svg>
);

export type TweetCaptionBlockProps = {
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  showVerifiedBadge: boolean;
  widthPx: number;
  fontScale: number;
  captionScale: number;
};

export const TweetCaptionBlock: React.FC<TweetCaptionBlockProps> = ({
  tweet,
  identity,
  theme,
  showVerifiedBadge,
  widthPx,
  fontScale,
  captionScale,
}) => {
  const ink = theme === "dark" ? "#FFFFFF" : "#0A0A0A";
  const muted =
    theme === "dark" ? "rgba(255,255,255,0.72)" : "rgba(15,20,25,0.6)";
  // Subtle shadow keeps text legible over the blurred-video background even
  // when a bright frame flashes through.
  const textShadow =
    theme === "dark"
      ? "0 2px 12px rgba(0,0,0,0.55)"
      : "0 1px 6px rgba(255,255,255,0.4)";

  const baseSize = bucketCaptionSize(tweet.text.length);
  const textSize = Math.round(baseSize * fontScale * captionScale);
  const avatarSize = Math.round(64 * captionScale);
  const nameSize = Math.round(26 * captionScale);
  const handleSize = Math.round(20 * captionScale);

  return (
    <div
      style={{
        width: widthPx,
        maxWidth: "100%",
        fontFamily: FONT_STACK,
        color: ink,
        textShadow,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          marginBottom: Math.round(20 * captionScale),
        }}
      >
        {identity.avatarUrl ? (
          <Img
            src={identity.avatarUrl}
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            }}
          />
        ) : (
          <div
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: "50%",
              backgroundColor: theme === "dark" ? "#334155" : "#CBD5E1",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: nameSize,
              lineHeight: 1.15,
              display: "flex",
              alignItems: "center",
              color: ink,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {identity.name}
            </span>
            {showVerifiedBadge && identity.verified ? (
              <VerifiedBadge size={Math.round(nameSize * 0.9)} color="#1D9BF0" />
            ) : null}
          </div>
          <div
            style={{
              color: muted,
              fontSize: handleSize,
              lineHeight: 1.3,
              fontWeight: 500,
            }}
          >
            @{identity.handle}
          </div>
        </div>
      </div>

      <TweetText text={tweet.text} fontSize={textSize} color={ink} />
    </div>
  );
};
