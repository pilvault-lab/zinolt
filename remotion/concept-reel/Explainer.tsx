import React from "react";
import { interpolate } from "remotion";
import type {
  Beat,
  ChartConfig,
  ConceptScript,
  Candle,
  ChartPoint,
} from "@/lib/explainer/types";
import type { ConceptReelWord } from "./ConceptReelComposition";

/**
 * Renders a ConceptScript inside the composition. Positioned by the parent —
 * this component fills its container with an SVG chart.
 *
 * All coordinates are computed in a fixed 1080-wide viewport for consistency
 * with the composition size.
 */

const COMP_W = 1080;
const COMP_H = 1920;
// Chart occupies the middle of the reel. Left/right margins reserve room for
// the price axis and side-anchored annotations, so nothing spills off-screen.
const CHART_TOP = 480;
const CHART_HEIGHT = 900;
const CHART_LEFT = 130;
const CHART_RIGHT = 940;
const CHART_WIDTH = CHART_RIGHT - CHART_LEFT;

// Composition-wide safe zone — anything drawn outside this rect risks
// clipping. Annotations self-clamp to these bounds.
const SAFE_X_MIN = 40;
const SAFE_X_MAX = COMP_W - 40;
const SAFE_Y_MIN = 300;                // below title band
const SAFE_Y_MAX = COMP_H - 100;

const AXIS_COLOR = "rgba(255,255,255,0.28)";
const GRID_COLOR = "rgba(255,255,255,0.08)";
const TEXT_COLOR = "#FFFFFF";
const DIM_TEXT_COLOR = "rgba(255,255,255,0.6)";
const BULL_COLOR = "#22C55E";
const BEAR_COLOR = "#EF4444";
const ZONE_COLOR = "rgba(255,255,255,0.13)";
const ZONE_STROKE = "rgba(255,255,255,0.65)";
const MARKER_COLOR = "#FFFFFF";

type XY = { x: number; y: number };

class Projector {
  constructor(private cfg: ChartConfig) {}
  x(t: number): number {
    return CHART_LEFT + (t / this.cfg.timeSteps) * CHART_WIDTH;
  }
  y(price: number): number {
    const { priceMin, priceMax } = this.cfg;
    const frac = (price - priceMin) / (priceMax - priceMin);
    return CHART_TOP + (1 - frac) * CHART_HEIGHT;
  }
  xy(p: ChartPoint): XY {
    return { x: this.x(p.t), y: this.y(p.y) };
  }
  /** Approximate width of one candle body in pixels. */
  candleWidth(): number {
    return (CHART_WIDTH / this.cfg.timeSteps) * 0.55;
  }
}

/* ─── Resolved primitive state ──────────────────────────────────────────── */

type Primitive = {
  id: string;
  render: (opts: { progress: number; pulse: number }) => React.ReactNode;
  /** Screen center — annotations anchor here. */
  center?: XY;
  /** Screen bounding box (for pulse ring). */
  bbox?: { x: number; y: number; w: number; h: number };
};

/* ─── Beat → screen conversion ──────────────────────────────────────────── */

function wordTime(words: ConceptReelWord[], atWord: number): number {
  if (words.length === 0) return 0;
  const clamped = Math.max(0, Math.min(atWord, words.length - 1));
  return words[clamped].start;
}

export const Explainer: React.FC<{
  script: ConceptScript;
  words: ConceptReelWord[];
  tSec: number;
}> = ({ script, words, tSec }) => {
  const proj = React.useMemo(
    () => (script.chart ? new Projector(script.chart) : null),
    [script.chart],
  );

  // Resolve each add-beat to a Primitive with an animation progress.
  // Pulses are applied on top after resolution.
  const primitives: Primitive[] = [];
  const primById = new Map<string, Primitive>();

  const beats = script.beats;
  const beatTimes = beats.map((b) => wordTime(words, b.atWord));

  const annotationBeats: Array<{
    beat: Extract<Beat, { op: "annotation" }>;
    progress: number;
  }> = [];

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const start = beatTimes[i];
    const dur = beat.animDurationSec ?? 0.5;
    if (tSec < start) continue;
    if (beat.op === "pulse") continue; // applied below

    const rawProgress = (tSec - start) / dur;
    const progress = Math.min(1, Math.max(0, rawProgress));
    if (beat.op === "annotation") {
      annotationBeats.push({ beat, progress });
      continue;
    }
    const prim = renderPrimitive(beat, proj, progress);
    if (!prim) continue;
    primitives.push(prim);
    if (prim.id) primById.set(prim.id, prim);
  }

  // Resolve annotations against already-added primitives.
  const annotationPrims: Primitive[] = [];
  for (const { beat, progress } of annotationBeats) {
    const target = primById.get(beat.target);
    if (!target) continue;
    annotationPrims.push(renderAnnotation(beat, target, progress));
  }

  // Compute active pulses per primitive.
  const pulseByTarget = new Map<string, number>();
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat.op !== "pulse") continue;
    const start = beatTimes[i];
    if (tSec < start) continue;
    const dur = beat.durationSec ?? 0.6;
    const p = (tSec - start) / dur;
    if (p < 0 || p > 1) continue;
    // Sine bump 0 → 1 → 0
    const bump = Math.sin(p * Math.PI);
    const prev = pulseByTarget.get(beat.target) ?? 0;
    pulseByTarget.set(beat.target, Math.max(prev, bump));
  }

  return (
    <svg
      width={COMP_W}
      height={COMP_H}
      viewBox={`0 0 ${COMP_W} ${COMP_H}`}
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      {script.chart && proj ? <ChartFrame cfg={script.chart} proj={proj} /> : null}

      {primitives.map((p, idx) => {
        const pulse = pulseByTarget.get(p.id) ?? 0;
        return (
          <g key={`${p.id || "anon"}-${idx}`}>
            {p.render({ progress: 1, pulse })}
            {pulse > 0 && p.bbox ? <PulseRing bbox={p.bbox} amt={pulse} /> : null}
          </g>
        );
      })}
      {annotationPrims.map((p, idx) => (
        <g key={`ann-${idx}`}>{p.render({ progress: 1, pulse: 0 })}</g>
      ))}
    </svg>
  );
};

/* ─── Annotation (leader line + label) ──────────────────────────────────── */

function renderAnnotation(
  beat: Extract<Beat, { op: "annotation" }>,
  target: Primitive,
  progress: number,
): Primitive {
  const bbox = target.bbox;
  const center = target.center ?? { x: COMP_W / 2, y: 1000 };
  const side = beat.side ?? "above";
  const offset = 90;
  let labelPos: XY = { x: center.x, y: center.y };
  let anchorPos: XY = center;
  let textAnchor: "start" | "middle" | "end" = "middle";

  if (bbox) {
    // Anchor to nearest edge of the bbox rather than the center.
    if (side === "above") anchorPos = { x: center.x, y: bbox.y };
    else if (side === "below") anchorPos = { x: center.x, y: bbox.y + bbox.h };
    else if (side === "left") anchorPos = { x: bbox.x, y: center.y };
    else if (side === "right") anchorPos = { x: bbox.x + bbox.w, y: center.y };
  }

  if (side === "above") { labelPos = { x: anchorPos.x, y: anchorPos.y - offset }; textAnchor = "middle"; }
  else if (side === "below") { labelPos = { x: anchorPos.x, y: anchorPos.y + offset }; textAnchor = "middle"; }
  else if (side === "left") { labelPos = { x: anchorPos.x - offset, y: anchorPos.y }; textAnchor = "end"; }
  else if (side === "right") { labelPos = { x: anchorPos.x + offset, y: anchorPos.y }; textAnchor = "start"; }

  // Keep the label inside the composition safe zone — nudge horizontally so
  // long labels on "left" / "right" sides don't run off the edge.
  const fontSize = 36;
  const approxTextWidth = beat.text.length * fontSize * 0.58;
  if (textAnchor === "start") {
    const maxX = SAFE_X_MAX - approxTextWidth;
    if (labelPos.x > maxX) labelPos.x = maxX;
  } else if (textAnchor === "end") {
    const minX = SAFE_X_MIN + approxTextWidth;
    if (labelPos.x < minX) labelPos.x = minX;
  } else {
    // middle
    const halfW = approxTextWidth / 2;
    labelPos.x = Math.max(SAFE_X_MIN + halfW, Math.min(SAFE_X_MAX - halfW, labelPos.x));
  }
  labelPos.y = Math.max(SAFE_Y_MIN + fontSize, Math.min(SAFE_Y_MAX - fontSize, labelPos.y));

  // Leader line grows from anchor to labelPos as progress goes 0→0.6, then text fades in.
  const leaderProgress = Math.min(1, progress / 0.6);
  const lx = anchorPos.x + (labelPos.x - anchorPos.x) * leaderProgress;
  const ly = anchorPos.y + (labelPos.y - anchorPos.y) * leaderProgress;
  const textOpacity = Math.max(0, (progress - 0.6) / 0.4);

  // Small offset so text sits beside the leader tip
  const textOffsetX = side === "left" ? -14 : side === "right" ? 14 : 0;
  const textOffsetY = side === "above" ? -10 : side === "below" ? 32 : 10;

  return {
    id: "",
    render: () => (
      <g>
        <line
          x1={anchorPos.x}
          y1={anchorPos.y}
          x2={lx}
          y2={ly}
          stroke={TEXT_COLOR}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {textOpacity > 0 ? (
          <text
            x={labelPos.x + textOffsetX}
            y={labelPos.y + textOffsetY}
            textAnchor={textAnchor}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={fontSize}
            fontWeight={600}
            opacity={textOpacity}
          >
            {beat.text}
          </text>
        ) : null}
      </g>
    ),
  };
}

/* ─── Chart frame (axes + grid) ─────────────────────────────────────────── */

const ChartFrame: React.FC<{ cfg: ChartConfig; proj: Projector }> = ({
  cfg,
  proj,
}) => {
  const showGrid = cfg.showGrid !== false;
  const showAxis = cfg.showPriceAxis !== false;
  const priceRange = cfg.priceMax - cfg.priceMin;
  const step = niceStep(priceRange, 5);
  const lines: number[] = [];
  const first = Math.ceil(cfg.priceMin / step) * step;
  for (let p = first; p <= cfg.priceMax; p += step) lines.push(p);

  return (
    <g>
      {/* Frame */}
      <rect
        x={CHART_LEFT}
        y={CHART_TOP}
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        fill="none"
        stroke={AXIS_COLOR}
        strokeWidth={2}
      />
      {showGrid &&
        lines.map((p) => (
          <line
            key={p}
            x1={CHART_LEFT}
            x2={CHART_RIGHT}
            y1={proj.y(p)}
            y2={proj.y(p)}
            stroke={GRID_COLOR}
            strokeWidth={1}
          />
        ))}
      {showAxis &&
        lines.map((p) => (
          <text
            key={`t-${p}`}
            x={CHART_RIGHT + 14}
            y={proj.y(p) + 8}
            fill={DIM_TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={22}
            fontWeight={500}
          >
            {formatPrice(p)}
          </text>
        ))}
    </g>
  );
};

/* ─── Individual primitive renderers ────────────────────────────────────── */

function renderPrimitive(
  beat: Beat,
  proj: Projector | null,
  progress: number,
): Primitive | null {
  switch (beat.op) {
    case "candles":
      if (!proj) return null;
      return renderCandles(beat.candles, beat.tStart ?? 0, proj, progress, beat.id);
    case "hline":
      if (!proj) return null;
      return renderHLine(beat.y, beat.label, proj, progress, beat.id);
    case "vline":
      if (!proj) return null;
      return renderVLine(beat.t, beat.label, proj, progress, beat.id);
    case "line":
      if (!proj) return null;
      return renderLine(beat, proj, progress);
    case "zone":
      if (!proj) return null;
      return renderZone(beat, proj, progress);
    case "marker":
      if (!proj) return null;
      return renderMarker(beat, proj, progress);
    case "arrow":
      if (!proj) return null;
      return renderArrow(beat, proj, progress);
    case "annotation":
      // Handled specially — we look up the target's center from earlier primitives.
      // The caller renders it via a lookup, so we return a no-op wrapper here.
      return null;
    case "label":
      return renderLabel(beat, progress);
    case "bracket":
      if (!proj) return null;
      return renderBracket(beat, proj, progress);
    default:
      return null;
  }
}

function renderCandles(
  candles: Candle[],
  tStart: number,
  proj: Projector,
  progress: number,
  id?: string,
): Primitive {
  const bodyW = proj.candleWidth();
  const revealCount = Math.min(candles.length, Math.ceil(progress * candles.length + 0.001));
  const perStep = 1 / candles.length;
  const nodes: React.ReactNode[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < candles.length; i++) {
    if (i >= revealCount) break;
    const c = candles[i];
    const bull = c.close >= c.open;
    const cx = proj.x(tStart + i);
    const wickTop = proj.y(c.high);
    const wickBot = proj.y(c.low);
    const bodyTop = proj.y(Math.max(c.open, c.close));
    const bodyBot = proj.y(Math.min(c.open, c.close));
    // per-candle progress for a subtle grow-in
    const local = Math.min(1, Math.max(0, (progress - i * perStep) / perStep));
    const color = bull ? BULL_COLOR : BEAR_COLOR;
    const opacity = local;
    nodes.push(
      <g key={i} opacity={opacity}>
        <line
          x1={cx}
          x2={cx}
          y1={wickTop}
          y2={wickBot}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="butt"
        />
        <rect
          x={cx - bodyW / 2}
          y={bodyTop}
          width={bodyW}
          height={Math.max(3, bodyBot - bodyTop)}
          fill={color}
          stroke={color}
          strokeWidth={1}
        />
      </g>,
    );
    minX = Math.min(minX, cx - bodyW / 2);
    maxX = Math.max(maxX, cx + bodyW / 2);
    minY = Math.min(minY, wickTop);
    maxY = Math.max(maxY, wickBot);
  }

  return {
    id: id ?? "",
    render: () => <>{nodes}</>,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

function renderHLine(
  yPrice: number,
  label: string | undefined,
  proj: Projector,
  progress: number,
  id?: string,
): Primitive {
  const y = proj.y(yPrice);
  const dashLen = 8;
  const gapLen = 6;
  const totalLen = CHART_WIDTH;
  const drawn = totalLen * progress;
  return {
    id: id ?? "",
    center: { x: (CHART_LEFT + CHART_RIGHT) / 2, y },
    bbox: { x: CHART_LEFT, y: y - 4, w: CHART_WIDTH, h: 8 },
    render: () => (
      <g>
        <line
          x1={CHART_LEFT}
          y1={y}
          x2={CHART_LEFT + drawn}
          y2={y}
          stroke={TEXT_COLOR}
          strokeWidth={1.5}
          strokeDasharray={`${dashLen} ${gapLen}`}
        />
        {label && progress > 0.8 ? (
          <text
            x={CHART_LEFT + 8}
            y={y - 10}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={22}
          >
            {label}
          </text>
        ) : null}
      </g>
    ),
  };
}

function renderVLine(
  t: number,
  label: string | undefined,
  proj: Projector,
  progress: number,
  id?: string,
): Primitive {
  const x = proj.x(t);
  const totalLen = CHART_HEIGHT;
  const drawn = totalLen * progress;
  return {
    id: id ?? "",
    center: { x, y: CHART_TOP + CHART_HEIGHT / 2 },
    bbox: { x: x - 4, y: CHART_TOP, w: 8, h: CHART_HEIGHT },
    render: () => (
      <g>
        <line
          x1={x}
          y1={CHART_TOP}
          x2={x}
          y2={CHART_TOP + drawn}
          stroke={TEXT_COLOR}
          strokeWidth={1.5}
          strokeDasharray="8 6"
        />
        {label && progress > 0.8 ? (
          <text
            x={x + 8}
            y={CHART_TOP + 22}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={22}
          >
            {label}
          </text>
        ) : null}
      </g>
    ),
  };
}

function renderLine(
  beat: Extract<Beat, { op: "line" }>,
  proj: Projector,
  progress: number,
): Primitive {
  const { points, arrowEnd, id } = beat;
  if (points.length < 2) {
    return { id: id ?? "", render: () => null };
  }
  const pts = points.map((p) => proj.xy(p));
  const totalLen = polylineLength(pts);
  const drawn = totalLen * progress;
  const drawnPts = interpolatePolyline(pts, drawn);
  const d = drawnPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Arrowhead at terminal: only render once the line has (mostly) reached the end.
  const showHead = arrowEnd && progress > 0.9 && drawnPts.length >= 2;
  let headPath: string | null = null;
  if (showHead) {
    const tip = drawnPts[drawnPts.length - 1];
    const prev = drawnPts[drawnPts.length - 2];
    const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const headScale = Math.min(1, (progress - 0.9) / 0.1);
    const headLen = 26 * headScale;
    const spread = Math.PI / 6.5;
    const h1x = tip.x - headLen * Math.cos(angle - spread);
    const h1y = tip.y - headLen * Math.sin(angle - spread);
    const h2x = tip.x - headLen * Math.cos(angle + spread);
    const h2y = tip.y - headLen * Math.sin(angle + spread);
    headPath = `M ${tip.x} ${tip.y} L ${h1x} ${h1y} L ${h2x} ${h2y} Z`;
  }

  return {
    id: id ?? "",
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    render: () => (
      <g>
        <path
          d={d}
          fill="none"
          stroke={TEXT_COLOR}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {headPath ? <path d={headPath} fill={TEXT_COLOR} stroke="none" /> : null}
      </g>
    ),
  };
}

function renderZone(
  beat: Extract<Beat, { op: "zone" }>,
  proj: Projector,
  progress: number,
): Primitive {
  const y1 = proj.y(Math.max(beat.y1, beat.y2));
  const y2 = proj.y(Math.min(beat.y1, beat.y2));
  const x1 = proj.x(Math.min(beat.t1, beat.t2));
  const x2 = proj.x(Math.max(beat.t1, beat.t2));
  const w = x2 - x1;
  const h = y2 - y1;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const opacity = progress;
  return {
    id: beat.id ?? "",
    center: { x: cx, y: cy },
    bbox: { x: x1, y: y1, w, h },
    render: () => (
      <g opacity={opacity}>
        <rect
          x={x1}
          y={y1}
          width={w}
          height={h}
          fill={beat.color ?? ZONE_COLOR}
          stroke={ZONE_STROKE}
          strokeWidth={2}
          strokeDasharray="8 6"
        />
        {beat.label ? (
          <text
            x={x1 + 10}
            y={y1 + 26}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={22}
          >
            {beat.label}
          </text>
        ) : null}
      </g>
    ),
  };
}

function renderMarker(
  beat: Extract<Beat, { op: "marker" }>,
  proj: Projector,
  progress: number,
): Primitive {
  const p = proj.xy(beat.at);
  const r = 10 * progress;
  const pos = beat.labelPos ?? "above";
  const label = beat.label;
  let tx = p.x, ty = p.y;
  let anchor: "start" | "middle" | "end" = "middle";
  if (pos === "above") { ty = p.y - 20; }
  else if (pos === "below") { ty = p.y + 34; }
  else if (pos === "left") { tx = p.x - 18; ty = p.y + 6; anchor = "end"; }
  else if (pos === "right") { tx = p.x + 18; ty = p.y + 6; anchor = "start"; }
  return {
    id: beat.id ?? "",
    center: p,
    bbox: { x: p.x - 12, y: p.y - 12, w: 24, h: 24 },
    render: () => (
      <g>
        <circle cx={p.x} cy={p.y} r={r} fill={MARKER_COLOR} stroke="#0A0A0A" strokeWidth={2} />
        {label && progress > 0.6 ? (
          <text
            x={tx}
            y={ty}
            textAnchor={anchor}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={26}
            fontWeight={600}
            opacity={(progress - 0.6) / 0.4}
          >
            {label}
          </text>
        ) : null}
      </g>
    ),
  };
}

function renderArrow(
  beat: Extract<Beat, { op: "arrow" }>,
  proj: Projector,
  progress: number,
): Primitive {
  const a = proj.xy(beat.from);
  const b = proj.xy(beat.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bx = a.x + dx * progress;
  const by = a.y + dy * progress;
  // Arrowhead
  const angle = Math.atan2(dy, dx);
  const headLen = 18 * progress;
  const h1 = {
    x: bx - headLen * Math.cos(angle - Math.PI / 6),
    y: by - headLen * Math.sin(angle - Math.PI / 6),
  };
  const h2 = {
    x: bx - headLen * Math.cos(angle + Math.PI / 6),
    y: by - headLen * Math.sin(angle + Math.PI / 6),
  };
  return {
    id: beat.id ?? "",
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    render: () => (
      <g>
        <line x1={a.x} y1={a.y} x2={bx} y2={by} stroke={TEXT_COLOR} strokeWidth={3} />
        {progress > 0.9 ? (
          <path
            d={`M ${bx} ${by} L ${h1.x} ${h1.y} L ${h2.x} ${h2.y} Z`}
            fill={TEXT_COLOR}
          />
        ) : null}
      </g>
    ),
  };
}

function renderLabel(
  beat: Extract<Beat, { op: "label" }>,
  progress: number,
): Primitive {
  const rise = interpolate(progress, [0, 1], [10, 0]);
  return {
    id: beat.id ?? "",
    render: () => (
      <text
        x={beat.at.x}
        y={beat.at.y + rise}
        fill={TEXT_COLOR}
        fontFamily="'Messina Sans', sans-serif"
        fontSize={beat.size ?? 42}
        opacity={progress}
      >
        {beat.text}
      </text>
    ),
  };
}

function renderBracket(
  beat: Extract<Beat, { op: "bracket" }>,
  proj: Projector,
  progress: number,
): Primitive {
  const x = proj.x(beat.t);
  const y1 = proj.y(Math.max(beat.y1, beat.y2));
  const y2 = proj.y(Math.min(beat.y1, beat.y2));
  const armLen = 16;
  const drawnH = (y2 - y1) * progress;
  const cy = (y1 + y2) / 2;
  return {
    id: beat.id ?? "",
    center: { x, y: cy },
    render: () => (
      <g stroke={TEXT_COLOR} strokeWidth={2} fill="none">
        <line x1={x} y1={y1} x2={x} y2={y1 + drawnH} />
        <line x1={x - armLen} y1={y1} x2={x + armLen} y2={y1} />
        {progress > 0.95 ? (
          <line x1={x - armLen} y1={y2} x2={x + armLen} y2={y2} />
        ) : null}
        {beat.label && progress > 0.8 ? (
          <text
            x={x + 24}
            y={cy + 8}
            fill={TEXT_COLOR}
            fontFamily="'Messina Sans', sans-serif"
            fontSize={22}
            stroke="none"
          >
            {beat.label}
          </text>
        ) : null}
      </g>
    ),
  };
}

const PulseRing: React.FC<{ bbox: { x: number; y: number; w: number; h: number }; amt: number }> = ({
  bbox,
  amt,
}) => {
  const pad = 8 + amt * 22;
  return (
    <rect
      x={bbox.x - pad}
      y={bbox.y - pad}
      width={bbox.w + pad * 2}
      height={bbox.h + pad * 2}
      fill="none"
      stroke={`rgba(255,255,255,${0.55 * (1 - amt) + 0.15})`}
      strokeWidth={2 + amt * 2}
    />
  );
};

/* ─── Utilities ─────────────────────────────────────────────────────────── */

function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

function formatPrice(p: number): string {
  return Math.abs(p) < 10 ? p.toFixed(2) : p.toFixed(0);
}

function polylineLength(pts: XY[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Return the polyline truncated to `length` pixels along its arc. */
function interpolatePolyline(pts: XY[], length: number): XY[] {
  const result: XY[] = [pts[0]];
  let remaining = length;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= remaining) {
      result.push(pts[i]);
      remaining -= segLen;
    } else {
      const frac = remaining / segLen;
      result.push({
        x: pts[i - 1].x + dx * frac,
        y: pts[i - 1].y + dy * frac,
      });
      return result;
    }
  }
  return result;
}
