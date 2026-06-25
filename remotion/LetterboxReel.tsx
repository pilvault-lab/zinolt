import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  continueRender,
  delayRender,
  staticFile,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { BRAND, type Brand } from "../lib/brand";

// Self-host Tenor Sans (woff2 in /public/brand) so the caption renders
// reliably in both the Player and renderMediaOnWeb. Matches the existing
// Cosmos Oracle pattern in Reel.tsx.
if (typeof window !== "undefined") {
  const handle = delayRender("Tenor Sans font");
  const face = new FontFace(
    "Tenor Sans",
    `url(${staticFile("brand/TenorSans-Regular.woff2")}) format('woff2')`,
  );
  face
    .load()
    .then(() => {
      document.fonts.add(face);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
}

const COMP_W = 1080;
const COMP_H = 1920;
const COMP_FPS = 30;
const VIDEO_ASPECT = 9 / 16; // 16:9 slot
const DEFAULT_VIDEO_SCALE = 0.88; // 950 px at 1080 wide
const DEFAULT_VIDEO_RADIUS = 28; // px
const DEFAULT_CAPTION_SIZE = 42; // composition px
export const CAPTION_POSITIONS = [
  "above",
  "below",
  "overTop",
  "overBottom",
] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
const DEFAULT_CAPTION_POSITION: CaptionPosition = "above";

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:)/i.test(s);
const stripLeadingSlash = (p: string) => p.replace(/^\//, "");
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(stripLeadingSlash(p));

export type LetterboxReelProps = {
  clipSrc: string;
  brand: Brand;
  /** Seconds into the source clip at which playback begins. */
  startAt: number;
  /** Playback-rate multiplier (1, 2, 4, 8, 12, …). */
  speed: number;
  /** True only when rendering via renderMediaOnWeb — picks the @remotion/media
   *  decoder. The Player keeps the smoother OffthreadVideo path. */
  forRender: boolean;
  /** Video width as a fraction of the composition width (0.5–1.0). */
  videoScale: number;
  /** Corner radius of the video slot, in composition pixels. */
  videoRadius: number;
  /** Optional caption rendered around / over the video in Tenor Sans. */
  caption: string;
  /** Where the caption sits relative to the video slot. */
  captionPosition: CaptionPosition;
  /** Caption font size in composition pixels. */
  captionSize: number;
};

export const letterboxDefaultProps: LetterboxReelProps = {
  clipSrc: "",
  brand: BRAND,
  startAt: 0,
  speed: 2,
  forRender: false,
  videoScale: DEFAULT_VIDEO_SCALE,
  videoRadius: DEFAULT_VIDEO_RADIUS,
  caption: "",
  captionPosition: DEFAULT_CAPTION_POSITION,
  captionSize: DEFAULT_CAPTION_SIZE,
};

// Hoisted so the Video receives a stable callback identity across renders
// — re-creating it inline triggers re-mounts in @remotion/media.
const onMediaVideoError = () => "fallback" as const;

// Swallows transient playback errors from the Player's <OffthreadVideo>.
// The browser fires "data source error" if a SW range request races a clip
// switch or the SW idle-died and lost its in-memory blob; we want a silent
// retry on the next frame rather than Remotion's runtime error overlay.
const onOffthreadVideoError = (err: Error) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[LetterboxReel] preview video error:", err.message);
  }
};

export const LetterboxReel: React.FC<LetterboxReelProps> = ({
  clipSrc,
  brand,
  startAt,
  speed,
  forRender,
  videoScale,
  videoRadius,
  caption,
  captionPosition,
  captionSize,
}) => {
  // source_time = composition_time × speed + trimBefore/fps
  // → trimBefore = startAt × fps skips the first `startAt` seconds of source.
  const trimBefore = Math.round(startAt * COMP_FPS);

  // Video slot derived from videoScale — width is `videoScale × COMP_W`,
  // height keeps the 16:9 aspect, centered.
  const videoW = Math.round(COMP_W * videoScale);
  const videoH = Math.round(videoW * VIDEO_ASPECT);
  const videoLeft = (COMP_W - videoW) / 2;
  const videoTop = (COMP_H - videoH) / 2;

  // In the <Player> we use Remotion's native <OffthreadVideo>: it's backed by
  // a normal HTML5 <video> element, so seeking and looping are smooth and we
  // never hit WebCodecs flicker / decoder fallback handoffs mid-playback.
  // renderMediaOnWeb requires @remotion/media's <Video>, so swap on that path.
  const resolvedSrc = clipSrc ? resolveSrc(clipSrc) : "";

  const trimmedCaption = caption.trim();
  const captionGap = Math.round(captionSize * 0.7); // gap between caption and slot
  const captionInset = Math.round(captionSize * 0.5); // inset from slot edge when overlaid

  const captionStyleBase: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    padding: "0 6%",
    fontFamily: "'Tenor Sans', serif",
    fontSize: captionSize,
    letterSpacing: "0.08em",
    lineHeight: 1.15,
    pointerEvents: "none",
  };
  // "above"/"below" sit on the composition's black background — softer
  // grey reads well there. "overTop"/"overBottom" need a shadow because
  // they sit on top of the video.
  const captionOnBlackColor = "rgba(255, 255, 255, 0.78)";
  const captionOverlayColor = "rgba(255, 255, 255, 0.95)";
  const captionOverlayShadow = "0 2px 14px rgba(0, 0, 0, 0.55)";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clipSrc ? (
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              left: videoLeft,
              top: videoTop,
              width: videoW,
              height: videoH,
              borderRadius: videoRadius,
              overflow: "hidden",
            }}
          >
            {forRender ? (
              <MediaVideo
                src={resolvedSrc}
                trimBefore={trimBefore}
                playbackRate={speed}
                muted
                onError={onMediaVideoError}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <OffthreadVideo
                src={resolvedSrc}
                trimBefore={trimBefore}
                playbackRate={speed}
                muted
                onError={onOffthreadVideoError}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}

            {/* Caption when overlaid INSIDE the slot — clipped to the
             *  rounded corners by the slot's overflow:hidden. */}
            {trimmedCaption && captionPosition === "overTop" ? (
              <div
                style={{
                  ...captionStyleBase,
                  top: captionInset,
                  color: captionOverlayColor,
                  textShadow: captionOverlayShadow,
                }}
              >
                {trimmedCaption}
              </div>
            ) : null}
            {trimmedCaption && captionPosition === "overBottom" ? (
              <div
                style={{
                  ...captionStyleBase,
                  bottom: captionInset,
                  color: captionOverlayColor,
                  textShadow: captionOverlayShadow,
                }}
              >
                {trimmedCaption}
              </div>
            ) : null}
          </div>

          {/* Caption when placed ABOVE / BELOW the slot — on the
           *  composition background, matching the other templates. */}
          {trimmedCaption && captionPosition === "above" ? (
            <div
              style={{
                ...captionStyleBase,
                top: videoTop - captionGap - captionSize,
                color: captionOnBlackColor,
              }}
            >
              {trimmedCaption}
            </div>
          ) : null}
          {trimmedCaption && captionPosition === "below" ? (
            <div
              style={{
                ...captionStyleBase,
                top: videoTop + videoH + captionGap,
                color: captionOnBlackColor,
              }}
            >
              {trimmedCaption}
            </div>
          ) : null}
        </AbsoluteFill>
      ) : null}

      {/* Brand logo — top-right, same position as other templates */}
      <AbsoluteFill>
        <Img
          src={resolveSrc(brand.logoSrc)}
          style={{
            position: "absolute",
            top: "3.5%",
            right: "5%",
            width: "6%",
            height: "auto",
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
