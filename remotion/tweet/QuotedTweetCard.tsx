import React from "react";
import { Img } from "remotion";
import { TweetText } from "./TweetText";
import { TweetMediaGrid } from "./TweetMediaGrid";
import type { QuotedTweet } from "@/lib/tweet-fetch";
import type { CardTheme } from "./types";

interface QuotedTweetCardProps {
  quote: QuotedTweet;
  theme: CardTheme;
  outerTextSize: number;
  showVerifiedBadge: boolean;
  forRender: boolean;
}

const VerifiedBadge: React.FC<{ size: number }> = ({ size }) => (
  <svg
    viewBox="0 0 22 22"
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      display: "inline-block",
      verticalAlign: "-0.15em",
      marginLeft: 3,
      marginRight: 3,
    }}
    aria-hidden
  >
    <path
      fill="#1D9BF0"
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
    />
  </svg>
);

function formatCompactDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

export const QuotedTweetCard: React.FC<QuotedTweetCardProps> = ({
  quote,
  theme,
  outerTextSize,
  showVerifiedBadge,
  forRender,
}) => {
  const bg =
    theme === "dark"
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(255, 255, 255, 0.4)";
  const border =
    theme === "dark"
      ? "1px solid rgba(255, 255, 255, 0.12)"
      : "1px solid rgba(15, 20, 25, 0.06)";
  const ink = theme === "dark" ? "#FFFFFF" : "#0F1419";
  const muted = theme === "dark" ? "rgba(255, 255, 255, 0.72)" : "#536471";
  const avatarFallback = theme === "dark" ? "#22303C" : "#EFF3F4";

  const textSize = Math.round(outerTextSize * 0.72);
  const date = formatCompactDate(quote.createdAt);

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 20px",
        borderRadius: 16,
        backgroundColor: bg,
        border,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        {quote.author.avatarUrl ? (
          <Img
            src={quote.author.avatarUrl}
            onError={() => {
              /* swallow — missing avatar doesn't fail the render */
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: avatarFallback,
              flexShrink: 0,
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            fontSize: 16,
            lineHeight: 1.2,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: ink, fontWeight: 700 }}>
            {quote.author.name}
          </span>
          {showVerifiedBadge && quote.author.verified ? (
            <VerifiedBadge size={16} />
          ) : null}
          <span style={{ color: muted, marginLeft: 6 }}>
            @{quote.author.handle}
          </span>
          {date ? (
            <span style={{ color: muted, marginLeft: 6 }}>· {date}</span>
          ) : null}
        </div>
      </div>

      {quote.text ? (
        <div style={{ marginTop: 10 }}>
          <TweetText text={quote.text} fontSize={textSize} color={ink} />
        </div>
      ) : null}

      {quote.media.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <TweetMediaGrid media={quote.media} forRender={forRender} />
        </div>
      ) : null}
    </div>
  );
};
