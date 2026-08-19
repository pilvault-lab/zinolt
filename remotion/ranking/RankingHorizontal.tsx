/**
 * Ranking — HORIZONTAL bar chart variant.
 *
 * Layout:
 *   • Title pinned at the top (same style as vertical).
 *   • 10 rows stacked top→bottom. Row order: rank 1 at top, rank 10 at bottom.
 *   • Each row: rank | name | bar (grows left→right) | value counter.
 *   • Bar width proportional to metric value; #1 has the widest bar.
 *
 * Reveal sequence:
 *   • Rank 10 (BOTTOM) enters first.
 *   • Cascade upward — 9, 8, 7 …
 *   • Rank 1 (TOP) enters last and locks in.
 *
 * Motion reuses the same lib (overshoot spring, velocityBlur, impactPop,
 * aeEaseOut counter roll). All fonts Vernavle. No CTA at the end.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  Easing,
} from "remotion";
import type { Ranking } from "../../lib/ranking/types";
import richestMen2026 from "../../lib/ranking/data/richest-men-2026";
import { RANKINGS } from "../../lib/ranking";
import {
  RK_FPS,
  RK_HEIGHT,
  RK_TOTAL_FRAMES,
  RK_WIDTH,
  RK_RISE_FRAMES,
  RK_IMPACT,
  RK_DEFAULT_TOP_N,
  SAFE_TOP_Y,
  SAFE_BOTTOM_Y,
} from "./config";
import {
  SPRINGS,
  aeEaseOutCurve,
  velocityBlur,
  impactPop,
} from "../../lib/motion";

/* ---------- Font (Vernavle throughout) --------------------------------- */
const loadFontOnce = (family: string, path: string) => {
  if (typeof window === "undefined") return;
  const face = new FontFace(family, `url(${staticFile(path)}) format('woff2')`);
  face.load().then(() => document.fonts.add(face)).catch(() => {});
};
loadFontOnce("Vernavle", "brand/vernavle-font.woff2");

const FONT = "Vernavle, 'Times New Roman', serif";
const VERNAVLE_LOGO = staticFile("brand/vernavle-logo.png");

/* ---------- Props ------------------------------------------------------- */
export type RankingHorizontalProps = {
  ranking: Ranking;
  slug?: string;
  titleOverride?: string;
  topN?: number;
  useInitials?: boolean;
  forRender?: boolean;
};

export const rankingHorizontalDefaultProps: RankingHorizontalProps = {
  ranking: richestMen2026,
  topN: RK_DEFAULT_TOP_N,
};

/* ---------- Formatters -------------------------------------------------- */
function formatValue(v: number, fmt: Ranking["format"]): string {
  const fmtN = (x: number) => x.toLocaleString("en-US");
  const one = (x: number) =>
    (Math.round(x * 10) / 10).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  if (fmt === "usd-t") return `$${one(v)}T`;
  if (fmt === "usd-b1") return `$${one(v)}B`;
  if (fmt === "num-b") return `${one(v)}B`;
  const n = Math.round(v);
  switch (fmt) {
    case "usd-b": return `$${fmtN(n)}B`;
    case "usd-m": return `$${fmtN(n)}M`;
    case "usd":   return `$${fmtN(n)}`;
    case "pct":   return `${fmtN(n)}%`;
    case "int":
    default:      return fmtN(n);
  }
}

function autoTitleForN(rawTitle: string, topN: number): string {
  return rawTitle.replace(/^\s*Top\s+\d+\b/i, `Top ${topN}`);
}

/* ---------- Layout knobs ------------------------------------------------ */
const RH = {
  edgeX: 60,

  titleTop: 130,
  titleSize: 74,

  cornerLogoHeight: 120,
  cornerLogoTop: 60,
  cornerLogoRight: 52,

  // Row band — vertically CENTERED between title bottom (~200) and the top
  // of the platform-UI zone (~1250 where TikTok's like/comment/share start).
  // Content center ≈ y=725, so the stack sits in the middle of the visible
  // area instead of hugging the top.
  rowsTop: 360,
  rowsBottom: 1250,
  rowGap: 22,

  // Row internal columns (widths in px within RK_WIDTH minus edgeX * 2).
  //   [rank ] [ name ] [ bar ] [ value ]
  rankWidth: 60,
  gapAfterRank: 14,
  nameWidth: 260,
  gapAfterName: 18,
  gapBeforeValue: 14,
  valueWidth: 160,
  // Bar fills whatever is left.

  barHeight: 44,
  barRadius: 6,
  barMinWidth: 14, // never render a bar as literally zero pixels once entered

  // Fonts.
  rankSize: 30,
  nameSize: 32,
  valueSize: 34,

  // Winner glow bloom.
  winnerGlowBlur: 40,
  winnerGlowOpacity: 0.7,
} as const;

const CONTENT_WIDTH = RK_WIDTH - RH.edgeX * 2;
const BAR_LEFT_X =
  RH.rankWidth + RH.gapAfterRank + RH.nameWidth + RH.gapAfterName;
const BAR_RIGHT_X = CONTENT_WIDTH - RH.valueWidth - RH.gapBeforeValue;
const MAX_BAR_WIDTH = BAR_RIGHT_X - BAR_LEFT_X;

/* ---------- CornerLogo -------------------------------------------------- */
const CornerLogo: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: RH.cornerLogoTop,
      right: RH.cornerLogoRight,
      height: RH.cornerLogoHeight,
      pointerEvents: "none",
      opacity: 0.92,
      zIndex: 40,
    }}
  >
    <Img src={VERNAVLE_LOGO} alt="VERNAVLE" style={{ height: "100%", width: "auto", display: "block" }} />
  </div>
);

/* ---------- TitleBar ---------------------------------------------------- */
const TitleBar: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: SPRINGS.snappyUI });
  const y = interpolate(s, [0, 1], [-30, 0]);
  const op = interpolate(s, [0, 1], [0, 1]);
  return (
    <div
      style={{
        position: "absolute",
        top: RH.titleTop,
        left: RH.edgeX,
        right: RH.edgeX,
        transform: `translateY(${y}px)`,
        opacity: op,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 30,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: RH.titleSize,
          color: "#fff",
          letterSpacing: "-0.025em",
          textTransform: "uppercase",
          lineHeight: 1.02,
          textAlign: "center",
          fontFeatureSettings: '"kern" 1, "liga" 1',
        }}
      >
        {title}
      </div>
    </div>
  );
};

/* ---------- Row --------------------------------------------------------- */
const Row: React.FC<{
  entry: Ranking["entries"][number];
  fmt: Ranking["format"];
  y: number;
  targetBarWidth: number;
  entryStartFrame: number;
  lockFrame: number;
  isWinner: boolean;
}> = ({ entry, fmt, y, targetBarWidth, entryStartFrame, lockFrame, isWinner }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Bar width — overshoot spring over 2s.
  const widthAt = React.useCallback(
    (f: number) => {
      const s = spring({
        frame: Math.max(0, f - entryStartFrame),
        fps,
        config: SPRINGS.overshoot,
        durationInFrames: RK_RISE_FRAMES,
      });
      return targetBarWidth * s;
    },
    [targetBarWidth, entryStartFrame, fps],
  );
  const barWidth = widthAt(frame);
  const blurPx = velocityBlur(frame, widthAt, 12, 0.5);

  // Value counter — aeEaseOut over the same window.
  const counterT = interpolate(
    frame,
    [entryStartFrame, entryStartFrame + RK_RISE_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const counterEased = Easing.bezier(...aeEaseOutCurve)(counterT);
  const displayValue = entry.value * counterEased;

  // Winner glow bloom at lock.
  const winnerBloom = isWinner
    ? interpolate(
        frame,
        [lockFrame - 4, lockFrame, lockFrame + 30, lockFrame + 60],
        [0, 1, 0.65, 0.65],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;
  const glowBlurPx = isWinner ? RH.winnerGlowBlur * winnerBloom : 0;
  const glowAlpha = isWinner ? RH.winnerGlowOpacity * winnerBloom : 0;

  // Row entry fade (rank + name + value fade in ~10 frames before bar starts).
  const rowFadeT = interpolate(
    frame,
    [entryStartFrame - 8, entryStartFrame + 4],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Non-winner rows dim slightly compared to the winner once it locks.
  const passedDim =
    isWinner || frame < lockFrame
      ? 1
      : interpolate(frame, [lockFrame, lockFrame + 20], [1, 0.68], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const opacity = rowFadeT * passedDim;

  return (
    <div
      style={{
        position: "absolute",
        left: RH.edgeX,
        top: y,
        width: CONTENT_WIDTH,
        height: RH.barHeight + 6,
        display: "flex",
        alignItems: "center",
        opacity,
        willChange: "opacity",
      }}
    >
      {/* Rank number — right-aligned in its column. */}
      <div
        style={{
          width: RH.rankWidth,
          textAlign: "right",
          fontFamily: FONT,
          fontSize: RH.rankSize,
          color: isWinner ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)",
          letterSpacing: "-0.03em",
        }}
      >
        {entry.rank}
      </div>

      {/* Name — left-aligned, single line, auto-shrunk to fit its column. */}
      {(() => {
        const available = RH.nameWidth - 8;
        const wantFont = available / (entry.name.length * 0.55);
        const nameFontSize = Math.max(12, Math.min(RH.nameSize, Math.floor(wantFont)));
        return (
          <div
            style={{
              width: RH.nameWidth,
              marginLeft: RH.gapAfterRank,
              fontFamily: FONT,
              fontSize: nameFontSize,
              color: isWinner ? "#fff" : "rgba(255,255,255,0.92)",
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              fontFeatureSettings: '"kern" 1',
            }}
          >
            {entry.name}
          </div>
        );
      })()}

      {/* Bar — grows left→right with overshoot. */}
      <div
        style={{
          marginLeft: RH.gapAfterName,
          width: MAX_BAR_WIDTH,
          height: RH.barHeight,
          position: "relative",
          background: "rgba(255,255,255,0.06)",
          borderRadius: RH.barRadius,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: Math.max(barWidth > 0 ? RH.barMinWidth : 0, barWidth),
            borderRadius: RH.barRadius,
            background: isWinner
              ? `linear-gradient(90deg, rgba(255,255,255,${0.9 + winnerBloom * 0.1}) 0%, rgba(255,255,255,0.75) 100%)`
              : "linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.55) 100%)",
            boxShadow: isWinner && winnerBloom > 0.1
              ? `0 0 ${glowBlurPx}px rgba(255,255,255,${glowAlpha})`
              : undefined,
            filter: blurPx > 0.4 ? `blur(${blurPx * 0.6}px)` : undefined,
            willChange: "width, filter",
          }}
        />
      </div>

      {/* Value counter — LEFT-aligned so it hugs the end of the bar rather
          than floating at the far right of the frame. Tabular, no jitter. */}
      <div
        style={{
          marginLeft: RH.gapBeforeValue,
          width: RH.valueWidth,
          textAlign: "left",
          fontFamily: FONT,
          fontSize: RH.valueSize,
          color: isWinner ? "#fff" : "rgba(255,255,255,0.95)",
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "lnum" 1',
          whiteSpace: "nowrap",
          textShadow: isWinner && winnerBloom > 0.1
            ? `0 0 ${glowBlurPx * 0.4}px rgba(255,255,255,${glowAlpha})`
            : undefined,
        }}
      >
        {formatValue(displayValue, fmt)}
      </div>
    </div>
  );
};

/* ---------- Stage (rows + impact) --------------------------------------- */
const Stage: React.FC<{
  entries: Ranking["entries"];
  fmt: Ranking["format"];
  lockFrame: number;
  riseStartFrame: number;
}> = ({ entries, fmt, lockFrame, riseStartFrame }) => {
  const frame = useCurrentFrame();

  // Row visual order: rank 1 at TOP, rank 10 at BOTTOM.
  const sortedForLayout = React.useMemo(
    () => [...entries].sort((a, b) => a.rank - b.rank),
    [entries],
  );
  const maxVal = React.useMemo(
    () => Math.max(...entries.map((e) => e.value)),
    [entries],
  );

  const rowsSpace = RH.rowsBottom - RH.rowsTop;
  const rowHeight = RH.barHeight + 6;
  const gap = Math.max(
    RH.rowGap,
    (rowsSpace - rowHeight * sortedForLayout.length) / Math.max(1, sortedForLayout.length - 1),
  );

  const impactScale = impactPop(frame, lockFrame, RK_IMPACT.peak, RK_IMPACT.durFrames);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${impactScale})`,
        transformOrigin: `50% ${(RH.rowsTop + RH.rowsBottom) / 2}px`,
      }}
    >
      {sortedForLayout.map((entry, layoutIdx) => {
        const y = RH.rowsTop + layoutIdx * (rowHeight + gap);
        // Cascade order: rank 10 first, then 9, 8, … 1. So entryStart for rank K =
        // riseStartFrame + (N - K) * perPedestalFrames.
        const N = sortedForLayout.length;
        const cascadeIdx = N - entry.rank;
        const entryStartFrame = riseStartFrame + cascadeIdx * RK_RISE_FRAMES;
        const targetBarWidth = Math.max(
          RH.barMinWidth,
          (entry.value / maxVal) * MAX_BAR_WIDTH,
        );
        return (
          <Row
            key={entry.rank}
            entry={entry}
            fmt={fmt}
            y={y}
            targetBarWidth={targetBarWidth}
            entryStartFrame={entryStartFrame}
            lockFrame={lockFrame}
            isWinner={entry.rank === 1}
          />
        );
      })}
    </div>
  );
};

/* ---------- Root -------------------------------------------------------- */
export const RankingHorizontalComposition: React.FC<RankingHorizontalProps> = (props) => {
  const {
    ranking: rankingProp,
    slug,
    titleOverride,
    topN = RK_DEFAULT_TOP_N,
  } = props;

  const ranking = React.useMemo<Ranking>(() => {
    if (slug) {
      const found = RANKINGS.find((r) => r.slug === slug);
      if (found) return found;
    }
    return rankingProp;
  }, [slug, rankingProp]);

  const title = (titleOverride?.trim() || autoTitleForN(ranking.title, topN)).trim();

  const entries = React.useMemo(
    () => [...ranking.entries].sort((a, b) => a.rank - b.rank).slice(0, topN),
    [ranking.entries, topN],
  );

  // Timing: 0.3s startup + N*2s sequential rise + 3s hold. No CTA.
  const riseStartFrame = Math.round(0.3 * RK_FPS);
  const riseEndFrame = riseStartFrame + entries.length * RK_RISE_FRAMES;
  const lockFrame = riseEndFrame;

  return (
    <AbsoluteFill style={{ background: "#0A0A0A", overflow: "hidden" }}>
      {/* Subtle grid inside safe band. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: SAFE_TOP_Y,
          height: SAFE_BOTTOM_Y - SAFE_TOP_Y,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
          opacity: 0.5,
          pointerEvents: "none",
        }}
      />
      {/* Vignette. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 55%, transparent 40%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }}
      />

      <TitleBar title={title} />

      <Stage
        entries={entries}
        fmt={ranking.format}
        lockFrame={lockFrame}
        riseStartFrame={riseStartFrame}
      />

      <CornerLogo />
    </AbsoluteFill>
  );
};

export { RK_FPS, RK_HEIGHT, RK_WIDTH, RK_TOTAL_FRAMES };
