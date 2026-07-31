import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";
import type { PortfolioResult } from "@/lib/time-machine/portfolio";
import {
  TM_FPS,
  TM_HEIGHT,
  TM_SECTIONS,
  TM_SIZES,
  TM_SPRINGS,
  TM_STROKE,
  TM_TOTAL_FRAMES,
  TM_WIDTH,
  sec,
  warpRide,
} from "./config";

/* ---------- Fonts (self-hosted; must load via FontFace not next/font
 *  because this component also renders inside Remotion Studio and
 *  renderMediaOnWeb, which don't run next/font). ---------- */
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
loadFontOnce("Tenor Sans", "brand/TenorSans-Regular.woff2");
loadFontOnce("Vernavle", "brand/vernavle-font.woff2");

const FONT_DISPLAY = "Vernavle, 'Tenor Sans', serif";
// Numeric counter keeps Helvetica for its rock-solid tabular figures — Vernavle
// as a display face doesn't ship a `tnum` OpenType feature we can rely on.
const FONT_NUM = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const VERNAVLE_LOGO = staticFile("brand/vernavle-logo.png");

/* ------------------------------ Props ------------------------------------ */

export type TimeMachineProps = {
  portfolio: PortfolioResult;
  tickerName: string;
  logoUrl: string | null; // null → render text wordmark
  /** Ignored today; forRender parity with other comps. */
  forRender?: boolean;
  /** Optional narration. If hookAudioUrl is set, the hook section stretches
   *  to max(2.5s, hookDurationSec + 0.4s) and everything after SHIFTS by the
   *  extra time (not compressed). ctaAudioUrl is the static Comment-the-next-
   *  ticker file — defaults to the pre-baked one in /public. */
  hookAudioUrl?: string | null;
  hookDurationSec?: number; // measured client-side before render
  ctaAudioUrl?: string | null;
  narrationEnabled?: boolean;
};

/** Baked-in default CTA audio (generated once during the build). */
export const TM_CTA_AUDIO_DEFAULT = "/time-machine/audio/cta.mp3";

/**
 * Compute effective section starts/ends and total duration given a hook
 * audio duration. Sections after the hook SHIFT (never compress).
 * Returns everything in seconds AND frames so the studio + composition
 * agree on timing.
 */
export function computeTimeMachineTiming(hookAudioSec: number | undefined) {
  const baseHookDur = TM_SECTIONS.hook.end - TM_SECTIONS.hook.start; // 2.5
  const hasHookAudio = typeof hookAudioSec === "number" && hookAudioSec > 0;
  const effHookDur = hasHookAudio
    ? Math.max(baseHookDur, hookAudioSec + 0.4)
    : baseHookDur;
  const shift = effHookDur - baseHookDur;
  const totalSec =
    TM_SECTIONS.cta.end + shift; // TM_TOTAL_SEC baseline + hook shift
  return {
    hook:   { start: TM_SECTIONS.hook.start,        end: TM_SECTIONS.hook.start + effHookDur },
    ride:   { start: TM_SECTIONS.ride.start + shift,  end: TM_SECTIONS.ride.end + shift },
    payoff: { start: TM_SECTIONS.payoff.start + shift,end: TM_SECTIONS.payoff.end + shift },
    cta:    { start: TM_SECTIONS.cta.start + shift,   end: TM_SECTIONS.cta.end + shift },
    totalSec,
    totalFrames: Math.round(totalSec * TM_FPS),
    shift,
  };
}

export const timeMachineDefaultProps: TimeMachineProps = {
  portfolio: {
    symbol: "NVDA",
    year: 2016,
    amount: 1000,
    shares: 30.30,
    series: [
      { date: "2016-01-29", close: 33.0,  value: 1000 },
      { date: "2017-12-29", close: 193.5, value: 5864 },
      { date: "2018-12-31", close: 133.5, value: 4045 },
      { date: "2020-12-31", close: 522.0, value: 15818 },
      { date: "2022-12-30", close: 146.0, value: 4423 },
      { date: "2024-12-31", close: 134.3, value: 4068 },
      { date: "2026-06-30", close: 900.0, value: 27273 },
    ],
    finalValue: 27273,
    multiple: 27.27,
    milestones: [
      { kind: "first-2x",     label: "First 2x",       point: { date: "2017-05-31", close: 66,  value: 2000 } },
      { kind: "first-10x",    label: "First 10x",      point: { date: "2021-08-31", close: 330, value: 10000 } },
      { kind: "biggest-year", label: "Best year +239%",point: { date: "2023-12-31", close: 495, value: 14999 } },
      { kind: "max-drawdown", label: "-58% drawdown",  point: { date: "2018-12-31", close: 133, value: 4045 } },
    ],
    latestDate: "2026-06-30",
  },
  tickerName: "NVIDIA",
  logoUrl: "/time-machine/logos/NVDA.svg",
};

/* ---------- Helpers ------------------------------------------------------- */

const fmtCurrency = (n: number) => {
  const rounded = Math.round(n);
  return "$" + rounded.toLocaleString("en-US");
};

/** Word-by-word blur-and-lift entrance with per-word stagger. */
const WordStagger: React.FC<{
  text: string;
  startFrame: number;
  size: number;
  weight?: number;
  staggerFrames?: number;
  letterSpacing?: string;
  style?: React.CSSProperties;
}> = ({
  text,
  startFrame,
  size,
  weight = 500,
  staggerFrames = 4,
  letterSpacing = "-0.02em",
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div
      style={{
        display: "flex",
        gap: "0.35em",
        justifyContent: "center",
        flexWrap: "wrap",
        fontFamily: FONT_DISPLAY,
        fontWeight: weight,
        fontSize: size,
        letterSpacing,
        color: "#fff",
        ...style,
      }}
    >
      {words.map((w, i) => {
        const s = spring({
          frame: frame - startFrame - i * staggerFrames,
          fps,
          config: TM_SPRINGS.snap,
        });
        const y = interpolate(s, [0, 1], [30, 0]);
        const blur = interpolate(s, [0, 1], [12, 0]);
        const op = interpolate(s, [0, 1], [0, 1]);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${y}px)`,
              filter: `blur(${blur}px)`,
              opacity: op,
              willChange: "transform, filter, opacity",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Static film grain — SVG turbulence at low opacity to kill flat black. */
const FilmGrain: React.FC = () => (
  <svg
    width={TM_WIDTH}
    height={TM_HEIGHT}
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      mixBlendMode: "overlay",
      opacity: 0.18,
    }}
  >
    <filter id="tm-grain">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.9"
        numOctaves="2"
        stitchTiles="stitch"
      />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0"
      />
    </filter>
    <rect width="100%" height="100%" filter="url(#tm-grain)" />
  </svg>
);

/* ---------- HOOK section (0 – 2.5s) --------------------------------------- */

const Hook: React.FC<{
  tickerName: string;
  logoUrl: string | null;
  amount: number;
  year: number;
}> = ({ tickerName, amount, year }) => {
  // Beats: 0.1s → "What if you invested"
  //        0.9s → "$1,000 in {company name}"
  //        1.7s → "in {year}?"
  const beat1 = sec(0.1);
  const beat2 = sec(0.9);
  const beat3 = sec(1.7);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 40,
        padding: 120,
      }}
    >
      <WordStagger
        text="What if you invested"
        startFrame={beat1}
        size={TM_SIZES.hookHeadline}
        style={{ opacity: 0.85 }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          marginTop: 20,
        }}
      >
        <WordStagger
          text={fmtCurrency(amount)}
          startFrame={beat2}
          size={TM_SIZES.hookAmount}
          letterSpacing="-0.03em"
        />
        <WordStagger
          text="in"
          startFrame={beat2 + 4}
          size={TM_SIZES.hookHeadline}
          style={{ opacity: 0.6 }}
        />
        <WordStagger
          text={tickerName}
          startFrame={beat2 + 6}
          size={TM_SIZES.hookHeadline}
        />
      </div>
      <WordStagger
        text={`in ${year}?`}
        startFrame={beat3}
        size={TM_SIZES.hookYear}
        letterSpacing="-0.02em"
        style={{ marginTop: 24 }}
      />
    </AbsoluteFill>
  );
};

/* ---------- RIDE section (2.5 – 22s) -------------------------------------- */

const Ride: React.FC<{ portfolio: PortfolioResult }> = ({ portfolio }) => {
  const frame = useCurrentFrame(); // local frame within the Ride Sequence
  const { fps } = useVideoConfig();
  const rideDur = sec(TM_SECTIONS.ride.end - TM_SECTIONS.ride.start);
  const t = Math.max(0, Math.min(1, frame / rideDur));
  const warped = warpRide(t); // 0..1 mapped into data index

  const N = portfolio.series.length;
  const idxFloat = warped * (N - 1);
  const idxA = Math.floor(idxFloat);
  const idxB = Math.min(N - 1, idxA + 1);
  const frac = idxFloat - idxA;
  const currentValue =
    portfolio.series[idxA].value * (1 - frac) +
    portfolio.series[idxB].value * frac;
  const currentYear = Number(portfolio.series[idxA].date.slice(0, 4));

  // Chart geometry.
  const chartW = TM_WIDTH - TM_SIZES.chartPadX * 2;
  const chartH = TM_SIZES.chartHeight;
  const chartX = TM_SIZES.chartPadX;
  const chartY = TM_SIZES.chartTop;
  const values = portfolio.series.map((p) => p.value);
  const vMin = 0;
  const vMax = Math.max(...values) * 1.05;
  const xOf = (i: number) => chartX + (i / (N - 1)) * chartW;
  const yOf = (v: number) =>
    chartY + chartH - ((v - vMin) / (vMax - vMin)) * chartH;

  // Full path (fixed).
  const fullPath = useMemo(() => {
    return portfolio.series
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(2)} ${yOf(p.value).toFixed(2)}`)
      .join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio]);

  // Leading dot at current data-index position.
  const dotIdx = warped * (N - 1);
  const dotA = Math.floor(dotIdx);
  const dotB = Math.min(N - 1, dotA + 1);
  const dotFrac = dotIdx - dotA;
  const dotX =
    xOf(dotA) + (xOf(dotB) - xOf(dotA)) * dotFrac;
  const dotY =
    yOf(portfolio.series[dotA].value) +
    (yOf(portfolio.series[dotB].value) - yOf(portfolio.series[dotA].value)) *
      dotFrac;

  // Year markers on x-axis.
  const yearMarks = useMemo(() => {
    const marks: Array<{ x: number; label: string }> = [];
    const seen = new Set<number>();
    portfolio.series.forEach((p, i) => {
      const yr = Number(p.date.slice(0, 4));
      if (!seen.has(yr) && (yr % 2 === 0 || i === N - 1)) {
        seen.add(yr);
        marks.push({ x: xOf(i), label: String(yr) });
      }
    });
    return marks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio]);

  // Ride-in for the whole chart module: subtle rise + blur-in.
  const rideIn = spring({ frame, fps, config: TM_SPRINGS.silk });

  // Counter scale-in.
  const counterIn = spring({
    frame: frame - 6,
    fps,
    config: TM_SPRINGS.bounce,
  });

  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(rideIn, [0, 1], [0, 1]),
        transform: `translateY(${interpolate(rideIn, [0, 1], [30, 0])}px)`,
        filter: `blur(${interpolate(rideIn, [0, 1], [10, 0])}px)`,
      }}
    >
      {/* Big counter — the biggest thing on screen. */}
      <div
        style={{
          position: "absolute",
          top: TM_SIZES.counterTop,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#fff",
          fontFamily: FONT_NUM,
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "lnum" 1',
          fontWeight: 500,
          fontSize: TM_SIZES.counterHuge,
          letterSpacing: "-0.04em",
          transform: `scale(${interpolate(counterIn, [0, 1], [0.7, 1])})`,
        }}
      >
        {fmtCurrency(currentValue)}
      </div>

      {/* Year sub-label under the counter. */}
      <div
        style={{
          position: "absolute",
          top: TM_SIZES.counterTop + TM_SIZES.counterHuge + 48,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "rgba(255,255,255,0.55)",
          fontFamily: FONT_NUM,
          fontVariantNumeric: "tabular-nums",
          fontSize: 44,
          letterSpacing: "0.15em",
        }}
      >
        {currentYear}
      </div>

      {/* SVG chart. */}
      <svg
        width={TM_WIDTH}
        height={TM_HEIGHT}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          {/* Glow via blur duplicate. */}
          <filter id="tm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={TM_SIZES.glowBlur} />
          </filter>
        </defs>

        {/* Faint grid — 4 horizontal lines. */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <line
            key={pct}
            x1={chartX}
            x2={chartX + chartW}
            y1={chartY + chartH * (1 - pct)}
            y2={chartY + chartH * (1 - pct)}
            stroke="rgba(255,255,255,1)"
            strokeOpacity={TM_SIZES.gridOpacity}
            strokeWidth={TM_STROKE.gridMajor}
          />
        ))}

        {/* Year markers — tiny ticks + label. */}
        {yearMarks.map((m) => (
          <g key={m.label}>
            <line
              x1={m.x}
              x2={m.x}
              y1={chartY + chartH}
              y2={chartY + chartH + 12}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
            />
            <text
              x={m.x}
              y={chartY + chartH + 40}
              fill="rgba(255,255,255,0.5)"
              fontSize={22}
              textAnchor="middle"
              fontFamily={FONT_NUM}
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* Chart line: draw with stroke-dasharray trick, eased by warp. */}
        <g>
          <PathDraw
            d={fullPath}
            progress={warped}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={TM_STROKE.line * 3}
            filter="url(#tm-glow)"
          />
          <PathDraw
            d={fullPath}
            progress={warped}
            stroke="#ffffff"
            strokeWidth={TM_STROKE.line}
          />
        </g>

        {/* Leading dot. */}
        <circle
          cx={dotX}
          cy={dotY}
          r={12}
          fill="#fff"
          opacity={0.95}
        />
        <circle
          cx={dotX}
          cy={dotY}
          r={26}
          fill="#fff"
          opacity={0.15}
          filter="url(#tm-glow)"
        />
      </svg>

      {/* Milestones — anchored at data indices, fade in when the line reaches them. */}
      {portfolio.milestones.map((m) => {
        const mIdx = portfolio.series.findIndex((p) => p.date === m.point.date);
        if (mIdx < 0) return null;
        const mFrac = mIdx / (N - 1);
        const revealAt = mFrac; // when warped ≥ mFrac
        const distance = warped - revealAt;
        const s = spring({
          frame: Math.max(0, Math.round(distance * fps * 4)),
          fps,
          config: TM_SPRINGS.snap,
        });
        const op = distance < 0 ? 0 : s;
        const x = xOf(mIdx);
        const y = yOf(m.point.value);
        return (
          <div
            key={m.kind}
            style={{
              position: "absolute",
              left: x,
              top: y - 60,
              transform: `translate(-50%, -100%) translateY(${interpolate(op, [0, 1], [10, 0])}px)`,
              opacity: op,
              color: "rgba(255,255,255,0.85)",
              fontFamily: FONT_NUM,
              fontSize: TM_SIZES.milestoneLabel,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              filter: `blur(${interpolate(op, [0, 1], [6, 0])}px)`,
            }}
          >
            <div style={{ height: 20, width: 1, background: "rgba(255,255,255,0.4)", margin: "0 auto 6px" }} />
            {m.label}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** Draws a path progressively along its length. Uses stroke-dasharray. */
const PathDraw: React.FC<{
  d: string;
  progress: number;
  stroke: string;
  strokeWidth: number;
  filter?: string;
}> = ({ d, progress, stroke, strokeWidth, filter }) => {
  const ref = React.useRef<SVGPathElement | null>(null);
  const [len, setLen] = React.useState(0);
  React.useEffect(() => {
    if (ref.current) setLen(ref.current.getTotalLength());
  }, [d]);
  const dashOffset = len * (1 - progress);
  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={len}
      strokeDashoffset={dashOffset}
      filter={filter}
    />
  );
};

/* ---------- PAYOFF section (22 – 27s) ------------------------------------ */

const Payoff: React.FC<{
  portfolio: PortfolioResult;
  tickerName: string;
}> = ({ portfolio, tickerName }) => {
  const frame = useCurrentFrame(); // local
  const { fps } = useVideoConfig();
  const numIn = spring({ frame, fps, config: TM_SPRINGS.silk });
  const scale = interpolate(numIn, [0, 1], [0.6, 1]);
  const spread = interpolate(numIn, [0, 1], [-0.02, -0.05]);
  const opacity = interpolate(numIn, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });

  const years = new Date().getFullYear() - portfolio.year;
  const mult = portfolio.multiple.toFixed(portfolio.multiple >= 10 ? 0 : 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 40,
      }}
    >
      <div
        style={{
          color: "#fff",
          fontFamily: FONT_NUM,
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "lnum" 1',
          fontWeight: 500,
          fontSize: TM_SIZES.counterPayoff,
          letterSpacing: `${spread}em`,
          transform: `scale(${scale})`,
          opacity,
        }}
      >
        {fmtCurrency(portfolio.finalValue)}
      </div>

      <WordStagger
        text={`${mult}x your money`}
        startFrame={sec(0.7)}
        size={72}
        letterSpacing="-0.02em"
        style={{ opacity: 0.85 }}
      />
      <WordStagger
        text={`${fmtCurrency(portfolio.amount)} → ${tickerName} → ${years} years`}
        startFrame={sec(1.2)}
        size={40}
        letterSpacing="0.05em"
        style={{ opacity: 0.55 }}
      />
    </AbsoluteFill>
  );
};

/* ---------- CTA section (27 – 30s) --------------------------------------- */

const Cta: React.FC = () => {
  const frame = useCurrentFrame(); // local
  const { fps } = useVideoConfig();
  const ctaDur = sec(TM_SECTIONS.cta.end - TM_SECTIONS.cta.start);
  const fadeOut = interpolate(
    frame,
    [ctaDur - sec(0.6), ctaDur],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const logoIn = spring({
    frame: frame - sec(0.6),
    fps,
    config: TM_SPRINGS.silk,
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        gap: 60,
        opacity: fadeOut,
      }}
    >
      <WordStagger
        text="Follow for more market visuals."
        startFrame={0}
        size={TM_SIZES.ctaBody}
        letterSpacing="-0.02em"
      />
      <div
        style={{
          opacity: interpolate(logoIn, [0, 1], [0, 0.55]),
          transform: `translateY(${interpolate(logoIn, [0, 1], [10, 0])}px)`,
          color: "rgba(255,255,255,0.7)",
          fontFamily: FONT_DISPLAY,
          fontSize: TM_SIZES.ctaFoot * 0.7,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
        }}
      >
        by Vernavle
      </div>
    </AbsoluteFill>
  );
};

/* ---------- Root composition --------------------------------------------- */

export const TimeMachine: React.FC<TimeMachineProps> = ({
  portfolio,
  tickerName,
  logoUrl,
  hookAudioUrl,
  hookDurationSec,
  ctaAudioUrl,
  narrationEnabled,
}) => {
  const narrationOn = narrationEnabled !== false; // default ON
  const hookAudio = narrationOn ? hookAudioUrl : null;
  const ctaAudio = narrationOn
    ? (ctaAudioUrl ?? TM_CTA_AUDIO_DEFAULT)
    : null;

  const secs = computeTimeMachineTiming(hookAudio ? hookDurationSec : 0);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Sequence from={sec(secs.hook.start)} durationInFrames={sec(secs.hook.end - secs.hook.start)}>
        <Hook
          tickerName={tickerName}
          logoUrl={logoUrl}
          amount={portfolio.amount}
          year={portfolio.year}
        />
      </Sequence>
      <Sequence from={sec(secs.ride.start)} durationInFrames={sec(secs.ride.end - secs.ride.start)}>
        <Ride portfolio={portfolio} />
      </Sequence>
      <Sequence from={sec(secs.payoff.start)} durationInFrames={sec(secs.payoff.end - secs.payoff.start)}>
        <Payoff portfolio={portfolio} tickerName={tickerName} />
      </Sequence>
      <Sequence from={sec(secs.cta.start)} durationInFrames={sec(secs.cta.end - secs.cta.start)}>
        <Cta />
      </Sequence>

      {/* Narration audio — Remotion's <Audio> is muxed by @remotion/web-renderer
          on export. Hook plays from frame 0; CTA at its (shifted) start. */}
      {hookAudio ? (
        <Sequence from={0} durationInFrames={sec(secs.hook.end)}>
          <Audio src={hookAudio} volume={1} />
        </Sequence>
      ) : null}
      {ctaAudio ? (
        <Sequence from={sec(secs.cta.start)} durationInFrames={sec(secs.cta.end - secs.cta.start)}>
          <Audio src={ctaAudio} volume={1} />
        </Sequence>
      ) : null}

      <CornerLogo totalFrames={secs.totalFrames} />
      <FilmGrain />
    </AbsoluteFill>
  );
};

/** Persistent Vernavle wordmark, top-right. Sits below the top crop safe
 *  area so IG / TikTok chrome doesn't clip it. Fades in on the first beat
 *  and out with the final black-out. */
const CornerLogo: React.FC<{ totalFrames?: number }> = ({
  totalFrames = TM_TOTAL_FRAMES,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [sec(0.3), sec(1.0)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [totalFrames - sec(0.5), totalFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <Img
      src={VERNAVLE_LOGO}
      style={{
        position: "absolute",
        top: TM_SIZES.cornerLogoTop,
        right: TM_SIZES.cornerLogoRight,
        height: TM_SIZES.cornerLogoHeight,
        width: "auto",
        opacity: Math.min(fadeIn, fadeOut) * 0.9,
        // Force white in case the source PNG isn't already.
        filter: "brightness(0) invert(1)",
        pointerEvents: "none",
      }}
    />
  );
};

// Re-export config so consumers can size the composition consistently.
export { TM_FPS, TM_WIDTH, TM_HEIGHT, TM_TOTAL_FRAMES };
