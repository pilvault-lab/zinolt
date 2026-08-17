import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio as MediaAudio, Video as MediaVideo } from "@remotion/media";
import type { HypeFrame, HypeSettings } from "@/lib/hype-edit/types";
import { DEFAULT_SETTINGS } from "@/lib/hype-edit/types";
import {
  beatIntervalSec,
  cutIndexAt,
  transitionForBeat,
} from "@/lib/hype-edit/beats";
import { computeItemEnter } from "./transitions";

export const HE_FPS = 60;
export const HE_WIDTH = 1080;
export const HE_HEIGHT = 1920;

const isAbsoluteUrl = (s: string) =>
  /^(blob:|data:|https?:|file:)/i.test(s);
const stripLeadingSlash = (p: string) => p.replace(/^\//, "");
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(stripLeadingSlash(p));

const VERNAVLE_LOGO = "brand/vernavle-logo.png";

export type HypeEditProps = {
  frames: HypeFrame[];
  audioSrc: string;
  /** Effective BPM used for cuts. */
  bpm: number;
  /** Audio duration seconds — drives composition length. */
  durationSec: number;
  settings: HypeSettings;
  forRender: boolean;
};

export const hypeEditDefaultProps: HypeEditProps = {
  frames: [],
  audioSrc: "",
  bpm: 120,
  durationSec: 8,
  settings: DEFAULT_SETTINGS,
  forRender: false,
};

export function computeHypeDurationFrames(
  durationSec: number,
  fps: number = HE_FPS,
): number {
  const safe = Math.max(1, Math.ceil(durationSec * fps));
  return Math.max(fps, safe);
}

export const HypeEditComposition: React.FC<HypeEditProps> = ({
  frames,
  audioSrc,
  bpm,
  settings,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / fps;

  const beatSec = beatIntervalSec(bpm);
  const cutIdx = cutIndexAt(bpm, tSec);
  const activeFrame =
    frames.length > 0 && cutIdx >= 0
      ? frames[cutIdx % frames.length]
      : null;
  const activeStart = cutIdx >= 0 ? cutIdx * beatSec : 0;
  const activeElapsed = tSec - activeStart;
  const transition = transitionForBeat(bpm, cutIdx, settings.transitionMode);

  const resolvedAudio = audioSrc ? resolveSrc(audioSrc) : "";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {resolvedAudio ? <MediaAudio src={resolvedAudio} /> : null}

      {/* Full-bleed 9:16 stage — no letterbox */}
      {activeFrame ? (
        <FrameLayer
          key={cutIdx}
          frame={activeFrame}
          transition={transition}
          elapsedSec={activeElapsed}
          beatSec={beatSec}
          bpm={bpm}
          forRender={forRender}
        />
      ) : (
        <EmptyStage />
      )}

      {/* Intro flash — first 0.4s */}
      {settings.introFlash && tSec < 0.42 ? (
        <IntroFlash tSec={tSec} />
      ) : null}

      {/* Persistent watermark */}
      {settings.watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

const FrameLayer: React.FC<{
  frame: HypeFrame;
  transition: ReturnType<typeof transitionForBeat>;
  elapsedSec: number;
  beatSec: number;
  bpm: number;
  forRender: boolean;
}> = ({ frame, transition, elapsedSec, bpm, forRender }) => {
  const enter = computeItemEnter(transition, elapsedSec, bpm);
  // Static hold — no ken-burns push. Only the enter transform applies.
  const combined = enter.transform;

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        transform: combined,
        filter: enter.filter,
        opacity: enter.opacity,
        willChange: "transform, opacity, filter",
      }}
    >
      {frame.kind === "solid" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: frame.color || "#0F0F0F",
          }}
        />
      ) : frame.kind === "video" && frame.src ? (
        forRender ? (
          <MediaVideo
            src={resolveSrc(frame.src)}
            trimBefore={frame.startAt ? Math.round(frame.startAt * 60) : 0}
            muted
            style={mediaStyle}
            onError={() => "fallback" as const}
          />
        ) : (
          <OffthreadVideo
            src={resolveSrc(frame.src)}
            trimBefore={frame.startAt ? Math.round(frame.startAt * 60) : 0}
            muted
            style={mediaStyle}
            onError={() => {}}
          />
        )
      ) : frame.src ? (
        <Img src={resolveSrc(frame.src)} style={mediaStyle} />
      ) : (
        <EmptyStage />
      )}

      {enter.overlay ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: enter.overlay.background,
            opacity: enter.overlay.opacity,
            mixBlendMode: enter.overlay.mixBlendMode,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
};

const EmptyStage: React.FC = () => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "rgba(255,255,255,0.35)",
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: 22,
      letterSpacing: 4,
      backgroundColor: "#0A0A0A",
    }}
  >
    ADD A FRAME
  </div>
);

const IntroFlash: React.FC<{ tSec: number }> = ({ tSec }) => {
  const opacity = interpolate(tSec, [0, 0.12, 0.32, 0.42], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `rgba(0,0,0,${(opacity * 0.55).toFixed(3)})`,
        pointerEvents: "none",
      }}
    >
      <Img
        src={resolveSrc(VERNAVLE_LOGO)}
        style={{
          width: "36%",
          height: "auto",
          opacity,
          filter: "drop-shadow(0 4px 26px rgba(255,255,255,0.20))",
        }}
      />
    </AbsoluteFill>
  );
};

const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 36,
      bottom: 36,
      opacity: 0.75,
      pointerEvents: "none",
    }}
  >
    <Img
      src={resolveSrc(VERNAVLE_LOGO)}
      style={{ width: 96, height: "auto" }}
    />
  </div>
);
