import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  continueRender,
  delayRender,
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
  "9x16": 12,
  "1x1": 10,
  "16x9": 8,
};

const VIDEO_BOTTOM_PAD: Record<Aspect, number> = {
  "9x16": 84,
  "1x1": 60,
  "16x9": 40,
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
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {forRender ? (
        <MediaVideo
          src={src}
          muted
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
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
  verticalOffsetPct: number;
  muted: boolean;
  forRender: boolean;
  blurredBg: boolean;
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
    avatarUrl: "/pages/zincad/avatar.jpg",
    verified: false,
  },
  theme: "dark",
  background: { kind: "solid", color: "#000000" },
  showStats: false,
  showTimestamp: false,
  showVerifiedBadge: false,
  fontScale: 1,
  cardScale: 1,
  verticalOffsetPct: 50,
  muted: false,
  forRender: false,
  blurredBg: true,
};

function pickVideo(media: TweetMedia[]): TweetMedia | null {
  return media.find((m) => m.type === "video" || m.type === "gif") ?? null;
}

function pickPhoto(media: TweetMedia[]): TweetMedia | null {
  return media.find((m) => m.type === "photo") ?? null;
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
  verticalOffsetPct,
  muted,
  forRender,
  blurredBg,
}) => {
  const frame = useCurrentFrame();
  const captionOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Block the first frame until document.fonts.ready resolves. Without this
  // the export renderer may capture frames while a fallback font is still
  // being swapped for the real face — text metrics differ from the Player
  // preview (which re-renders after the swap) and the caption block ends up
  // a different height, widening the gap to the video below.
  const [fontHandle] = useState(() => delayRender("Waiting for fonts"));
  useEffect(() => {
    let cancelled = false;
    if (typeof document === "undefined" || !document.fonts) {
      continueRender(fontHandle);
      return;
    }
    document.fonts.ready
      .then(() => {
        if (!cancelled) continueRender(fontHandle);
      })
      .catch(() => {
        if (!cancelled) continueRender(fontHandle);
      });
    return () => {
      cancelled = true;
    };
  }, [fontHandle]);

  const video = pickVideo(tweet.media);
  const videoSrc = video ? resolveSrc(video.url) : "";
  const isGif = video?.type === "gif";
  // Photo fallback: when the tweet has no video/gif but has photos, render the
  // first photo below the caption using the same layout the video zone uses.
  const photo = !video ? pickPhoto(tweet.media) : null;

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
      {/* Layer 1 — full-frame background. When `blurredBg` is on, a blurred
          copy of the media wins. Otherwise the user's chosen background config
          (solid/gradient/loop/upload) renders. */}
      {video && blurredBg ? (
        <AbsoluteFill style={{ overflow: "hidden", filter: "blur(40px) brightness(0.55)" }}>
          {forRender ? (
            <MediaVideo
              src={videoSrc}
              muted
              objectFit="cover"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <OffthreadVideo
              src={videoSrc}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}
        </AbsoluteFill>
      ) : photo && blurredBg ? (
        <AbsoluteFill style={{ overflow: "hidden", filter: "blur(40px) brightness(0.55)" }}>
          <Img
            src={photo.url}
            onError={() => {
              /* swallow — the caption stack still renders */
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </AbsoluteFill>
      ) : (
        <Background bg={background} forRender={forRender} />
      )}

      {/* Layer 2 — vertical stack: caption block up top (auto height), video
          zone below (fills remaining space). Two distinct zones that never
          overlap. verticalOffsetPct shifts the whole stack: 50 = default,
          0 = pushed to top, 100 = pushed to bottom. */}
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
          transform: `translateY(${verticalOffsetPct - 50}%)`,
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

        {/* Video zone. To avoid depending on object-position (which the export
            composer does not honor — it always centers the object-fit result),
            we size the wrapper to the source video's actual aspect ratio and
            use object-fit: fill. That way there is no leftover space inside
            the canvas box that could be positioned differently across preview
            and export. The wrapper is top-aligned in the remaining flex space. */}
        {video ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio:
                  video.width && video.height
                    ? `${video.width} / ${video.height}`
                    : "16 / 9",
                maxHeight: "100%",
                borderRadius: 20,
                overflow: "hidden",
              }}
            >
              {forRender ? (
                <MediaVideo
                  src={videoSrc}
                  muted={muted || isGif}
                  objectFit="fill"
                  style={{
                    width: "100%",
                    height: "100%",
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
                    objectFit: "fill",
                    display: "block",
                  }}
                />
              )}
            </div>
          </div>
        ) : photo ? (
          // Photo zone — mirrors the video layout: full-width wrapper sized to
          // the image's aspect ratio, contain so nothing gets cropped even if
          // the reported dimensions are off. Top-aligned so caption→photo
          // spacing stays consistent with the video branch.
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio:
                  photo.width && photo.height
                    ? `${photo.width} / ${photo.height}`
                    : "16 / 9",
                maxHeight: "100%",
                borderRadius: 20,
                overflow: "hidden",
              }}
            >
              <Img
                src={photo.url}
                onError={() => {
                  /* swallow — missing image renders as empty box */
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
