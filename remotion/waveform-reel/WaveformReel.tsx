import React, { useMemo } from "react";
import {
  AbsoluteFill,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Audio as MediaAudio } from "@remotion/media";
import {
  deserializeAnalysis,
  sampleAt,
  type SerializedAnalysis,
} from "@/lib/waveform-reel/analyze";
import { OrbVisualizer } from "./OrbVisualizer";

export const WR_FPS = 60;
export const WR_WIDTH = 1080;
export const WR_HEIGHT = 1920;
/** House palette. Pure #000 so bloom fades edge-to-edge with no visible lift. */
export const WR_BG = "#000000";
export const WR_FG = "#FFFFFF";
export const WR_DEFAULT_DURATION_FRAMES = WR_FPS * 8;

export type WaveformStyle = "bars" | "line" | "orb" | "orb-ring";

export type WaveformReelStyleConfig = {
  style: WaveformStyle;
  /** 0..1 vertical position of the bar/line waveform centerline. */
  verticalPosition: number;
  /** Bar count for "bars" style. */
  barCount: number;
  /** Bar thickness in px (before spacing). */
  barThickness: number;
  /** Line stroke thickness in px for "line" style. */
  lineThickness: number;
  /** 0..2 amplitude multiplier. */
  sensitivity: number;
  /** 0..1 bloom intensity. */
  glow: number;
  /**
   * Bars only: how to lay out the bins across the width.
   *  "symmetric" — spectrum mirrored L↔R, bass at center (default, looks
   *  waveform-y).
   *  "linear"    — spectrum laid out left→right (classic EQ).
   */
  barsLayout: "symmetric" | "linear";
  /** 0..1 amount the whole scene breathes on the bass kick. */
  pulseAmount: number;
  /** Orb radius as a fraction of stage width (0.1..0.5). */
  orbRadius: number;
  /** Orb: how strongly the shape deforms with FFT bins. */
  orbDisplacement: number;
  /** Orb: rotation speed in radians per second. */
  orbRotation: number;
  /** Orb-ring: bar count around the circle. */
  orbRingBars: number;
  /** Show the VERNAVLE watermark. */
  watermark: boolean;
};

export const wrDefaultStyle: WaveformReelStyleConfig = {
  style: "bars",
  verticalPosition: 0.5,
  barCount: 64,
  barThickness: 10,
  lineThickness: 5,
  sensitivity: 1.15,
  glow: 0.55,
  barsLayout: "symmetric",
  pulseAmount: 0.08,
  orbRadius: 0.28,
  orbDisplacement: 0.55,
  orbRotation: 0.35,
  orbRingBars: 120,
  watermark: false,
};

export type WaveformReelProps = {
  audioSrc: string;
  analysis: SerializedAnalysis | null;
  config: WaveformReelStyleConfig;
  forRender: boolean;
};

export const waveformReelDefaultProps: WaveformReelProps = {
  audioSrc: "",
  analysis: null,
  config: wrDefaultStyle,
  forRender: false,
};

export function computeWaveformDurationFrames(
  a: SerializedAnalysis | null,
  fps: number = WR_FPS,
): number {
  if (!a) return WR_DEFAULT_DURATION_FRAMES;
  if (a.fps === fps) return Math.max(fps, a.totalFrames);
  return Math.max(fps, Math.ceil(a.durationSec * fps));
}

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:|\/api\/)/i.test(s);
const stripLeadingSlash = (p: string) => p.replace(/^\//, "");
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(stripLeadingSlash(p));

export const WaveformReelComposition: React.FC<WaveformReelProps> = ({
  audioSrc,
  analysis,
  config,
}) => {
  const decoded = useMemo(
    () => (analysis ? deserializeAnalysis(analysis) : null),
    [analysis],
  );

  const resolvedAudio = audioSrc ? resolveSrc(audioSrc) : "";

  return (
    <AbsoluteFill style={{ backgroundColor: WR_BG }}>
      {resolvedAudio ? <MediaAudio src={resolvedAudio} /> : null}
      {decoded ? (
        <StageWithFilters analysis={decoded} config={config} />
      ) : (
        <PlaceholderStage />
      )}
      {config.watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

type AnalysisRuntime = ReturnType<typeof deserializeAnalysis>;

/**
 * Top-level stage: bass-pulse scale wrapper + vignette + defs + visualizer.
 * Everything renders inside one SVG so the bloom filter can composite across
 * the whole scene.
 */
const StageWithFilters: React.FC<{
  analysis: AnalysisRuntime;
  config: WaveformReelStyleConfig;
}> = ({ analysis, config }) => {
  const frame = useCurrentFrame();
  const clampedFrame = Math.min(analysis.totalFrames - 1, Math.max(0, frame));
  const bass = sampleAt(analysis.bassEnv, clampedFrame);
  const pulseScale = 1 + bass * config.pulseAmount;

  const cx = WR_WIDTH / 2;
  const cy = WR_HEIGHT / 2;
  const bloomId = "wr-bloom";
  const barGradId = "wr-bar-grad";

  return (
    <svg
      width={WR_WIDTH}
      height={WR_HEIGHT}
      viewBox={`0 0 ${WR_WIDTH} ${WR_HEIGHT}`}
      style={{ position: "absolute", inset: 0 }}
      shapeRendering="geometricPrecision"
    >
      <defs>
        {/* Tight 2-pass bloom. Only the crisp inner halo + a compact mid glow
         *  survive; the far outer pass was removed because it left visible
         *  residue on the pure-black background. Gaussian falloff is short
         *  enough at stdDev<=14 that the halo dies within a few dozen px of
         *  the source pixel. */}
        <filter id={bloomId} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b2" />
          <feComponentTransfer in="b2" result="b2a">
            <feFuncA type="linear" slope={0.55 + config.glow * 0.55} />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="b2a" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Bar gradient: bright top, warm-white core, soft foot. Sells "light". */}
        <linearGradient id={barGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="45%" stopColor="#F6F6F0" stopOpacity="1" />
          <stop offset="100%" stopColor="#B8B8B0" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* Bass-pulse scale wrapper — the whole visualizer breathes on the kick. */}
      <g
        transform={`translate(${cx} ${cy}) scale(${pulseScale.toFixed(4)}) translate(${-cx} ${-cy})`}
      >
        <Visualizer
          analysis={analysis}
          config={config}
          bloomId={bloomId}
          barGradId={barGradId}
          frame={clampedFrame}
        />
      </g>
    </svg>
  );
};

const Visualizer: React.FC<{
  analysis: AnalysisRuntime;
  config: WaveformReelStyleConfig;
  bloomId: string;
  barGradId: string;
  frame: number;
}> = ({ analysis, config, bloomId, barGradId, frame }) => {
  switch (config.style) {
    case "bars":
      return (
        <BarsVisualizer
          analysis={analysis}
          config={config}
          bloomId={bloomId}
          barGradId={barGradId}
          frame={frame}
        />
      );
    case "line":
      return (
        <LineVisualizer
          analysis={analysis}
          config={config}
          bloomId={bloomId}
          frame={frame}
        />
      );
    case "orb":
    case "orb-ring":
      return (
        <OrbVisualizer
          analysis={analysis}
          config={config}
          bloomId={bloomId}
          barGradId={barGradId}
          frame={frame}
        />
      );
    default:
      return null;
  }
};

// ---------------- BARS -----------------

const BarsVisualizer: React.FC<{
  analysis: AnalysisRuntime;
  config: WaveformReelStyleConfig;
  bloomId: string;
  barGradId: string;
  frame: number;
}> = ({ analysis, config, bloomId, barGradId, frame }) => {
  const { totalFrames, numBins } = analysis;
  const barCount = Math.max(4, Math.min(256, Math.round(config.barCount)));
  const centerY = config.verticalPosition * WR_HEIGHT;
  const laneW = WR_WIDTH / barCount;
  const barW = Math.min(laneW * 0.72, config.barThickness);
  const maxBarH = WR_HEIGHT * 0.42;
  const sens = Math.max(0.1, config.sensitivity);

  const frameOffset = frame * numBins;
  const ampEnvV = sampleAt(analysis.ampEnv, frame);

  const bars: React.ReactNode[] = [];
  for (let i = 0; i < barCount; i++) {
    // Layout: symmetric (bass at center, treble to edges) OR linear (bass → treble left → right).
    let binIdx: number;
    if (config.barsLayout === "symmetric") {
      const halfIdx = Math.abs(i - (barCount - 1) / 2);
      binIdx = Math.min(
        numBins - 1,
        Math.floor((halfIdx / (barCount / 2)) * numBins),
      );
    } else {
      binIdx = Math.min(numBins - 1, Math.floor((i / barCount) * numBins));
    }
    const binV = analysis.binsEnv[frameOffset + binIdx] ?? 0;
    const v = Math.min(1, (binV * 0.75 + ampEnvV * 0.3) * sens);
    const h = Math.max(barW, v * maxBarH);
    const x = i * laneW + (laneW - barW) / 2;
    const y = centerY - h / 2;
    bars.push(
      <rect
        key={i}
        x={x}
        y={y}
        width={barW}
        height={h}
        rx={barW / 2}
        fill={`url(#${barGradId})`}
      />,
    );
    void totalFrames;
  }

  return <g filter={`url(#${bloomId})`}>{bars}</g>;
};

// ---------------- LINE -----------------

const LineVisualizer: React.FC<{
  analysis: AnalysisRuntime;
  config: WaveformReelStyleConfig;
  bloomId: string;
  frame: number;
}> = ({ analysis, config, bloomId, frame }) => {
  const { numBins } = analysis;
  const pointCount = 260;
  const centerY = config.verticalPosition * WR_HEIGHT;
  const maxAmpPx = WR_HEIGHT * 0.26;
  const sens = Math.max(0.1, config.sensitivity);
  const ampV = sampleAt(analysis.ampEnv, frame);
  const frameOffset = frame * numBins;

  const pts: string[] = [];
  for (let i = 0; i < pointCount; i++) {
    const halfIdx = Math.abs(i - (pointCount - 1) / 2);
    const binIdx = Math.min(
      numBins - 1,
      Math.floor((halfIdx / (pointCount / 2)) * numBins),
    );
    const b = analysis.binsEnv[frameOffset + binIdx] ?? 0;
    const v = Math.min(1, (b * 0.65 + ampV * 0.55) * sens);
    const sign = i % 2 === 0 ? 1 : -1;
    const x = (i / (pointCount - 1)) * WR_WIDTH;
    const y = centerY + sign * v * maxAmpPx;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return (
    <g filter={`url(#${bloomId})`}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={WR_FG}
        strokeWidth={config.lineThickness}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </g>
  );
};

// ---------------- CHROME -----------------

const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 60,
      textAlign: "center",
      color: "rgba(255,255,255,0.55)",
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: 20,
      letterSpacing: 10,
      pointerEvents: "none",
    }}
  >
    VERNAVLE
  </div>
);

const PlaceholderStage: React.FC = () => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "center",
      color: "rgba(255,255,255,0.35)",
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: 22,
      letterSpacing: 4,
    }}
  >
    ADD AUDIO
  </AbsoluteFill>
);
