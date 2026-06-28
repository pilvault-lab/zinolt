"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FrostedSurface } from "../_components/FrostedStudio";

const STORAGE_KEY = "zinolt:frosted:slides:v1";
const ORIENTATION_KEY = "zinolt:frosted:orientation:v1";

type Orientation = "9:16" | "1:1" | "16:9";
const ORIENTATIONS: Record<Orientation, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

// Inline structural shape — we don't want a hard import dependency on the
// studio module's runtime exports beyond FrostedSurface. The shape must
// stay compatible with what FrostedSurface accepts.
type Slide = Parameters<typeof FrostedSurface>[0]["slide"];

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

export const FrostedPresenter: React.FC = () => {
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
        <p style={{ fontSize: 18 }}>No frosted cards saved yet.</p>
        <Link
          href="/frosted"
          style={{ color: "#fafafa", textDecoration: "underline", fontSize: 14 }}
        >
          Open the frosted studio
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
        <div
          ref={(el) => {
            if (!el) return;
            const parent = el.parentElement;
            if (!parent) return;
            const s = Math.min(
              parent.clientWidth / dims.width,
              parent.clientHeight / dims.height,
            );
            el.style.transformOrigin = "top left";
            el.style.transform = `scale(${s})`;
          }}
          style={{
            width: dims.width,
            height: dims.height,
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <FrostedSurface
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
