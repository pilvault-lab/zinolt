"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeShell,
  ORIENTATIONS,
  DEFAULT_ORIENTATION,
  type BackgroundTone,
  type Orientation,
} from "@/components/slides/BadgeShell";
import {
  DEFAULT_LAYOUT_ID,
  getLayout,
  type SlideValues,
} from "@/lib/slide-layouts";

const STORAGE_KEY = "zinolt:slides:v1";
const ORIENTATION_KEY = "zinolt:slides:orientation:v1";

type CardTone = "paper" | "bone" | "ink";

const CARD_TONES: Record<
  CardTone,
  { cardColor: string; cardInk: string; strap: string }
> = {
  paper: { cardColor: "#FAFAFA", cardInk: "#0A0A0A", strap: "#0A0A0A" },
  bone: { cardColor: "#F3F1EC", cardInk: "#1A1715", strap: "#1A1612" },
  ink: { cardColor: "#101013", cardInk: "#F2F2F2", strap: "#0A0A0A" },
};

type PresenterSlide = {
  id: string;
  layoutId: string;
  values: SlideValues;
  backgroundTone: BackgroundTone;
  cardTone: CardTone;
};

const loadSlides = (): PresenterSlide[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PresenterSlide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed.map((s, i) => ({
      id: s.id ?? `s${i}`,
      layoutId: s.layoutId ?? DEFAULT_LAYOUT_ID,
      values: s.values ?? {},
      backgroundTone: s.backgroundTone ?? "neutral",
      cardTone:
        s.cardTone && s.cardTone in CARD_TONES
          ? (s.cardTone as CardTone)
          : "paper",
    }));
  } catch {
    return [];
  }
};

export const PresenterView: React.FC = () => {
  const [slides, setSlides] = useState<PresenterSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);

  useEffect(() => {
    setSlides(loadSlides());
    try {
      const raw = window.localStorage.getItem(ORIENTATION_KEY);
      if (raw && raw in ORIENTATIONS) {
        setOrientation(raw as Orientation);
      }
    } catch {
      // ignore
    }
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

  const active = slides[index];
  const layout = useMemo(
    () => (active ? getLayout(active.layoutId) : null),
    [active],
  );
  const cardTone = active ? CARD_TONES[active.cardTone] : CARD_TONES.paper;

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
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <p style={{ fontSize: 18 }}>No slides saved yet.</p>
        <Link
          href="/slides"
          style={{
            color: "#fafafa",
            textDecoration: "underline",
            fontSize: 14,
          }}
        >
          Open the slide studio
        </Link>
      </div>
    );
  }

  if (!active || !layout) return null;

  const LayoutRender = layout.Render;
  const dims = ORIENTATIONS[orientation];
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
        if (x < w / 3) {
          setIndex((i) => Math.max(0, i - 1));
        } else {
          setIndex((i) => Math.min(slides.length - 1, i + 1));
        }
      }}
    >
      <div
        style={{
          height: "92vh",
          width: `calc(92vh / ${aspect})`,
          maxWidth: "92vw",
          maxHeight: `calc(92vw * ${aspect})`,
          position: "relative",
          boxShadow:
            "0 4px 10px rgba(0,0,0,0.4), 0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <BadgeShell
          backgroundTone={active.backgroundTone}
          cardColor={cardTone.cardColor}
          cardInkColor={cardTone.cardInk}
          strapColor={cardTone.strap}
          orientation={orientation}
        >
          <LayoutRender values={active.values} />
        </BadgeShell>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "rgba(255,255,255,0.4)",
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        {index + 1} / {slides.length} · ← → to navigate · F fullscreen
      </div>
    </div>
  );
};
