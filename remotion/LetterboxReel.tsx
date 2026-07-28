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
// reliably in both the Player and renderMediaOnWeb.
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
const DEFAULT_CAPTION_SIZE = 42; // composition px
export const CAPTION_POSITIONS = [
  "above",
  "below",
  "overTop",
  "overBottom",
] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
const DEFAULT_CAPTION_POSITION: CaptionPosition = "overBottom";

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
  /** Optional caption rendered over the video in Tenor Sans. */
  caption: string;
  /** Where the caption sits over the video. */
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
  caption: "",
  captionPosition: DEFAULT_CAPTION_POSITION,
  captionSize: DEFAULT_CAPTION_SIZE,
};

// Stable identity so @remotion/media doesn't re-mount on each render.
const onMediaVideoError = () => "fallback" as const;

// Swallow transient Player errors — retries on next frame instead of
// showing Remotion's runtime error overlay.
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
  caption,
  captionPosition,
  captionSize,
}) => {
  // source_time = composition_time × speed + trimBefore/fps
  // → trimBefore = startAt × fps skips the first `startAt` seconds of source.
  const trimBefore = Math.round(startAt * COMP_FPS);
  const resolvedSrc = clipSrc ? resolveSrc(clipSrc) : "";

  const trimmedCaption = caption.trim();
  const captionInset = Math.round(captionSize * 1.4);
  const captionAtTop =
    captionPosition === "above" || captionPosition === "overTop";

  const captionStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    padding: "0 6%",
    fontFamily: "'Tenor Sans', serif",
    fontSize: captionSize,
    letterSpacing: "0.08em",
    lineHeight: 1.15,
    color: "rgba(255, 255, 255, 0.95)",
    textShadow: "0 2px 14px rgba(0, 0, 0, 0.55)",
    pointerEvents: "none",
    ...(captionAtTop ? { top: captionInset } : { bottom: captionInset }),
  };

  // Suppress unused warning — composition size is fixed but kept as a
  // named constant for clarity.
  void COMP_W;
  void COMP_H;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clipSrc ? (
        <AbsoluteFill>
          {/* Full-canvas video — object-fit: cover crops overflow so a source
              of any aspect fills the 9:16 frame edge-to-edge. */}
          {forRender ? (
            <MediaVideo
              src={resolvedSrc}
              trimBefore={trimBefore}
              playbackRate={speed}
              muted
              onError={onMediaVideoError}
              objectFit="cover"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <OffthreadVideo
              src={resolvedSrc}
              trimBefore={trimBefore}
              playbackRate={speed}
              muted
              onError={onOffthreadVideoError}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}

          {trimmedCaption ? <div style={captionStyle}>{trimmedCaption}</div> : null}
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
