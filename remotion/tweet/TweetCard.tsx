import React, { useEffect, useRef, useState } from "react";
import { Img, continueRender, delayRender } from "remotion";
import { TweetText } from "./TweetText";
import type { TweetCardProps } from "./types";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function bucketFontSize(chars: number): number {
  if (chars <= 60) return 64;
  if (chars <= 120) return 52;
  if (chars <= 200) return 40;
  if (chars <= 280) return 32;
  return 28;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const t = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const ds = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${t} · ${ds}`;
}

function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
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
      marginLeft: 4,
    }}
    aria-hidden
  >
    <path
      fill="#1D9BF0"
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
    />
  </svg>
);

const StatIcon: React.FC<{ kind: "reply" | "retweet" | "like" }> = ({
  kind,
}) => {
  const paths: Record<string, string> = {
    reply:
      "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
    retweet:
      "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
    like: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  };
  return (
    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }} aria-hidden>
      <path fill="currentColor" d={paths[kind]} />
    </svg>
  );
};

export const TweetCard: React.FC<TweetCardProps> = ({
  tweet,
  identity,
  theme,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  inCardMedia,
  maxWidthPx,
  cornerRadius,
  fontScale = 1,
}) => {
  const bg = theme === "dark" ? "#15202B" : "#FFFFFF";
  const ink = theme === "dark" ? "#E7E9EA" : "#0F1419";
  const muted = theme === "dark" ? "#71767B" : "#536471";

  const baseSize = bucketFontSize(tweet.text.length);
  const textSize = Math.round(baseSize * fontScale);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [handle] = useState(() => delayRender("TweetCard measure"));

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = cardRef.current;
      const parent = el?.parentElement;
      if (!el || !parent) {
        continueRender(handle);
        return;
      }
      const parentH = parent.getBoundingClientRect().height;
      const cardH = el.getBoundingClientRect().height;
      const limit = parentH * 0.7;
      if (cardH > limit && limit > 0) {
        setScale(Math.max(0.6, limit / cardH));
      }
      continueRender(handle);
    });
    return () => cancelAnimationFrame(raf);
  }, [handle, tweet.text, tweet.media.length]);

  return (
    <div
      ref={cardRef}
      style={{
        maxWidth: maxWidthPx,
        width: "100%",
        backgroundColor: bg,
        borderRadius: cornerRadius,
        padding: "28px 32px",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.25)",
        fontFamily: FONT_STACK,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {identity.avatarUrl ? (
          <Img
            src={identity.avatarUrl}
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              backgroundColor: theme === "dark" ? "#22303C" : "#EFF3F4",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              color: ink,
              fontWeight: 800,
              fontSize: 22,
              lineHeight: 1.15,
              display: "flex",
              alignItems: "center",
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
              <VerifiedBadge size={20} />
            ) : null}
          </div>
          <div style={{ color: muted, fontSize: 18, lineHeight: 1.3 }}>
            @{identity.handle}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <TweetText text={tweet.text} fontSize={textSize} color={ink} />
      </div>

      {inCardMedia && tweet.media.length > 0 ? (
        <div
          style={{
            marginTop: 20,
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 12,
            backgroundColor: theme === "dark" ? "#22303C" : "#EFF3F4",
          }}
        />
      ) : null}

      {showTimestamp ? (
        <div
          style={{
            marginTop: 18,
            color: muted,
            fontSize: 16,
          }}
        >
          {formatTimestamp(tweet.createdAt)}
        </div>
      ) : null}

      {showStats ? (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 32,
            color: muted,
            fontSize: 15,
            alignItems: "center",
            paddingTop: 12,
            borderTop:
              theme === "dark" ? "1px solid #2F3336" : "1px solid #EFF3F4",
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <StatIcon kind="reply" /> {compactNumber(tweet.stats.replies)}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <StatIcon kind="retweet" /> {compactNumber(tweet.stats.retweets)}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <StatIcon kind="like" /> {compactNumber(tweet.stats.likes)}
          </div>
        </div>
      ) : null}
    </div>
  );
};
