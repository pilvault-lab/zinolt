import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";

/* ─── Config ─────────────────────────────────────────────────────────────────
 * All pre-configured values live here. Swap backgrounds, adjust opacity,
 * change type treatment — none of this is user-facing.
 * -------------------------------------------------------------------------- */
export const STORY_CARD_CONFIG = {
  /** Available background loops (served from public/story-card/backgrounds/). */
  backgrounds: [
    { id: "night-city", src: "story-card/backgrounds/night-city.mp4", label: "Night City" },
    { id: "dark-smoke", src: "story-card/backgrounds/dark-smoke.mp4", label: "Dark Smoke" },
  ] as { id: string; src: string; label: string }[],

  /** Black layer over the video — keeps text legible on any frame. */
  overlayOpacity: 0.62,

  /** Radial vignette darkening toward edges. */
  vignetteOpacity: 0.48,

  /**
   * Vertical center of the text block as a fraction of composition height.
   * 0 = top, 0.5 = middle, 1 = bottom.
   */
  textCenterY: 0.48,

  /** Text block width as a fraction of composition width (1080 px). */
  textWidthFraction: 0.85,

  /** Body type — clean readable sans-serif, NOT the condensed brand face. */
  fontFamily: "'Messina Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 56,
  fontWeight: 400,
  lineHeight: 1.52,

  /** Vertical gap between paragraph blocks (composition px). */
  paragraphGap: 58,

  textColor: "#FFFFFF",
  textShadow: "0 2px 18px rgba(0,0,0,0.70)",

  /** When true, paragraphs fade in one-by-one at the start. */
  fadeIn: true,
  /** Frames each paragraph takes to fully fade in. */
  fadeInDurationFrames: 40,
  /** Frames between paragraph fade-in starts. */
  paragraphStaggerFrames: 28,
  /** Delay (frames) before the first paragraph begins fading in. */
  fadeInStartFrame: 10,

} as const;

export const STORY_CARD_FPS = 30;
export const STORY_CARD_DURATION_FRAMES = STORY_CARD_FPS * 12; // 12 s loop

export type StoryCardProps = {
  text: string;
  /** Path relative to /public, e.g. "story-card/backgrounds/night-city.mp4" */
  backgroundSrc: string;
  /** True only when rendering via renderMediaOnWeb — picks @remotion/media <Video>. */
  forRender: boolean;
};

export const storyCardDefaultProps: StoryCardProps = {
  text: "Markets don't care about your feelings.\n\nThe data always tells the truth. Position yourself accordingly.\n\nPatience is the edge most retail investors never develop.",
  backgroundSrc: STORY_CARD_CONFIG.backgrounds[0].src,
  forRender: false,
};

/* ─── Font loading ───────────────────────────────────────────────────────── */
let _messinaLoaded = false;

function loadFontOnce(
  family: string,
  src: string,
  flag: () => boolean,
  setFlag: () => void,
) {
  if (typeof window === "undefined" || flag()) return;
  setFlag();
  const handle = delayRender(`${family} font`);
  const face = new FontFace(family, src);
  face
    .load()
    .then(() => { document.fonts.add(face); continueRender(handle); })
    .catch(() => continueRender(handle));
}

loadFontOnce(
  "Messina Sans",
  `url(${staticFile("brand/MessinaSansWeb-VF-Upright.woff2")}) format('woff2')`,
  () => _messinaLoaded,
  () => { _messinaLoaded = true; },
);

/* ─── Composition ────────────────────────────────────────────────────────── */
export const StoryCardComposition: React.FC<StoryCardProps> = ({
  text,
  backgroundSrc,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const cfg = STORY_CARD_CONFIG;

  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const COMP_W = 1080;
  const COMP_H = 1920;
  const textW = Math.round(COMP_W * cfg.textWidthFraction);
  const textX = Math.round((COMP_W - textW) / 2);
  const centerPx = Math.round(COMP_H * cfg.textCenterY);

  const vignette = `radial-gradient(ellipse 80% 65% at 50% 50%, transparent 35%, rgba(0,0,0,${cfg.vignetteOpacity}) 100%)`;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Background loop */}
      {forRender ? (
        <MediaVideo
          src={staticFile(backgroundSrc)}
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <OffthreadVideo
          src={staticFile(backgroundSrc)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {/* Primary darkening overlay */}
      <AbsoluteFill
        style={{ backgroundColor: `rgba(0,0,0,${cfg.overlayOpacity})` }}
      />

      {/* Edge vignette */}
      <AbsoluteFill
        style={{ background: vignette, pointerEvents: "none" }}
      />

      {/* Text block — vertically centered at cfg.textCenterY */}
      <div
        style={{
          position: "absolute",
          left: textX,
          width: textW,
          top: centerPx,
          transform: "translateY(-50%)",
        }}
      >
        {paragraphs.map((para, i) => {
          const paraOpacity = cfg.fadeIn
            ? interpolate(
                frame,
                [
                  cfg.fadeInStartFrame + i * cfg.paragraphStaggerFrames,
                  cfg.fadeInStartFrame +
                    i * cfg.paragraphStaggerFrames +
                    cfg.fadeInDurationFrames,
                ],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            : 1;

          return (
            <p
              key={i}
              style={{
                margin: 0,
                marginBottom:
                  i < paragraphs.length - 1 ? cfg.paragraphGap : 0,
                fontFamily: cfg.fontFamily,
                fontSize: cfg.fontSize,
                fontWeight: cfg.fontWeight,
                lineHeight: cfg.lineHeight,
                color: cfg.textColor,
                textShadow: cfg.textShadow,
                opacity: paraOpacity,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {para}
            </p>
          );
        })}


      </div>
    </AbsoluteFill>
  );
};
