import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { TweetCard } from "./TweetCard";
import type {
  Aspect,
  BackgroundConfig,
  CardIdentity,
  CardTheme,
} from "./types";
import type { FetchedTweet } from "@/lib/tweet-fetch";

const CARD_MAX_WIDTH: Record<Aspect, number> = {
  "9x16": 900,
  "1x1": 900,
  "16x9": 720,
};

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:|\/)/i.test(s);
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(p);

const Background: React.FC<{
  bg: BackgroundConfig;
  forRender: boolean;
}> = ({ bg, forRender }) => {
  if (bg.kind === "solid") {
    return <AbsoluteFill style={{ backgroundColor: bg.color }} />;
  }
  if (bg.kind === "gradient") {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`,
        }}
      />
    );
  }
  const src = resolveSrc(bg.src);
  if (!src) return <AbsoluteFill style={{ backgroundColor: "#000" }} />;
  return (
    <AbsoluteFill>
      {forRender ? (
        <MediaVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </AbsoluteFill>
  );
};

export type InCardProps = {
  aspect: Aspect;
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  background: BackgroundConfig;
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  fontScale: number;
  cardScale: number;
  centerY: number;
  forRender: boolean;
};

export const inCardDefaultProps: InCardProps = {
  aspect: "9x16",
  tweet: {
    id: "0",
    text: "Paste a tweet URL to preview.",
    author: { name: "Zinolt", handle: "zinolt", avatarUrl: "", verified: false },
    createdAt: new Date().toISOString(),
    stats: { likes: 0, retweets: 0, replies: 0 },
    media: [],
  },
  identity: {
    name: "Zinolt",
    handle: "zinolt",
    avatarUrl: "/pages/zincad/avatar.jpg",
    verified: false,
  },
  theme: "dark",
  background: {
    kind: "gradient",
    angle: 135,
    from: "#0f172a",
    to: "#1e293b",
  },
  showStats: false,
  showTimestamp: true,
  showVerifiedBadge: false,
  fontScale: 1,
  cardScale: 1,
  centerY: 0.5,
  forRender: false,
};

export const InCardComposition: React.FC<InCardProps> = ({
  aspect,
  tweet,
  identity,
  theme,
  background,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  fontScale,
  cardScale,
  centerY,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const translate = spring({
    frame,
    fps,
    from: 20,
    to: 0,
    config: { damping: 20, stiffness: 120 },
    durationInFrames: 18,
  });

  return (
    <AbsoluteFill>
      <Background bg={background} forRender={forRender} />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5%",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: CARD_MAX_WIDTH[aspect],
            position: "relative",
            top: `${(centerY - 0.5) * 100}%`,
            transform: `translateY(${translate}px) scale(${cardScale})`,
            transformOrigin: "center center",
            opacity,
          }}
        >
          <TweetCard
            tweet={tweet}
            identity={identity}
            theme={theme}
            showStats={showStats}
            showTimestamp={showTimestamp}
            showVerifiedBadge={showVerifiedBadge}
            inCardMedia={true}
            maxWidthPx={CARD_MAX_WIDTH[aspect]}
            cornerRadius={20}
            fontScale={fontScale}
            forRender={forRender}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
