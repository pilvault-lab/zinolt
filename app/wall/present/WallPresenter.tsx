"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/* This presenter reads the same localStorage payload the WallStudio writes.
 * It deliberately re-declares the Slide shape inline to avoid coupling to
 * WallStudio's internals (which is a client-only module). If the studio's
 * Slide shape evolves, just mirror the new optional fields here. */

const STORAGE_KEY = "zinolt:wall:slides:v1";
const ORIENTATION_KEY = "zinolt:wall:orientation:v1";

type Anchor =
  | "tl" | "tc" | "tr"
  | "ml" | "mc" | "mr"
  | "bl" | "bc" | "br";

const ANCHOR_STYLES: Record<
  Anchor,
  { top: string; left: string; right?: string; transform: string }
> = {
  tl: { top: "8%",  left: "8%",  transform: "translate(0, 0)" },
  tc: { top: "8%",  left: "50%", transform: "translate(-50%, 0)" },
  tr: { top: "8%",  left: "auto", right: "8%", transform: "translate(0, 0)" },
  ml: { top: "50%", left: "8%",  transform: "translate(0, -50%)" },
  mc: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
  mr: { top: "50%", left: "auto", right: "8%", transform: "translate(0, -50%)" },
  bl: { top: "auto", left: "8%",  transform: "translate(0, 0)" },
  bc: { top: "auto", left: "50%", transform: "translate(-50%, 0)" },
  br: { top: "auto", left: "auto", right: "8%", transform: "translate(0, 0)" },
};

type Orientation = "9:16" | "1:1" | "16:9";
const ORIENTATIONS: Record<Orientation, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

type Slide = {
  id: string;
  text: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  bgColor: string;
  textColor: string;
  perspective: number;
  rotateY: number;
  skewY: number;
  anchor: Anchor;
  autoFit: boolean;
  leadEmphasis: boolean;
  bgImage?: string;
  bgImageOpacity?: number;
};

const loadSlides = (): Slide[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Slide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed;
  } catch {
    return [];
  }
};

const loadOrientation = (): Orientation => {
  if (typeof window === "undefined") return "9:16";
  try {
    const o = window.localStorage.getItem(ORIENTATION_KEY);
    if (o && o in ORIENTATIONS) return o as Orientation;
  } catch {}
  return "9:16";
};

const WallSurface: React.FC<{ slide: Slide; width: number; height: number }> = ({
  slide,
  width,
  height,
}) => {
  const anchor = ANCHOR_STYLES[slide.anchor] ?? ANCHOR_STYLES.ml;
  const isBottom = slide.anchor.startsWith("b");
  const lines = slide.text.split("\n");
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      firstNonEmpty = i;
      break;
    }
  }
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        backgroundColor: slide.bgColor,
      }}
    >
      {slide.bgImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.bgImage}
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: slide.bgImageOpacity ?? 0.85,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: anchor.left,
          right: anchor.right,
          top: isBottom ? "auto" : anchor.top,
          bottom: isBottom ? "8%" : "auto",
          transform: `${anchor.transform} perspective(${slide.perspective}px) rotateY(${slide.rotateY}deg) skewY(${slide.skewY}deg)`,
          transformOrigin: "left center",
          maxWidth: "85%",
          fontFamily:
            "'AngelList', Inter, 'Helvetica Neue', Arial, sans-serif",
          fontWeight: slide.fontWeight,
          fontSize: slide.fontSize,
          lineHeight: slide.lineHeight,
          letterSpacing: `${slide.letterSpacing}em`,
          textTransform: "uppercase",
          color: slide.textColor,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {slide.leadEmphasis && firstNonEmpty >= 0
          ? lines.map((ln, i) =>
              i === firstNonEmpty ? (
                <span
                  key={i}
                  style={{
                    display: "block",
                    fontSize: `${slide.fontSize * 1.4}px`,
                    fontWeight: Math.min(900, slide.fontWeight + 100),
                    letterSpacing: `${slide.letterSpacing - 0.01}em`,
                  }}
                >
                  {ln}
                </span>
              ) : (
                <span key={i} style={{ display: "block" }}>
                  {ln}
                </span>
              ),
            )
          : slide.text}
      </div>
    </div>
  );
};

export const WallPresenter: React.FC = () => {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [orientation, setOrientation] = useState<Orientation>("9:16");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setSlides(loadSlides());
    setOrientation(loadOrientation());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        setIndex((i) => Math.min(slides.length - 1, i + 1));
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        setIndex((i) => Math.max(0, i - 1));
        e.preventDefault();
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(slides.length - 1);
      } else if (e.key === "Escape") {
        if (typeof document !== "undefined" && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } else if (e.key === "f" || e.key === "F") {
        if (typeof document !== "undefined" && !document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  if (slides.length === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#070708",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          color: "#fafafa",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <p style={{ fontSize: 18 }}>No wall panels saved yet.</p>
        <Link
          href="/wall"
          style={{ color: "#fafafa", textDecoration: "underline", fontSize: 14 }}
        >
          Open the wall studio
        </Link>
      </div>
    );
  }

  const dims = ORIENTATIONS[orientation];
  const active = slides[index];
  if (!active) return null;
  const aspect = dims.height / dims.width;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#050507",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      onClick={(e) => {
        const w = e.currentTarget.clientWidth;
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        if (x < w / 3) setIndex((i) => Math.max(0, i - 1));
        else setIndex((i) => Math.min(slides.length - 1, i + 1));
      }}
    >
      <div
        style={{
          height: "92vh",
          width: `calc(92vh / ${aspect})`,
          maxWidth: "92vw",
          maxHeight: `calc(92vw * ${aspect})`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Render the full-resolution surface then CSS-scale to the visible
            box so the editorial proportions are 1:1 with the exported PNG. */}
        <div
          style={{
            width: dims.width,
            height: dims.height,
            transform: `scale(${1})`,
            transformOrigin: "top left",
            position: "absolute",
            top: 0,
            left: 0,
            // We rely on the parent's aspect-preserving sizing; use 100% of
            // the parent and let object-style flexbox handle it.
            scale: "calc(var(--wall-scale, 1))",
          }}
          ref={(el) => {
            if (!el) return;
            const parent = el.parentElement;
            if (!parent) return;
            const s = Math.min(
              parent.clientWidth / dims.width,
              parent.clientHeight / dims.height,
            );
            el.style.setProperty("--wall-scale", String(s));
            el.style.transformOrigin = "top left";
            el.style.transform = `scale(${s})`;
          }}
        >
          <WallSurface
            slide={active}
            width={dims.width}
            height={dims.height}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "rgba(255,255,255,0.4)",
          fontFamily: "Inter, sans-serif",
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        {index + 1} / {slides.length} · ← → navigate · F fullscreen
      </div>
    </div>
  );
};
