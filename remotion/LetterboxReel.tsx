import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { BRAND, type Brand } from "../lib/brand";

const COMP_W = 1080;
const COMP_H = 1920;
const COMP_FPS = 30;
const VIDEO_W = Math.round(COMP_W * 0.88); // 950 px
const VIDEO_H = Math.round(VIDEO_W * (9 / 16)); // 534 px — 16:9 slot
const VIDEO_LEFT = (COMP_W - VIDEO_W) / 2; // 65 px
const VIDEO_TOP = (COMP_H - VIDEO_H) / 2; // 693 px — vertically centred

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
};

export const letterboxDefaultProps: LetterboxReelProps = {
  clipSrc: "",
  brand: BRAND,
  startAt: 0,
  speed: 2,
  forRender: false,
};

// Hoisted so the Video receives a stable callback identity across renders
// — re-creating it inline triggers re-mounts in @remotion/media.
const onMediaVideoError = () => "fallback" as const;

export const LetterboxReel: React.FC<LetterboxReelProps> = ({
  clipSrc,
  brand,
  startAt,
  speed,
  forRender,
}) => {
  // source_time = composition_time × speed + trimBefore/fps
  // → trimBefore = startAt × fps skips the first `startAt` seconds of source.
  const trimBefore = Math.round(startAt * COMP_FPS);

  // In the <Player> we use Remotion's native <OffthreadVideo>: it's backed by
  // a normal HTML5 <video> element, so seeking and looping are smooth and we
  // never hit WebCodecs flicker / decoder fallback handoffs mid-playback.
  // renderMediaOnWeb requires @remotion/media's <Video>, so swap on that path.
  const resolvedSrc = clipSrc ? resolveSrc(clipSrc) : "";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clipSrc ? (
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              left: VIDEO_LEFT,
              top: VIDEO_TOP,
              width: VIDEO_W,
              height: VIDEO_H,
              borderRadius: 28,
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
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}
          </div>
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
