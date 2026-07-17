import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { TweetCard } from "./TweetCard";
import type {
  Aspect,
  BackgroundConfig,
  CardIdentity,
  CardTheme,
} from "./types";
import type { FetchedTweet, TweetMedia } from "@/lib/tweet-fetch";

const CARD_MAX_WIDTH: Record<Aspect, number> = {
  "9x16": 780,
  "1x1": 720,
  "16x9": 640,
};

const VIDEO_ZONE: Record<
  Aspect,
  { widthPct: number; heightPct: number; topPct: number }
> = {
  "9x16": { widthPct: 92, heightPct: 55, topPct: 30 },
  "1x1": { widthPct: 84, heightPct: 60, topPct: 26 },
  "16x9": { widthPct: 55, heightPct: 78, topPct: 12 },
};

const CARD_TOP: Record<Aspect, number> = {
  "9x16": 4,
  "1x1": 3,
  "16x9": 2,
};

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:|\/)/i.test(s);
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(p);

const SolidOrGradient: React.FC<{ bg: BackgroundConfig }> = ({ bg }) => {
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
  return <AbsoluteFill style={{ backgroundColor: "#000" }} />;
};

export type StackedProps = {
  aspect: Aspect;
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  background: BackgroundConfig;
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  fontScale: number;
  muted: boolean;
  forRender: boolean;
};

export const stackedDefaultProps: StackedProps = {
  aspect: "9x16",
  tweet: {
    id: "0",
    text: "Fetch a video tweet to preview.",
    author: { name: "Zinolt", handle: "zinolt", avatarUrl: "", verified: false },
    createdAt: new Date().toISOString(),
    stats: { likes: 0, retweets: 0, replies: 0 },
    media: [],
  },
  identity: {
    name: "Zinolt",
    handle: "zinolt",
    avatarUrl: "/pages/general/avatar.jpg",
    verified: false,
  },
  theme: "dark",
  background: { kind: "solid", color: "#000000" },
  showStats: false,
  showTimestamp: false,
  showVerifiedBadge: false,
  fontScale: 1,
  muted: false,
  forRender: false,
};

function pickVideo(media: TweetMedia[]): TweetMedia | null {
  return media.find((m) => m.type === "video" || m.type === "gif") ?? null;
}

export const StackedComposition: React.FC<StackedProps> = ({
  aspect,
  tweet,
  identity,
  theme,
  background,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  fontScale,
  muted,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const cardOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const video = pickVideo(tweet.media);
  const videoSrc = video ? resolveSrc(video.url) : "";
  const isGif = video?.type === "gif";
  const zone = VIDEO_ZONE[aspect];

  return (
    <AbsoluteFill>
      {video ? (
        <AbsoluteFill>
          {forRender ? (
            <MediaVideo
              src={videoSrc}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(40px) brightness(0.6)",
              }}
            />
          ) : (
            <OffthreadVideo
              src={videoSrc}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(40px) brightness(0.6)",
              }}
            />
          )}
        </AbsoluteFill>
      ) : (
        <SolidOrGradient bg={background} />
      )}

      {video ? (
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: `${zone.widthPct}%`,
              height: `${zone.heightPct}%`,
              marginTop: `${zone.topPct - 50}%`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {forRender ? (
              <MediaVideo
                src={videoSrc}
                muted={muted || isGif}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 16,
                }}
              />
            ) : (
              <OffthreadVideo
                src={videoSrc}
                muted={muted || isGif}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 16,
                }}
              />
            )}
          </div>
        </AbsoluteFill>
      ) : null}

      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: `${CARD_TOP[aspect]}%`,
          paddingLeft: "4%",
          paddingRight: "4%",
          opacity: cardOpacity,
        }}
      >
        <TweetCard
          tweet={tweet}
          identity={identity}
          theme={theme}
          showStats={showStats}
          showTimestamp={showTimestamp}
          showVerifiedBadge={showVerifiedBadge}
          inCardMedia={false}
          maxWidthPx={CARD_MAX_WIDTH[aspect]}
          cornerRadius={18}
          fontScale={fontScale}
          forRender={forRender}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
