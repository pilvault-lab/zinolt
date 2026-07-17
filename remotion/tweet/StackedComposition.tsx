import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { TweetCaptionBlock } from "./TweetCaptionBlock";
import type {
  Aspect,
  BackgroundConfig,
  CardIdentity,
  CardTheme,
} from "./types";
import type { FetchedTweet, TweetMedia } from "@/lib/tweet-fetch";

// Caption zone occupies a percentage of the composition width. The caption
// text block is left-aligned inside this padded slot.
const CAPTION_HORIZ_PAD: Record<Aspect, number> = {
  "9x16": 64,
  "1x1": 56,
  "16x9": 96,
};

const CAPTION_TOP_PAD: Record<Aspect, number> = {
  "9x16": 84,
  "1x1": 60,
  "16x9": 56,
};

const CAPTION_BOTTOM_PAD: Record<Aspect, number> = {
  "9x16": 40,
  "1x1": 32,
  "16x9": 24,
};

const VIDEO_BOTTOM_PAD: Record<Aspect, number> = {
  "9x16": 84,
  "1x1": 60,
  "16x9": 40,
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
  cardScale: number;
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
  cardScale: 1,
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
  showVerifiedBadge,
  fontScale,
  cardScale,
  muted,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const captionOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const video = pickVideo(tweet.media);
  const videoSrc = video ? resolveSrc(video.url) : "";
  const isGif = video?.type === "gif";

  const captionHPad = CAPTION_HORIZ_PAD[aspect];
  const captionTopPad = CAPTION_TOP_PAD[aspect];
  const captionBottomPad = CAPTION_BOTTOM_PAD[aspect];
  const videoBottomPad = VIDEO_BOTTOM_PAD[aspect];

  // Caption text block width — scale with cardScale, but never wider than
  // the padded slot.
  const captionWidthBase =
    aspect === "16x9" ? 1000 : aspect === "1x1" ? 900 : 900;
  const captionWidth = Math.round(captionWidthBase * cardScale);

  return (
    <AbsoluteFill>
      {/* Layer 1 — full-frame background: blurred video if we have one, else
          the configured solid / gradient / (loop is treated as solid black for
          Stacked since the whole point is the tweet's own video). */}
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
                filter: "blur(40px) brightness(0.55)",
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
                filter: "blur(40px) brightness(0.55)",
              }}
            />
          )}
        </AbsoluteFill>
      ) : (
        <SolidOrGradient bg={background} />
      )}

      {/* Layer 2 — vertical stack: caption block up top (auto height), video
          zone below (fills remaining space). Two distinct zones that never
          overlap. */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "flex-start",
          paddingTop: captionTopPad,
          paddingLeft: captionHPad,
          paddingRight: captionHPad,
          paddingBottom: videoBottomPad,
        }}
      >
        {/* Caption — chromeless. No card container, no fill, no border. */}
        <div style={{ opacity: captionOpacity, marginBottom: captionBottomPad }}>
          <TweetCaptionBlock
            tweet={tweet}
            identity={identity}
            theme={theme}
            showVerifiedBadge={showVerifiedBadge}
            widthPx={captionWidth}
            fontScale={fontScale}
            cardScale={cardScale}
          />
        </div>

        {/* Video zone fills remaining space, centered within it. */}
        {video ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {forRender ? (
                <MediaVideo
                  src={videoSrc}
                  muted={muted || isGif}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: 20,
                    display: "block",
                  }}
                />
              ) : (
                <OffthreadVideo
                  src={videoSrc}
                  muted={muted || isGif}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: 20,
                    display: "block",
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
