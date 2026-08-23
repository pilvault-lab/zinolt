import React, { useMemo } from "react";
import { sampleAt, type deserializeAnalysis } from "@/lib/waveform-reel/analyze";
import {
  WR_FG,
  WR_HEIGHT,
  WR_WIDTH,
  type WaveformReelStyleConfig,
} from "./WaveformReel";

type Analysis = ReturnType<typeof deserializeAnalysis>;

/**
 * Two ORB modes, both driven by the same precomputed FFT data.
 *
 *   "orb-ring": radial pill bars pointing outward from a circle baseline.
 *     Matches docs/orb ring.png — discrete capsule bars around a ring, bar
 *     length = enveloped FFT bin at that angle. Baseline stays a circle.
 *
 *   "orb": Fibonacci-sphere point cloud with per-vertex radial displacement
 *     from FFT bins + rim highlight + subtle rotation, so the "sphere" reads
 *     as breathing and slowly spinning.
 *
 * Both are pure SVG — no three.js — so they render byte-identically in the
 * headless MP4 pipeline. Bloom is applied by the parent via `bloomId`.
 */
export const OrbVisualizer: React.FC<{
  analysis: Analysis;
  config: WaveformReelStyleConfig;
  bloomId: string;
  barGradId: string;
  frame: number;
}> = ({ analysis, config, bloomId, barGradId, frame }) => {
  if (config.style === "orb-ring") {
    return (
      <OrbRing
        analysis={analysis}
        config={config}
        bloomId={bloomId}
        barGradId={barGradId}
        frame={frame}
      />
    );
  }
  return (
    <ParticleOrb
      analysis={analysis}
      config={config}
      bloomId={bloomId}
      frame={frame}
    />
  );
};

// ---------------- ORB RING (radial bars) -----------------

const OrbRing: React.FC<{
  analysis: Analysis;
  config: WaveformReelStyleConfig;
  bloomId: string;
  barGradId: string;
  frame: number;
}> = ({ analysis, config, bloomId, barGradId, frame }) => {
  const { numBins, totalFrames } = analysis;
  const cx = WR_WIDTH / 2;
  const cy = WR_HEIGHT / 2;
  const baselineR = WR_WIDTH * Math.min(0.5, Math.max(0.1, config.orbRadius));

  const clampedFrame = Math.min(totalFrames - 1, Math.max(0, frame));
  const ampV = sampleAt(analysis.ampEnv, clampedFrame);
  const frameOffset = clampedFrame * numBins;

  const count = Math.max(24, Math.min(360, Math.round(config.orbRingBars)));
  const barLenMax = baselineR * 1.1 * Math.max(0.1, config.orbDisplacement);
  // Bar width: proportional to ring circumference / count, capped so bars stay
  // legible on big count settings.
  const rimCircumference = 2 * Math.PI * baselineR;
  const barWpx = Math.max(3, Math.min(18, (rimCircumference / count) * 0.55));

  // Static rotation offset so the "activity" pools land at the bottom (matching
  // the reference), plus slow spin.
  const tSec = clampedFrame / (analysis.fps || 60);
  const rot = Math.PI / 2 + tSec * config.orbRotation;

  const bars: React.ReactNode[] = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2 + rot;
      // Bin selection: multi-lookup so 32 FFT bins can drive 100+ bars without
      // repeating a boxy pattern — combine three phase-shifted bins per bar.
      const b1 = analysis.binsEnv[
        frameOffset + Math.floor(((i * 3) % numBins))
      ] ?? 0;
      const b2 = analysis.binsEnv[
        frameOffset + Math.floor(((i * 7 + 5) % numBins))
      ] ?? 0;
      const b3 = analysis.binsEnv[
        frameOffset + Math.floor(((i * 11 + 13) % numBins))
      ] ?? 0;
      const magnitude = b1 * 0.55 + b2 * 0.3 + b3 * 0.2 + ampV * 0.12;
      const barLen = Math.max(barWpx * 0.6, magnitude * barLenMax);

      // A pill bar drawn as a thin capsule starting at the baseline and
      // pointing outward along the ring's radius.
      const x = cx + Math.cos(theta) * baselineR;
      const y = cy + Math.sin(theta) * baselineR;
      const angleDeg = (theta * 180) / Math.PI;

      out.push(
        <rect
          key={i}
          x={0}
          y={-barWpx / 2}
          width={barLen}
          height={barWpx}
          rx={barWpx / 2}
          fill={`url(#${barGradId})`}
          transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angleDeg.toFixed(3)})`}
        />,
      );
    }
    return out;
  }, [count, rot, analysis.binsEnv, frameOffset, numBins, ampV, barLenMax, barWpx, baselineR, cx, cy, barGradId]);

  return <g filter={`url(#${bloomId})`}>{bars}</g>;
};

// ---------------- ORB (particle sphere) -----------------

const ParticleOrb: React.FC<{
  analysis: Analysis;
  config: WaveformReelStyleConfig;
  bloomId: string;
  frame: number;
}> = ({ analysis, config, bloomId, frame }) => {
  const { numBins, totalFrames } = analysis;
  const cx = WR_WIDTH / 2;
  const cy = WR_HEIGHT / 2;
  const clampedFrame = Math.min(totalFrames - 1, Math.max(0, frame));
  const baseR = WR_WIDTH * Math.min(0.5, Math.max(0.1, config.orbRadius));
  const ampV = sampleAt(analysis.ampEnv, clampedFrame);
  const bass = sampleAt(analysis.bassEnv, clampedFrame);
  const R = baseR * (1 + ampV * 0.06 + bass * 0.1);
  const rot = (clampedFrame / (analysis.fps || 60)) * config.orbRotation;
  const frameOffset = clampedFrame * numBins;

  // Sample per-bin values once so ring + particles read the same "shape".
  const binVals = useMemo(() => {
    const arr = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      arr[k] = analysis.binsEnv[frameOffset + k] ?? 0;
    }
    return arr;
  }, [analysis.binsEnv, frameOffset, numBins]);

  const displacement = baseR * 0.42 * config.orbDisplacement;

  // ~950-point Fibonacci sphere projected to 2D. Each vertex offset radially
  // by an FFT bin lookup keyed off azimuth. Back-hemisphere points dimmed for
  // subtle depth.
  const N = 950;
  const particles = useMemo(() => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const arr: { x: number; y: number; r: number; a: number }[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const y0 = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(1 - y0 * y0);
      const theta = golden * i;
      const px0 = Math.cos(theta) * rr;
      const pz0 = Math.sin(theta) * rr;
      // Rotate around Y.
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const px = px0 * cr + pz0 * sr;
      const pz = -px0 * sr + pz0 * cr;
      const py = y0;

      const az = Math.atan2(pz, px);
      const binIdx =
        Math.floor((((az + Math.PI) / (Math.PI * 2)) * numBins)) % numBins;
      const b = binVals[Math.max(0, binIdx)] ?? 0;
      const disp = 1 + (b * 0.5 + ampV * 0.35) * (displacement / R);
      const rEff = R * disp;

      const proj = 1 / (2.2 - pz);
      const size = 1.4 + proj * 1.8 + b * 2.6;
      const rim = Math.max(0, 1 - Math.abs(pz)) * 0.55;
      const alpha = Math.min(1, 0.18 + proj * 0.55 + rim + config.glow * 0.12);

      arr[i] = {
        x: cx + px * rEff,
        y: cy + py * rEff,
        r: size,
        a: alpha,
      };
    }
    return arr;
  }, [N, rot, numBins, binVals, ampV, R, displacement, config.glow, cx, cy]);

  // Rim ring: soft outer stroke to give the sphere silhouette a highlight.
  const rimStroke = 2 + config.glow * 3.5;

  return (
    <g filter={`url(#${bloomId})`}>
      {/* Rim ring behind particles. */}
      <circle
        cx={cx}
        cy={cy}
        r={R * (1 + config.orbDisplacement * 0.02)}
        fill="none"
        stroke={WR_FG}
        strokeOpacity={0.35 + bass * 0.35}
        strokeWidth={rimStroke}
      />
      {particles.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.r}
          fill={WR_FG}
          fillOpacity={p.a}
        />
      ))}
    </g>
  );
};
