import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  staticFile,
  delayRender,
  continueRender,
  Easing,
} from "remotion";
import type { Ranking } from "../../lib/ranking/types";
import richestMen2026 from "../../lib/ranking/data/richest-men-2026";
import {
  RK_FPS,
  RK_HEIGHT,
  RK_LAYOUT,
  RK_SECTIONS,
  RK_TOTAL_FRAMES,
  RK_WIDTH,
  RK_RISE_FRAMES,
  RK_DEPTH,
  RK_IMPACT,
  RK_DEFAULT_TOP_N,
  SAFE_TOP_Y,
  SAFE_BOTTOM_Y,
  sec,
  computeRankingTiming,
  computePedestalGeom,
} from "./config";
import {
  SPRINGS,
  aeEaseOutCurve,
  smoothZCurve,
  velocityBlur,
  impactPop,
} from "../../lib/motion";

/* ---------- Fonts — Vernavle EVERYWHERE. --------------------------------- */
const loadFontOnce = (family: string, path: string) => {
  if (typeof window === "undefined") return;
  const handle = delayRender(family);
  const face = new FontFace(family, `url(${staticFile(path)}) format('woff2')`);
  face
    .load()
    .then(() => {
      document.fonts.add(face);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
};
loadFontOnce("Vernavle", "brand/vernavle-font.woff2");

const FONT = "Vernavle, 'Times New Roman', serif";
const VERNAVLE_LOGO = staticFile("brand/vernavle-logo.png");

/* ---------- Props -------------------------------------------------------- */

export type RankingProps = {
  ranking: Ranking;
  titleOverride?: string;
  /** Number of ranked entries to show. Default = RK_DEFAULT_TOP_N (5). */
  topN?: number;
  /** Force initials-in-circle instead of portrait photos. */
  useInitials?: boolean;
  forRender?: boolean;
};

export const rankingDefaultProps: RankingProps = {
  ranking: richestMen2026,
  topN: RK_DEFAULT_TOP_N,
  useInitials: false,
};

/* ---------- Value formatter --------------------------------------------- */

/**
 * Value formatter. INTEGER-ONLY output for all formats — decimals during a
 * counter roll jitter (e.g. 292.1 → 292.4 → 292.3), so we round to integer
 * and let the tabular-nums font handle the visual stability.
 */
function formatValue(v: number, fmt: Ranking["format"]): string {
  const n = Math.round(v);
  const fmtN = (x: number) => x.toLocaleString("en-US");
  switch (fmt) {
    case "usd-b": return `$${fmtN(n)}B`;
    case "usd-m": return `$${fmtN(n)}M`;
    case "usd":   return `$${fmtN(n)}`;
    case "pct":   return `${fmtN(n)}%`;
    case "int":
    default:      return fmtN(n);
  }
}

/**
 * Auto-title: if the ranking title starts with "Top {number}", swap the
 * number to match the current `topN` prop. Keeps the rest of the title.
 * Falls back to the raw title if no leading "Top N" pattern is present.
 */
function autoTitleForN(rawTitle: string, topN: number): string {
  return rawTitle.replace(/^\s*Top\s+\d+\b/i, `Top ${topN}`);
}

/** Return only the surname (last space-separated token) for compact labels. */
function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

/* ---------- Corner watermark -------------------------------------------- */

const CornerLogo: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: RK_LAYOUT.cornerLogoTop,
      right: RK_LAYOUT.cornerLogoRight,
      height: RK_LAYOUT.cornerLogoHeight,
      pointerEvents: "none",
      opacity: 0.92,
      zIndex: 40,
    }}
  >
    <Img
      src={VERNAVLE_LOGO}
      alt="VERNAVLE"
      style={{ height: "100%", width: "auto", display: "block" }}
    />
  </div>
);

/* ---------- Title (pinned, width-constrained to clear corner logo) ------ */

const TitleBar: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: SPRINGS.snappyUI });
  const y = interpolate(s, [0, 1], [-30, 0]);
  const op = interpolate(s, [0, 1], [0, 1]);

  // Centered horizontally, lowered so it sits BELOW the corner logo (no
  // collision possible). Tight tracking + kerning-on for a polished feel.
  return (
    <div
      style={{
        position: "absolute",
        top: RK_LAYOUT.titleTop,
        left: RK_LAYOUT.edgeX,
        right: RK_LAYOUT.edgeX,
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
          fontSize: RK_LAYOUT.titleSize,
          color: "#fff",
          letterSpacing: "-0.025em",
          textTransform: "uppercase",
          lineHeight: 1.02,
          textAlign: "center",
          overflowWrap: "break-word",
          fontFeatureSettings: '"kern" 1, "liga" 1',
        }}
      >
        {title}
      </div>
    </div>
  );
};

/* ---------- Single pedestal --------------------------------------------- */

const Pedestal: React.FC<{
  entry: Ranking["entries"][number];
  fmt: Ranking["format"];
  targetHeightPx: number;
  x: number;
  entryStartFrame: number;
  lockFrame: number;
  useInitials: boolean;
  isWinner: boolean;
  geom: ReturnType<typeof computePedestalGeom>;
}> = ({
  entry, fmt, targetHeightPx, x, entryStartFrame, lockFrame, useInitials, isWinner, geom,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Height driven by an OVERSHOOT spring with a FIXED duration (2s) so each
  // pedestal takes the full budgeted time to settle — visible weight, not a snap.
  const heightAt = React.useCallback(
    (f: number) =>
      targetHeightPx *
      spring({
        frame: Math.max(0, f - entryStartFrame),
        fps,
        config: SPRINGS.overshoot,
        durationInFrames: RK_RISE_FRAMES,
      }),
    [targetHeightPx, entryStartFrame, fps],
  );
  const barHeight = heightAt(frame);

  const blurPx = velocityBlur(frame, heightAt, 12, 0.5);

  // Depth entrance — resolves flat via smoothZ.
  const depthT = interpolate(
    frame,
    [entryStartFrame, entryStartFrame + RK_DEPTH.entryDurFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const depthEased = Easing.bezier(...smoothZCurve)(depthT);
  const tz = interpolate(depthEased, [0, 1], [RK_DEPTH.entryTranslateZ, 0]);
  const rx = interpolate(depthEased, [0, 1], [RK_DEPTH.entryRotateX, 0]);
  const depthOpacity = interpolate(depthEased, [0, 0.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Value counter — aeEaseOut over the same duration as the rise.
  const counterT = interpolate(
    frame,
    [entryStartFrame, entryStartFrame + RK_RISE_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const counterEased = Easing.bezier(...aeEaseOutCurve)(counterT);
  const displayValue = entry.value * counterEased;

  // Winner glow bloom at lock moment.
  const winnerBloom = isWinner
    ? interpolate(
        frame,
        [lockFrame - 4, lockFrame, lockFrame + 30, lockFrame + 90],
        [0, 1, 0.6, 0.6],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 0;
  const glowBlurPx = isWinner ? RK_LAYOUT.winnerGlowBlur * winnerBloom : 0;
  const glowStrength = isWinner ? RK_LAYOUT.winnerGlowOpacity * winnerBloom : 0;

  const baseY = RK_LAYOUT.baseY;
  const barW = geom.barWidth;
  const portraitSize = geom.portraitSize;
  const valueSize = geom.valueSize;

  const barTopY = baseY - barHeight;
  const portraitY = barTopY - RK_LAYOUT.portraitGap - portraitSize;
  const valueY = portraitY - RK_LAYOUT.valueGap - valueSize - 6;

  const initials = entry.name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const showPhoto = !useInitials && Boolean(entry.image);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 0,
        width: barW,
        height: RK_HEIGHT,
        transform: `translate3d(0, 0, ${tz}px) rotateX(${rx}deg)`,
        transformOrigin: `50% ${baseY}px`,
        transformStyle: "preserve-3d",
        opacity: depthOpacity,
        willChange: "transform, opacity",
      }}
    >
      {/* Value counter — motion-blurred while rising. */}
      <div
        style={{
          position: "absolute",
          left: barW / 2,
          top: valueY,
          transform: "translateX(-50%)",
          fontFamily: FONT,
          fontSize: valueSize,
          color: "#fff",
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "lnum" 1',
          textAlign: "center",
          whiteSpace: "nowrap",
          filter: blurPx > 0.4 ? `blur(${blurPx}px)` : undefined,
          textShadow: isWinner && winnerBloom > 0.1
            ? `0 0 ${glowBlurPx * 0.4}px rgba(255,255,255,${glowStrength})`
            : "0 0 6px rgba(255,255,255,0.35)",
          willChange: "filter",
        }}
      >
        {formatValue(displayValue, fmt)}
      </div>

      {/* Portrait circle. */}
      <div
        style={{
          position: "absolute",
          left: (barW - portraitSize) / 2,
          top: portraitY,
          width: portraitSize,
          height: portraitSize,
          borderRadius: "50%",
          overflow: "hidden",
          border: `${RK_LAYOUT.portraitBorder}px solid rgba(255,255,255,0.9)`,
          boxShadow: isWinner && winnerBloom > 0.1
            ? `0 0 ${glowBlurPx}px rgba(255,255,255,${glowStrength})`
            : "0 4px 24px rgba(0,0,0,0.6)",
          background: "#1A1A1A",
          filter: blurPx > 0.4 ? `blur(${blurPx * 0.7}px)` : undefined,
          willChange: "filter, box-shadow",
        }}
      >
        {showPhoto ? (
          <Img
            src={staticFile((entry.image as string).replace(/^\//, ""))}
            alt={entry.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT,
              fontSize: portraitSize * 0.42,
              color: "#fff",
              letterSpacing: "-0.02em",
              background: "linear-gradient(135deg,#2A2A2A 0%,#0F0F0F 100%)",
            }}
          >
            {initials}
          </div>
        )}
      </div>

      {/* The pedestal (bar) itself. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: barTopY,
          width: barW,
          height: barHeight,
          background: isWinner
            ? `linear-gradient(180deg, rgba(255,255,255,${0.14 + winnerBloom * 0.14}) 0%, rgba(255,255,255,0.05) 100%)`
            : "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 100%)",
          border: `1.5px solid rgba(255,255,255,${isWinner ? 0.85 : 0.55})`,
          boxShadow: isWinner && winnerBloom > 0.1
            ? `0 0 ${glowBlurPx * 0.6}px rgba(255,255,255,${glowStrength * 0.8})`
            : undefined,
          overflow: "hidden",
        }}
      >
        {/* Ghost rank number inside pedestal. */}
        <div
          style={{
            position: "absolute",
            bottom: 26,
            left: 0,
            right: 0,
            fontFamily: FONT,
            fontSize: geom.rankGhostSize,
            color: "#fff",
            opacity: 0.22,
            textAlign: "center",
            lineHeight: 0.9,
            letterSpacing: "-0.06em",
          }}
        >
          {entry.rank}
        </div>
      </div>

      {/* Horizontal name label — SURNAME only for compactness. Sits just
          below the base line, inside the safe band. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: RK_LAYOUT.nameLabelTop,
          width: barW,
          height: RK_LAYOUT.nameLabelHeight,
          fontFamily: FONT,
          fontSize: geom.nameLabelSize,
          color: "rgba(255,255,255,0.9)",
          letterSpacing: "-0.005em",
          textTransform: "uppercase",
          textAlign: "center",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          padding: "0 2px",
          fontFeatureSettings: '"kern" 1',
        }}
      >
        {lastName(entry.name)}
      </div>
    </div>
  );
};

/* ---------- CTA (over-the-stage) ---------------------------------------- */

const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: SPRINGS.snappyUI });
  const op = interpolate(s, [0, 1], [0, 1]);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 30,
        opacity: op,
        pointerEvents: "none",
        background: "rgba(10,10,10,0.78)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: 156,
          color: "#fff",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        VERNAVLE
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 50,
          color: "rgba(255,255,255,0.85)",
          letterSpacing: "0.28em",
          textTransform: "uppercase",
        }}
      >
        Follow for more
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Stage --------------------------------------------------------- */

const Stage: React.FC<{
  entries: Ranking["entries"];
  fmt: Ranking["format"];
  useInitials: boolean;
  timing: ReturnType<typeof computeRankingTiming>;
  geom: ReturnType<typeof computePedestalGeom>;
}> = ({ entries, fmt, useInitials, timing, geom }) => {
  const frame = useCurrentFrame();

  // Sort so lowest rank (highest N) enters FIRST, top rank (#1) enters LAST.
  const sorted = React.useMemo(
    () => [...entries].sort((a, b) => b.rank - a.rank),
    [entries],
  );

  const maxVal = React.useMemo(
    () => Math.max(...entries.map((e) => e.value)),
    [entries],
  );

  const totalBarWidth =
    geom.barWidth * sorted.length + geom.barGap * (sorted.length - 1);
  const startX = (RK_WIDTH - totalBarWidth) / 2;

  const impactScale = impactPop(frame, timing.lockF, RK_IMPACT.peak, RK_IMPACT.durFrames);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        perspective: `${RK_DEPTH.perspective}px`,
        transformStyle: "preserve-3d",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${impactScale})`,
          transformOrigin: `50% ${RK_LAYOUT.baseY}px`,
          willChange: "transform",
        }}
      >
        {/* Ground line — subtle. Constrained to safe band. */}
        <div
          style={{
            position: "absolute",
            left: RK_LAYOUT.edgeX,
            right: RK_LAYOUT.edgeX,
            top: RK_LAYOUT.baseY,
            height: 1,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 15%, rgba(255,255,255,0.35) 85%, rgba(255,255,255,0) 100%)",
            zIndex: 5,
          }}
        />

        {sorted.map((entry, i) => {
          const x = startX + i * (geom.barWidth + geom.barGap);
          const rawH = (entry.value / maxVal) * RK_LAYOUT.maxBarHeight;
          const targetH = Math.max(RK_LAYOUT.minBarHeight, rawH);
          // Sequential — each pedestal starts when the previous finishes.
          const entryStartFrame = timing.riseStartF + i * RK_RISE_FRAMES;
          return (
            <Pedestal
              key={entry.rank}
              entry={entry}
              fmt={fmt}
              targetHeightPx={targetH}
              x={x}
              entryStartFrame={entryStartFrame}
              lockFrame={timing.lockF}
              useInitials={useInitials}
              isWinner={entry.rank === 1}
              geom={geom}
            />
          );
        })}
      </div>
    </div>
  );
};

/* ---------- Root -------------------------------------------------------- */

export const RankingComposition: React.FC<RankingProps> = (props) => {
  const {
    ranking,
    titleOverride,
    topN = RK_DEFAULT_TOP_N,
    useInitials = false,
  } = props;

  // Title source: manual override wins; otherwise auto-swap "Top N" from the
  // ranking's declared title to match the current `topN` prop.
  const title = (titleOverride?.trim() || autoTitleForN(ranking.title, topN)).trim();

  // Filter to top-N entries by rank.
  const entries = React.useMemo(
    () =>
      [...ranking.entries]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, topN),
    [ranking.entries, topN],
  );

  const timing = React.useMemo(() => computeRankingTiming(entries.length), [entries.length]);
  const geom = React.useMemo(() => computePedestalGeom(entries.length), [entries.length]);

  return (
    <AbsoluteFill style={{ background: "#0A0A0A", overflow: "hidden" }}>
      {/* Subtle grid texture — spans safe band only. */}
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

      <Stage entries={entries} fmt={ranking.format} useInitials={useInitials} timing={timing} geom={geom} />

      <Sequence from={timing.ctaStartF}>
        <Cta />
      </Sequence>

      <CornerLogo />
    </AbsoluteFill>
  );
};

export {
  RK_FPS,
  RK_HEIGHT,
  RK_WIDTH,
  RK_TOTAL_FRAMES,
  richestMen2026,
  computeRankingTiming,
};
