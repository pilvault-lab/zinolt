import React, { useEffect, useRef, useState } from "react";
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

/* ─── Dev-adjustable config ─────────────────────────────────────────────────
 * Background, corner points, and style live here.
 * Swap in a new clip → adjust corners → done. Nothing else to touch.
 * -------------------------------------------------------------------------- */
export const BILLBOARD_CONFIG = {
  /** Clip served from public/billboard/backgrounds/ */
  backgroundClip: "billboard/backgrounds/billboard-bg.mp4",

  /**
   * Four corners of the wall panel in 1080×1920 canvas pixels.
   * Clockwise from top-left. Adjust to match the building wall in the plate.
   */
  corners: {
    tl: [168, 660] as [number, number],
    tr: [912, 628] as [number, number],
    br: [932, 900] as [number, number],
    bl: [148, 936] as [number, number],
  },

  /** Intrinsic panel size used for the CSS warp math (px). */
  panelW: 800,
  panelH: 280,

  /** Inner padding (px) */
  panelPadX: 44,
  panelPadY: 28,

  /** Panel fill — near-white parchment */
  panelColor: "rgba(240, 237, 228, 0.97)",

  /** Shadow: scene-grounded depth */
  panelShadow:
    "0 10px 48px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.12)",

  /** Text */
  fontFamily: "'Anton', Impact, 'Arial Narrow', sans-serif",
  textColor: "#141414",
  lineHeight: 1.04,
  maxFontSize: 160,
  minFontSize: 16,

  /** VERNAVLE brand line at the bottom */
  brandLine: "VERNAVLE",
  brandFontFamily: "'Vernavle', sans-serif",
  brandFontSize: 11,
  brandLetterSpacing: "0.28em",

  /** Film-grain overlay opacity (0 = off) */
  grainOpacity: 0.045,

  /** Fade the panel in over this many frames (0 = instant) */
  fadeInFrames: 18,
};

export const BILLBOARD_FPS = 30;
export const BILLBOARD_DURATION_FRAMES = BILLBOARD_FPS * 12;

export type BillboardProps = {
  quote: string;
  forRender?: boolean;
};

export const billboardDefaultProps: BillboardProps = {
  quote: "The best time to plant a tree was 20 years ago.",
  forRender: false,
};

/* ─── Font loading ───────────────────────────────────────────────────────── */
let _antonLoaded = false;
let _vernavleLoaded = false;

function loadFontOnce(family: string, src: string, flag: () => boolean, setFlag: () => void) {
  if (typeof window === "undefined" || flag()) return;
  setFlag();
  const handle = delayRender(`${family} font`);
  const face = new FontFace(family, src);
  face
    .load()
    .then(() => {
      document.fonts.add(face);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
}

loadFontOnce(
  "Anton",
  `url(${staticFile("brand/Anton-Regular.woff2")}) format('woff2')`,
  () => _antonLoaded,
  () => { _antonLoaded = true; },
);
loadFontOnce(
  "Vernavle",
  `url(${staticFile("brand/vernavle-font.woff2")}) format('woff2')`,
  () => _vernavleLoaded,
  () => { _vernavleLoaded = true; },
);

/* ─── Projective transform ───────────────────────────────────────────────── */
/**
 * Compute a CSS matrix3d string that warps a W×H rectangle (origin 0,0)
 * to the four given canvas-pixel corners: tl, tr, br, bl.
 */
function computeMatrix3d(
  W: number,
  H: number,
  tl: [number, number],
  tr: [number, number],
  br: [number, number],
  bl: [number, number],
): string {
  const [x0, y0] = tl;
  const [x1, y1] = tr;
  const [x2, y2] = br;
  const [x3, y3] = bl;

  // Solve 2×2 system for perspective coefficients p, q
  const dx1 = x1 - x2, dx2 = x3 - x2;
  const dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const p = (sx * dy2 - dx2 * sy) / det;
  const q = (dx1 * sy - sx * dy1) / det;

  // 3×3 homography from unit square → destination quad
  const h11u = x1 - x0 + p * x1;
  const h12u = x3 - x0 + q * x3;
  const h13 = x0;
  const h21u = y1 - y0 + p * y1;
  const h22u = y3 - y0 + q * y3;
  const h23 = y0;
  const h31u = p;
  const h32u = q;

  // Scale columns to map from pixel space (0..W, 0..H) instead of (0..1, 0..1)
  const h11 = h11u / W, h12 = h12u / H;
  const h21 = h21u / W, h22 = h22u / H;
  const h31 = h31u / W, h32 = h32u / H;

  // CSS matrix3d — column-major 4×4
  return (
    `matrix3d(` +
    `${h11},${h21},0,${h31},` +
    `${h12},${h22},0,${h32},` +
    `0,0,1,0,` +
    `${h13},${h23},0,1)`
  );
}

/* ─── Film grain SVG filter ─────────────────────────────────────────────── */
const GRAIN_FILTER_ID = "bb-grain";
const GrainDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <defs>
      <filter id={GRAIN_FILTER_ID} x="0%" y="0%" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.72"
          numOctaves="4"
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix type="saturate" values="0" in="noise" result="grey" />
        <feBlend in="SourceGraphic" in2="grey" mode="overlay" />
      </filter>
    </defs>
  </svg>
);

/* ─── Composition ────────────────────────────────────────────────────────── */
export const BillboardComposition: React.FC<BillboardProps> = ({
  quote,
  forRender = false,
}) => {
  const frame = useCurrentFrame();
  const cfg = BILLBOARD_CONFIG;

  // Panel fade-in
  const panelOpacity =
    cfg.fadeInFrames > 0
      ? interpolate(frame, [0, cfg.fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  // Inner text area dimensions
  const textAreaW = cfg.panelW - cfg.panelPadX * 2;
  // Reserve space for brand line (font size + gap)
  const brandReserve = cfg.brandFontSize * 3;
  const textAreaH = cfg.panelH - cfg.panelPadY * 2 - brandReserve;

  // Font size fitting via DOM measurement
  const [fontSize, setFontSize] = useState(cfg.maxFontSize);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fitHandle] = useState(() => delayRender("billboard-text-fit"));

  useEffect(() => {
    const el = measureRef.current;
    if (!el) {
      continueRender(fitHandle);
      return;
    }
    const raf = requestAnimationFrame(() => {
      let lo = cfg.minFontSize;
      let hi = cfg.maxFontSize;
      let best = lo;
      // 14 iterations of binary search is plenty for this range
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) >> 1;
        el.style.fontSize = `${mid}px`;
        if (el.scrollHeight <= textAreaH) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setFontSize(best);
      continueRender(fitHandle);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitHandle, quote]);

  const panelTransform = computeMatrix3d(
    cfg.panelW,
    cfg.panelH,
    cfg.corners.tl,
    cfg.corners.tr,
    cfg.corners.br,
    cfg.corners.bl,
  );

  const bgSrc = staticFile(cfg.backgroundClip);

  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      {/* Background street clip */}
      {forRender ? (
        <MediaVideo
          src={bgSrc}
          muted
          loop
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <OffthreadVideo
          src={bgSrc}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {/* Grain overlay */}
      {cfg.grainOpacity > 0 && (
        <>
          <GrainDefs />
          <AbsoluteFill
            style={{
              filter: `url(#${GRAIN_FILTER_ID})`,
              opacity: cfg.grainOpacity,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* Billboard panel — warped to the wall corners */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: cfg.panelW,
            height: cfg.panelH,
            transformOrigin: "0 0",
            transform: panelTransform,
            opacity: panelOpacity,
          }}
        >
          {/* Panel background */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: cfg.panelColor,
              boxShadow: cfg.panelShadow,
            }}
          />

          {/* Text content */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: `${cfg.panelPadY}px ${cfg.panelPadX}px ${cfg.panelPadY + brandReserve}px`,
            }}
          >
            <div
              style={{
                fontFamily: cfg.fontFamily,
                fontSize,
                fontWeight: 400,
                lineHeight: cfg.lineHeight,
                color: cfg.textColor,
                textTransform: "uppercase",
                textAlign: "center",
                width: "100%",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                letterSpacing: "-0.01em",
                textShadow: "0 1px 3px rgba(0,0,0,0.12)",
              }}
            >
              {quote}
            </div>
          </div>

          {/* VERNAVLE brand line */}
          <div
            style={{
              position: "absolute",
              bottom: Math.round(cfg.panelPadY * 0.65),
              left: 0,
              right: 0,
              textAlign: "center",
              fontFamily: cfg.brandFontFamily,
              fontSize: cfg.brandFontSize,
              letterSpacing: cfg.brandLetterSpacing,
              color: cfg.textColor,
              opacity: 0.42,
              textTransform: "uppercase",
            }}
          >
            {cfg.brandLine}
          </div>
        </div>
      </div>

      {/* Hidden measuring div — same font/width, used for binary-search fit */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          width: textAreaW,
          fontSize,
          fontFamily: cfg.fontFamily,
          fontWeight: 400,
          lineHeight: cfg.lineHeight,
          textTransform: "uppercase",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          letterSpacing: "-0.01em",
        }}
      >
        {quote}
      </div>
    </AbsoluteFill>
  );
};
