import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  DM_COPY,
  DM_DUR,
  DM_FPS,
  DM_HEIGHT,
  DM_LAUNCH_RUNWAY_FRAC,
  DM_PALETTE,
  DM_PICK_COUNT,
  DM_SIZES,
  DM_SPRINGS,
  DM_STROKE,
  DM_TOTAL_FRAMES,
  DM_WIDTH,
  DM_Y_PADDING_FRAC,
  sec,
} from "./config";

/* ---------- Fonts ----------------------------------------------------- */
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

const FONT_DISPLAY = "Vernavle, 'Helvetica Neue', serif";
const FONT_NUM = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const VERNAVLE_LOGO = staticFile("brand/vernavle-logo.png");

/* ---------- Props ---------------------------------------------------- */

export type DailyMoversMover = {
  symbol: string;
  name: string;
  changePercent: number;
  price: number;
  previousClose: number;
  intraday: Array<{ minute: number; pct: number }>;
  sessionTime: number;
};

export type DailyMoversProps = {
  dateLabel: string;
  picks: DailyMoversMover[];
  forRender?: boolean;
};

/* ---------- Studio-only sample fixtures ---------------------------- */
const N_SAMPLE = 79;
function makeSample(kind: "gap-up-cruise" | "gap-flat-rally" | "gap-up-drift" | "gap-down-crash" | "chop") {
  const arr: Array<{ minute: number; pct: number }> = [];
  const initialGap = kind === "gap-up-cruise" ? 5 : kind === "gap-flat-rally" ? 0.5 : kind === "gap-up-drift" ? 12 : kind === "gap-down-crash" ? -8 : 2;
  for (let i = 0; i < N_SAMPLE; i++) {
    const t = i / (N_SAMPLE - 1);
    let intraMove = 0;
    if (kind === "gap-up-cruise")   intraMove = t * 22 + Math.sin(i / 5) * 1.5;
    if (kind === "gap-flat-rally")  intraMove = t * 3 + (t > 0.5 ? (t - 0.5) * 50 : 0) + Math.sin(i / 8);
    if (kind === "gap-up-drift")    intraMove = t * 12 - Math.abs(Math.sin(i / 6)) * 2;
    if (kind === "gap-down-crash")  intraMove = -t * 18 + Math.cos(i / 6) * 3;
    if (kind === "chop")            intraMove = Math.sin(i / 4) * 6 + t * 3;
    arr.push({ minute: i * 5, pct: initialGap + intraMove });
  }
  return arr;
}
export const dailyMoversDefaultProps: DailyMoversProps = {
  dateLabel: "WED · JUL 30",
  picks: [
    { symbol: "IREN", name: "IREN",                changePercent:  30.5, price: 22.3,  previousClose: 17.1, intraday: makeSample("gap-up-cruise"),  sessionTime: 0 },
    { symbol: "ALNY", name: "Alnylam Pharma",      changePercent: -28.3, price: 165.0, previousClose: 230.2, intraday: makeSample("gap-down-crash"),sessionTime: 0 },
    { symbol: "CORT", name: "Corcept Therapeutics",changePercent:  27.3, price: 90.1,  previousClose: 70.8, intraday: makeSample("gap-up-drift"),   sessionTime: 0 },
    { symbol: "NBIS", name: "Nebius Group",        changePercent:  27.1, price: 47.8,  previousClose: 37.6, intraday: makeSample("gap-flat-rally"), sessionTime: 0 },
    { symbol: "BE",   name: "Bloom Energy",        changePercent:  26.5, price: 61.0,  previousClose: 48.2, intraday: makeSample("chop"),           sessionTime: 0 },
  ],
};

/* ---------- Helpers -------------------------------------------------- */

const fmtPct = (n: number, digits = 2) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

function smoothPcts(pcts: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return pcts.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(pcts.length, i + half + 1);
    let s = 0;
    for (let k = lo; k < hi; k++) s += pcts[k];
    return s / (hi - lo);
  });
}

function sampleAt(arr: number[], idx: number): number {
  const i0 = Math.max(0, Math.min(arr.length - 1, Math.floor(idx)));
  const i1 = Math.max(0, Math.min(arr.length - 1, i0 + 1));
  const t = Math.max(0, Math.min(1, idx - i0));
  return arr[i0] * (1 - t) + arr[i1] * t;
}

function buildTimeWarp(pctsMatrix: number[][]) {
  const M = pctsMatrix.length;
  if (M === 0) return (t: number) => t;
  const N = pctsMatrix[0].length;
  if (N < 2) return (t: number) => t;
  const weights = new Array(N).fill(1);
  // ORIGIN BURST — extra dwell at t=0 and t=1 so the "converge at 0,0
  // then blast apart into opening gaps" moment reads as its own beat.
  // Together these give ~0.5s of concentrated screen time at the very
  // start before the normal race progression takes over.
  weights[0] += 10;
  weights[1] += 5;
  let prevRank = new Array(M).fill(0);
  {
    const w = pctsMatrix.map((p, i) => ({ i, v: p[0] })).sort((a, b) => b.v - a.v);
    w.forEach((x, r) => (prevRank[x.i] = r));
  }
  for (let t = 1; t < N; t++) {
    const w = pctsMatrix.map((p, i) => ({ i, v: p[t] })).sort((a, b) => b.v - a.v);
    const rank = new Array(M);
    w.forEach((x, r) => (rank[x.i] = r));
    let swaps = 0;
    for (let i = 0; i < M; i++) if (rank[i] !== prevRank[i]) swaps++;
    for (let d = -4; d <= 4; d++) {
      const idx = t + d;
      if (idx >= 0 && idx < N) weights[idx] += swaps * (1 - Math.abs(d) / 5);
    }
    prevRank = rank;
  }
  const cdf: number[] = new Array(N + 1);
  cdf[0] = 0;
  for (let i = 0; i < N; i++) cdf[i + 1] = cdf[i] + weights[i];
  const total = cdf[N];
  for (let i = 0; i <= N; i++) cdf[i] /= total;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const x0 = cdf[lo - 1];
    const x1 = cdf[lo];
    const denom = Math.max(1e-9, x1 - x0);
    const alpha = (t - x0) / denom;
    return (lo - 1 + alpha) / N;
  };
}

/* ---------- Header (attached above the chart) ---------------------- */

const Header: React.FC<{ dateLabel: string }> = ({ dateLabel }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [sec(0.1), sec(0.9)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top: DM_SIZES.headerTop,
        left: 0,
        right: 0,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        opacity: op,
        transform: `translateY(${interpolate(op, [0, 1], [-6, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: DM_SIZES.headerHeadline,
          letterSpacing: "0.18em",
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        {DM_COPY.headerHeadline}
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: DM_SIZES.headerDate,
          letterSpacing: "0.3em",
          opacity: 0.55,
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        {dateLabel}
      </span>
    </div>
  );
};

/* ---------- Corner mark + grain ------------------------------------- */

const CornerLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [sec(0.2), sec(0.9)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [DM_TOTAL_FRAMES - sec(0.5), DM_TOTAL_FRAMES],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <Img
      src={VERNAVLE_LOGO}
      style={{
        position: "absolute",
        top: DM_SIZES.cornerLogoTop,
        right: DM_SIZES.cornerLogoRight,
        height: DM_SIZES.cornerLogoHeight,
        width: "auto",
        opacity: Math.min(fadeIn, fadeOut) * 0.9,
        filter: "brightness(0) invert(1)",
        pointerEvents: "none",
      }}
    />
  );
};

const FilmGrain: React.FC = () => (
  <svg
    width={DM_WIDTH}
    height={DM_HEIGHT}
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      mixBlendMode: "overlay",
      opacity: 0.18,
    }}
  >
    <filter id="dm-grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0"
      />
    </filter>
    <rect width="100%" height="100%" filter="url(#dm-grain)" />
  </svg>
);

/* ---------- Race data prep ---------------------------------------- */

type RaceState = {
  minutes: number[];
  pctSeries: number[][]; // smoothed
  warp: (t: number) => number;
  yMin: number;
  yMax: number;
  openTimeUnix: number;
};

function useRaceState(picks: DailyMoversMover[]): RaceState {
  return useMemo(() => {
    if (picks.length === 0) {
      return { minutes: [0, 390], pctSeries: [], warp: (t) => t, yMin: -5, yMax: 5, openTimeUnix: 0 };
    }
    const minLen = Math.min(...picks.map((p) => p.intraday.length));
    const trimmed = picks.map((p) => p.intraday.slice(0, minLen));
    // PREPEND a synthetic ORIGIN point at (t=0, pct=0) representing the
    // previous close. Every line begins here — the first drawn segment is
    // the visible gap-jump to each ticker's 9:30 opening price. Minutes
    // array duplicates the first bar's minute (both label as "9:30" — the
    // origin represents "just before the bell").
    const minutes = [trimmed[0][0]?.minute ?? 0, ...trimmed[0].map((b) => b.minute)];
    const raw = trimmed.map((s) => [0, ...s.map((b) => b.pct)]);
    const smoothed = raw.map((s) => smoothPcts(s, 5));
    // PIN the origin (t=0) exactly to 0 — smoothing can't drag it off the
    // shared starting point.
    smoothed.forEach((s) => { s[0] = 0; });
    // PIN the final smoothed value to the exact headline changePercent so
    // the chart's final ordering matches the headline ranking exactly.
    smoothed.forEach((s, i) => { s[s.length - 1] = picks[i].changePercent; });
    const warp = buildTimeWarp(smoothed);
    const flat = smoothed.flat();
    const rawMin = Math.min(0, ...flat);
    const rawMax = Math.max(0, ...flat);
    // Symmetric padding — fraction of the data range. Keeps the extremes
    // off the band edges without floating in empty bands.
    const pad = Math.max(1, (rawMax - rawMin) * DM_Y_PADDING_FRAC);
    const first = picks[0];
    const lastMinute = first.intraday[first.intraday.length - 1]?.minute ?? 390;
    const openTimeUnix = first.sessionTime - lastMinute * 60;
    return { minutes, pctSeries: smoothed, warp, yMin: rawMin - pad, yMax: rawMax + pad, openTimeUnix };
  }, [picks]);
}

function fmtClock(openUnix: number, minuteOffset: number): string {
  const d = new Date((openUnix + minuteOffset * 60) * 1000);
  return d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(/\s?(AM|PM)$/, "");
}

/* ---------- Row-Y precompute (leaderboard reshuffles) ------------ */

function useRowYs(race: RaceState, totalRaceFrames: number, fps: number) {
  return useMemo(() => {
    const M = race.pctSeries.length;
    if (M === 0) return { yAtFrame: [] as number[][], finalRank: [] as number[] };
    const N = race.pctSeries[0].length;
    const rank: number[][] = Array.from({ length: M }, () => new Array(totalRaceFrames));
    for (let f = 0; f < totalRaceFrames; f++) {
      const t = totalRaceFrames <= 1 ? 0 : f / (totalRaceFrames - 1);
      const dp = race.warp(t);
      const idx = Math.min(N - 1, Math.max(0, Math.floor(dp * (N - 1))));
      const w = race.pctSeries.map((s, i) => ({ i, v: s[idx] })).sort((a, b) => b.v - a.v);
      w.forEach((x, r) => { rank[x.i][f] = r; });
    }
    const y: number[][] = Array.from({ length: M }, () => new Array(totalRaceFrames));
    const rowH = DM_SIZES.lbRowHeight;
    for (let m = 0; m < M; m++) {
      let fromRank = rank[m][0];
      let toRank = rank[m][0];
      let pivotFrame = 0;
      for (let f = 0; f < totalRaceFrames; f++) {
        if (f > 0 && rank[m][f] !== rank[m][f - 1]) {
          fromRank = toRank;
          toRank = rank[m][f];
          pivotFrame = f;
        }
        const s = spring({ frame: f - pivotFrame, fps, config: DM_SPRINGS.reshuffle });
        y[m][f] = (fromRank + (toRank - fromRank) * s) * rowH;
      }
    }
    // Final rank at last race frame.
    const finalRank = rank.map((series) => series[totalRaceFrames - 1]);
    return { yAtFrame: y, finalRank };
  }, [race, totalRaceFrames, fps]);
}

/* ---------- Race chart (lines + connectors + time) --------------- */

const RaceChart: React.FC<{
  race: RaceState;
  drawProgress: number;
  chartOpacity: number;
}> = ({ race, drawProgress, chartOpacity }) => {
  const N = race.pctSeries[0]?.length ?? 0;
  if (N === 0) return null;

  const chartX = DM_SIZES.chartLeftX;
  const chartRightX = DM_SIZES.chartRightX;
  const chartW = chartRightX - chartX;
  const chartH = DM_SIZES.chartHeight;
  const chartY = DM_SIZES.chartTop;

  // LAUNCH RUNWAY: index 0 (synthetic origin) sits at chartX. Index 1
  // (9:30 opening print) sits `runwayPx` in. Remaining indices span the
  // rest of the plot width. The gap-jump is now a steep diagonal across
  // the runway instead of a vertical line.
  const runwayPx = chartW * DM_LAUNCH_RUNWAY_FRAC;
  const remainingW = chartW - runwayPx;
  const xOf = (i: number) => {
    if (i <= 0) return chartX;
    if (i === 1) return chartX + runwayPx;
    return chartX + runwayPx + ((i - 1) / (N - 2)) * remainingW;
  };
  const yOf = (p: number) =>
    chartY + chartH - ((p - race.yMin) / (race.yMax - race.yMin)) * chartH;

  const dataIdxFloat = drawProgress * (N - 1);
  const dataIdxInt = Math.floor(dataIdxFloat);
  const frac = dataIdxFloat - dataIdxInt;

  // Build each line's path up to the current progress.
  const paths = race.pctSeries.map((series) => {
    if (dataIdxInt < 1) return "";
    const pts: string[] = [`M ${xOf(0).toFixed(2)} ${yOf(series[0]).toFixed(2)}`];
    for (let i = 1; i <= dataIdxInt; i++) {
      pts.push(`L ${xOf(i).toFixed(2)} ${yOf(series[i]).toFixed(2)}`);
    }
    if (frac > 0 && dataIdxInt + 1 < N) {
      const x = xOf(dataIdxInt) + (xOf(dataIdxInt + 1) - xOf(dataIdxInt)) * frac;
      const y = yOf(series[dataIdxInt]) +
        (yOf(series[dataIdxInt + 1]) - yOf(series[dataIdxInt])) * frac;
      pts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return pts.join(" ");
  });

  // Line endpoint per mover (current leading position).
  const endpoints = race.pctSeries.map((series) => {
    const xA = xOf(dataIdxInt);
    const xB = xOf(Math.min(N - 1, dataIdxInt + 1));
    const x = xA + (xB - xA) * frac;
    const yA = yOf(series[dataIdxInt]);
    const yB = yOf(series[Math.min(N - 1, dataIdxInt + 1)]);
    const y = yA + (yB - yA) * frac;
    return { x, y };
  });

  return (
    <svg
      width={DM_WIDTH}
      height={DM_HEIGHT}
      style={{ position: "absolute", inset: 0, opacity: chartOpacity }}
    >
      {/* Zero line */}
      <line
        x1={chartX}
        x2={chartRightX}
        y1={yOf(0)}
        y2={yOf(0)}
        stroke="rgba(255,255,255,0.35)"
        strokeDasharray="4 8"
        strokeWidth={DM_STROKE.zeroLine}
      />

      {/* Lines — flat core stroke, no glow. */}
      {race.pctSeries.map((_, i) => {
        const color = DM_PALETTE[i] ?? "#fff";
        return (
          <path
            key={`line-${i}`}
            d={paths[i]}
            fill="none"
            stroke={color}
            strokeWidth={DM_STROKE.line}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Leading dots — LAST so they sit on top of every line. */}
      {endpoints.map((e, i) => {
        const color = DM_PALETTE[i] ?? "#fff";
        return (
          <g key={`dot-${i}`}>
            <circle cx={e.x} cy={e.y} r={11} fill={color} />
          </g>
        );
      })}

      {/* Time indicator — sits at a fixed y below the plot band. */}
      <text
        x={chartX}
        y={DM_SIZES.timeIndicatorY}
        fill="rgba(255,255,255,0.65)"
        fontSize={DM_SIZES.timeIndicator}
        fontFamily={FONT_NUM}
        letterSpacing="4"
      >
        {fmtClock(race.openTimeUnix, race.minutes[dataIdxInt] ?? 0)}
      </text>
    </svg>
  );
};

/* ---------- Movers (leaderboard → horizontal strip) ------------ */

/**
 * One component to rule them all. Draws each mover row at a computed
 * position that lerps between VERTICAL (during race/hold) and HORIZONTAL
 * (during reflow/rest/cta), with staggered springs on the transition.
 * Passing `rowYAt` up to the chart so its connectors stay in sync.
 */
const Movers: React.FC<{
  picks: DailyMoversMover[];
  race: RaceState;
  totalRaceFrames: number;
  reflowStartFrame: number;
  reflowFrames: number;
  currentPct: (idx: number) => number;
  finalRank: number[];
  rowYAt: (moverIdx: number) => number; // vertical-mode Y offset (from useRowYs)
  stripOpacity: number;
}> = ({
  picks,
  reflowStartFrame,
  reflowFrames,
  currentPct,
  finalRank,
  rowYAt,
  stripOpacity,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Vertical anchor.
  const vRowH = DM_SIZES.lbRowHeight;
  const vLeftX = DM_WIDTH - DM_SIZES.lbRight - DM_SIZES.lbWidth;
  const vTopY = DM_SIZES.lbTop;
  const vRowW = DM_SIZES.lbWidth;

  // Horizontal anchor.
  const stripItemW = DM_SIZES.stripItemW;
  const stripGap = DM_SIZES.stripGap;
  const stripTotalW = 5 * stripItemW + 4 * stripGap;
  const stripLeftPad = (DM_WIDTH - stripTotalW) / 2;
  const stripTopY = DM_SIZES.stripTop;

  // Per-row reflow progress (staggered).
  const staggerFrames = 8;
  const reflowProgress = (rank: number) => {
    const localStart = reflowStartFrame + rank * staggerFrames;
    return spring({
      frame: frame - localStart,
      fps,
      config: DM_SPRINGS.reflow,
    });
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {picks.map((p, i) => {
        const color = DM_PALETTE[i] ?? "#fff";
        const rank = finalRank[i] ?? i;

        // Vertical row anchor (leaderboard style, follows reshuffle Y).
        const vY = vTopY + rowYAt(i);
        const vX = vLeftX;
        const vW = vRowW;

        // Horizontal target — position by FINAL RANK.
        const hX = stripLeftPad + rank * (stripItemW + stripGap);
        const hY = stripTopY;
        const hW = stripItemW;

        // Interpolate position + size.
        const rp = reflowProgress(rank);
        const x = vX + (hX - vX) * rp;
        const y = vY + (hY - vY) * rp;
        const width = vW + (hW - vW) * rp;

        const nameOpacity = interpolate(rp, [0.4, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const pctDisplay = currentPct(i);

        return (
          <div
            key={p.symbol}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width,
              // Height auto-fits content.
              display: "flex",
              alignItems: "flex-start",
              gap: 18,
              color: "#fff",
              fontFamily: FONT_DISPLAY,
              opacity: stripOpacity,
              // Row divider on the LEFT: colored pill (vertical bar).
              borderLeft: `${DM_SIZES.lbPillWidth}px solid ${color}`,
              paddingLeft: 18,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: DM_SIZES.lbTicker,
                  letterSpacing: "-0.01em",
                  lineHeight: 1,
                }}
              >
                {p.symbol}
              </div>
              <div
                style={{
                  fontFamily: FONT_NUM,
                  fontSize: DM_SIZES.lbPct,
                  fontVariantNumeric: "tabular-nums",
                  fontFeatureSettings: '"tnum" 1, "lnum" 1',
                  color,
                  letterSpacing: "-0.02em",
                  marginTop: 6,
                  lineHeight: 1,
                }}
              >
                {fmtPct(pctDisplay)}
              </div>
              {/* Company name — appears in horizontal mode only. */}
              <div
                style={{
                  fontFamily: FONT_NUM,
                  fontSize: DM_SIZES.stripName,
                  color: "rgba(255,255,255,0.55)",
                  letterSpacing: "0.05em",
                  marginTop: 8,
                  opacity: nameOpacity,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.name}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- CTA (chart + strip dimmed behind) ------------------- */

const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame, fps, config: DM_SPRINGS.silk });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 820,
        textAlign: "center",
        color: "#fff",
        opacity: inS,
        transform: `translateY(${interpolate(inS, [0, 1], [20, 0])}px)`,
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: DM_SIZES.ctaHeadline,
          letterSpacing: "-0.02em",
        }}
      >
        {DM_COPY.ctaHeadline}
      </div>
      <div
        style={{
          fontFamily: FONT_NUM,
          fontSize: DM_SIZES.ctaSub,
          letterSpacing: "0.15em",
          opacity: 0.6,
          marginTop: 14,
        }}
      >
        {DM_COPY.ctaSub}
      </div>
    </div>
  );
};

/* ---------- Root ----------------------------------------------- */

export const DailyMovers: React.FC<DailyMoversProps> = ({ dateLabel, picks }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const capped = picks.slice(0, DM_PICK_COUNT);
  const race = useRaceState(capped);

  const raceFrames   = sec(DM_DUR.race);
  const holdFrames   = sec(DM_DUR.hold);
  const reflowFrames = sec(DM_DUR.reflow);
  const restFrames   = sec(DM_DUR.rest);
  const ctaFrames    = sec(DM_DUR.cta);
  const holdStart    = raceFrames;
  const reflowStart  = raceFrames + holdFrames;
  const restStart    = reflowStart + reflowFrames;
  const ctaStart     = restStart + restFrames;
  const total        = ctaStart + ctaFrames;

  const rawT = Math.max(0, Math.min(1, frame / Math.max(1, raceFrames - 1)));
  const drawProgress = frame < raceFrames ? rawT : 1;

  // Row Y precompute — only for VERTICAL mode. During reflow the Movers
  // component blends this with the horizontal target.
  const { yAtFrame, finalRank } = useRowYs(race, raceFrames, fps);

  const rowYAt = (i: number) => {
    if (yAtFrame.length === 0) return i * DM_SIZES.lbRowHeight;
    const fi = Math.min(raceFrames - 1, Math.max(0, frame));
    return yAtFrame[i]?.[fi] ?? i * DM_SIZES.lbRowHeight;
  };

  // Currently displayed % per mover — live during race, headline after hold.
  const N = race.pctSeries[0]?.length ?? 0;
  const raceFi = Math.min(raceFrames - 1, Math.max(0, frame));
  const dp = race.warp(raceFrames <= 1 ? 0 : raceFi / (raceFrames - 1));
  const dataFloat = dp * (N - 1);
  const currentPct = (i: number) => {
    if (frame >= holdStart) return capped[i]?.changePercent ?? 0;
    return sampleAt(race.pctSeries[i] ?? [0], dataFloat);
  };

  // Chart / connector / grain opacities across sections.
  const chartOpacity =
    frame < ctaStart
      ? 1
      : interpolate(frame, [ctaStart, ctaStart + sec(0.6)], [1, DM_SIZES.ctaChartOpacity], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  // Strip dims with chart during CTA.
  const stripOpacity =
    frame < ctaStart
      ? 1
      : interpolate(frame, [ctaStart, ctaStart + sec(0.6)], [1, DM_SIZES.ctaChartOpacity + 0.2], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

  const finalFade = interpolate(frame, [total - sec(0.5), total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity: finalFade }}>
      <Header dateLabel={dateLabel} />

      <RaceChart
        race={race}
        drawProgress={drawProgress}
        chartOpacity={chartOpacity}
      />

      <Movers
        picks={capped}
        race={race}
        totalRaceFrames={raceFrames}
        reflowStartFrame={reflowStart}
        reflowFrames={reflowFrames}
        currentPct={currentPct}
        finalRank={finalRank}
        rowYAt={rowYAt}
        stripOpacity={stripOpacity}
      />

      <Sequence from={ctaStart} durationInFrames={ctaFrames}>
        <Cta />
      </Sequence>

      <CornerLogo />
      <FilmGrain />
    </AbsoluteFill>
  );
};

export { DM_FPS, DM_WIDTH, DM_HEIGHT, DM_TOTAL_FRAMES };
