"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toCanvas } from "html-to-image";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";

/* -------------------------------------------------------------------------
 * Wall Signage template — architectural matte-grey wall with an
 * angled, all-caps editorial slogan painted on it. Each slide is a single
 * text string; the deck cycles through them like a carousel. Output is a
 * flat PNG (no WebGL) captured via html-to-image at 4× pixel density.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = "zinolt:wall:slides:v1";
const ORIENTATION_KEY = "zinolt:wall:orientation:v1";

type Orientation = "9:16" | "1:1" | "16:9";
const ORIENTATIONS: Record<
  Orientation,
  { label: string; width: number; height: number }
> = {
  "9:16": { label: "9 : 16", width: 1080, height: 1920 },
  "1:1": { label: "1 : 1", width: 1080, height: 1080 },
  "16:9": { label: "16 : 9", width: 1920, height: 1080 },
};
const DEFAULT_ORIENTATION: Orientation = "9:16";

/* 3×3 anchor grid for the text block. Each key maps to (top/left/transform). */
export type Anchor =
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

/* Curated matte-wall presets. */
const WALL_COLOR_PRESETS: { label: string; bg: string; text: string }[] = [
  { label: "Concrete", bg: "#E5E5E5", text: "#121212" },
  { label: "Bone",     bg: "#EFEDE4", text: "#121212" },
  { label: "Plaster",  bg: "#D6D3CD", text: "#1A1715" },
  { label: "Oxblood",  bg: "#742F2D", text: "#F2F2F2" },
];

type Slide = {
  id: string;
  text: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number; // em
  bgColor: string;
  textColor: string;
  /* New: transform controls. */
  perspective: number;   // px (CSS)
  rotateY: number;       // deg
  skewY: number;         // deg
  /* New: anchor position within the 9-square grid. */
  anchor: Anchor;
  /* New: auto-fit text to the 85% box. Overrides manual fontSize when on. */
  autoFit: boolean;
  /* New: first line gets bigger weight + size (editorial lead). */
  leadEmphasis: boolean;
  /* New: optional reference photo behind the text. */
  bgImage?: string;      // data URL
  bgImageOpacity?: number; // 0..1
};

const DEFAULT_SLIDE: Omit<Slide, "id"> = {
  text: "Build\nWhat\nLasts",
  fontSize: 280,
  fontWeight: 800,
  lineHeight: 0.92,
  letterSpacing: -0.04,
  bgColor: "#E5E5E5",
  textColor: "#121212",
  perspective: 600,
  rotateY: 12,
  skewY: -3,
  anchor: "ml",
  autoFit: false,
  leadEmphasis: false,
  bgImageOpacity: 0.85,
};

/* WCAG 2.x contrast ratio (1..21). 4.5 = AA body, 7 = AAA body, 3 = AA large. */
const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};
const relLuminance = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrastRatio = (a: string, b: string) => {
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
};
const contrastLabel = (ratio: number): { tag: string; ok: boolean } => {
  if (ratio >= 7) return { tag: "AAA", ok: true };
  if (ratio >= 4.5) return { tag: "AA", ok: true };
  if (ratio >= 3) return { tag: "AA Large", ok: true };
  return { tag: "Fail", ok: false };
};

/* Smart filename — slugify the first non-empty line of text. */
const slugify = (s: string): string =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "panel";

const newSlideId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const makeSlide = (overrides: Partial<Slide> = {}): Slide => ({
  id: newSlideId(),
  ...DEFAULT_SLIDE,
  ...overrides,
});

const loadSlides = (): Slide[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Slide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((s) => ({
      ...DEFAULT_SLIDE,
      ...s,
      id: s.id ?? newSlideId(),
    }));
  } catch {
    return null;
  }
};

/* The wall surface. Self-contained so the studio preview and the offscreen
 * export source both render the same component with the same layout. */
const WallSurface: React.FC<{
  slide: Slide;
  width: number;
  height: number;
}> = ({ slide, width, height }) => {
  const anchor = ANCHOR_STYLES[slide.anchor] ?? ANCHOR_STYLES.ml;
  // For bottom anchors we use bottom:8% instead of top.
  const isBottom = slide.anchor.startsWith("b");

  // Resolve auto-fit. Measures the rendered text box and shrinks fontSize
  // to keep the block within 85% of the wall width AND 90% of height.
  const measureRef = useRef<HTMLDivElement>(null);
  const [fittedSize, setFittedSize] = useState<number | null>(null);
  useEffect(() => {
    if (!slide.autoFit) {
      setFittedSize(null);
      return;
    }
    const el = measureRef.current;
    if (!el) return;
    // Binary search in [min, max] for the largest size that fits.
    const min = 40;
    const max = slide.fontSize;
    const maxW = width * 0.85;
    const maxH = height * 0.9;
    let lo = min;
    let hi = max;
    let best = min;
    const fits = (px: number): boolean => {
      el.style.fontSize = `${px}px`;
      // Force layout flush.
      return el.scrollWidth <= maxW && el.scrollHeight <= maxH;
    };
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    setFittedSize(best);
    el.style.fontSize = `${best}px`;
  }, [
    slide.text,
    slide.autoFit,
    slide.fontSize,
    slide.fontWeight,
    slide.lineHeight,
    slide.letterSpacing,
    width,
    height,
  ]);

  const effectiveSize = slide.autoFit && fittedSize != null ? fittedSize : slide.fontSize;

  // Lead emphasis: bump the first non-empty line's size + weight.
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
            // Strictly matte — no filter, no blur.
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
          fontSize: effectiveSize,
          lineHeight: slide.lineHeight,
          letterSpacing: `${slide.letterSpacing}em`,
          textTransform: "uppercase",
          color: slide.textColor,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
        ref={measureRef}
      >
        {slide.leadEmphasis && firstNonEmpty >= 0
          ? lines.map((ln, i) => {
              if (i === firstNonEmpty) {
                return (
                  <span
                    key={i}
                    style={{
                      display: "block",
                      fontSize: `${effectiveSize * 1.4}px`,
                      fontWeight: Math.min(900, slide.fontWeight + 100),
                      letterSpacing: `${slide.letterSpacing - 0.01}em`,
                    }}
                  >
                    {ln}
                  </span>
                );
              }
              return <span key={i} style={{ display: "block" }}>{ln}</span>;
            })
          : slide.text}
      </div>
    </div>
  );
};

export const WallStudio: React.FC = () => {
  const [slides, setSlides] = useState<Slide[]>(() => [makeSlide()]);
  const [activeId, setActiveId] = useState<string>(() => slides[0]?.id ?? "");
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [isExportingCarousel, setIsExportingCarousel] = useState(false);
  const [exportError, setExportError] = useState("");

  const exportRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = loadSlides();
    if (saved) {
      setSlides(saved);
      setActiveId(saved[0].id);
    }
    try {
      const o = window.localStorage.getItem(ORIENTATION_KEY);
      if (o && o in ORIENTATIONS) setOrientation(o as Orientation);
    } catch {
      // ignore
    }
  }, []);

  // Persist slides.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const h = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slides));
      } catch {
        // ignore
      }
    }, 250);
    return () => window.clearTimeout(h);
  }, [slides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {
      // ignore
    }
  }, [orientation]);

  const dims = ORIENTATIONS[orientation];
  const previewMax = 420;
  const previewScale = Math.min(
    previewMax / dims.width,
    previewMax / dims.height,
  );

  const activeSlide = slides.find((s) => s.id === activeId) ?? slides[0];
  const activeIndex = Math.max(
    0,
    slides.findIndex((s) => s.id === activeSlide.id),
  );

  const updateActive = useCallback(
    (patch: Partial<Slide>) => {
      setSlides((prev) =>
        prev.map((s) => (s.id === activeId ? { ...s, ...patch } : s)),
      );
    },
    [activeId],
  );

  const addSlide = useCallback(() => {
    const s = makeSlide({
      bgColor: activeSlide?.bgColor,
      textColor: activeSlide?.textColor,
      fontSize: activeSlide?.fontSize,
      fontWeight: activeSlide?.fontWeight,
      lineHeight: activeSlide?.lineHeight,
      letterSpacing: activeSlide?.letterSpacing,
    });
    setSlides((prev) => [...prev, s]);
    setActiveId(s.id);
  }, [activeSlide]);

  const duplicateSlide = useCallback((id: string) => {
    setSlides((prev) => {
      const src = prev.find((s) => s.id === id);
      if (!src) return prev;
      const copy: Slide = { ...src, id: newSlideId() };
      const idx = prev.findIndex((s) => s.id === id);
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      setActiveId(copy.id);
      return next;
    });
  }, []);

  const removeSlide = useCallback(
    (id: string) => {
      setSlides((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((s) => s.id === id);
        const next = prev.filter((s) => s.id !== id);
        if (id === activeId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveId(fallback.id);
        }
        return next;
      });
    },
    [activeId],
  );

  const captureCurrent = useCallback(
    async (scale: number): Promise<string> => {
      if (!exportRef.current) throw new Error("Export source not ready");
      const canvas = await toCanvas(exportRef.current, {
        width: dims.width,
        height: dims.height,
        pixelRatio: scale,
        cacheBust: false,
        backgroundColor: activeSlide.bgColor,
      });
      return canvas.toDataURL("image/png");
    },
    [dims.width, dims.height, activeSlide.bgColor],
  );

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsExporting(true);
    try {
      // Small flush — give React paint a frame so the latest text/styles
      // are committed before we rasterise.
      await new Promise((r) => window.setTimeout(r, 120));
      const dataUrl = await captureCurrent(4);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `zinolt-wall-${String(activeIndex + 1).padStart(2, "0")}-${slugify(activeSlide.text)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Wall export failed", err);
      setExportError("Couldn't export this panel. Try Chrome on desktop.");
    } finally {
      setIsExporting(false);
    }
  }, [captureCurrent, activeIndex]);

  /* MP4/WebM carousel export — captures each panel as a PNG via html-to-image,
   * paints them onto a stage canvas with a 0.4s crossfade, and records via
   * MediaRecorder. Output mime is mp4 where supported (Safari) else webm. */
  const handleDownloadCarousel = useCallback(async () => {
    setExportError("");
    setIsExportingCarousel(true);
    try {
      // 1. Pre-render every panel at half the export resolution so the
      //    canvas stays manageable (60fps × 4K is too much for MediaRecorder).
      //    Half-4K = 2× SLIDE_W,H = 2160 × 3840 for 9:16. Plenty for social.
      const renderScale = 2;
      const W = dims.width * renderScale;
      const H = dims.height * renderScale;

      const frames: HTMLImageElement[] = [];
      const originalActiveId = activeId;
      for (const s of slides) {
        setActiveId(s.id);
        await new Promise((r) => window.setTimeout(r, 220));
        if (!exportRef.current) continue;
        const canvas = await toCanvas(exportRef.current, {
          width: dims.width,
          height: dims.height,
          pixelRatio: renderScale,
          cacheBust: false,
          backgroundColor: s.bgColor,
        });
        const img = new Image();
        img.src = canvas.toDataURL("image/png");
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("frame decode failed"));
        });
        frames.push(img);
      }
      setActiveId(originalActiveId);

      // 2. Set up the stage canvas + MediaRecorder.
      const stage = document.createElement("canvas");
      stage.width = W;
      stage.height = H;
      const ctx = stage.getContext("2d")!;
      const stream = stage.captureStream(30);
      const mimeCandidates = [
        "video/mp4;codecs=avc1",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
      let mime = "video/webm";
      for (const m of mimeCandidates) {
        if (
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported(m)
        ) {
          mime = m;
          break;
        }
      }
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 12_000_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((res) => {
        recorder.onstop = () => res();
      });
      recorder.start();

      // 3. Animate: each frame held for HOLD ms with FADE ms crossfade.
      const HOLD = 2200;
      const FADE = 450;
      const FPS = 30;
      const FRAME_MS = 1000 / FPS;

      let t = 0;
      const totalPerSlide = HOLD + FADE;
      const totalMs = frames.length * totalPerSlide;

      while (t < totalMs) {
        const elapsedInSlide = t % totalPerSlide;
        const slideIdx = Math.floor(t / totalPerSlide) % frames.length;
        const current = frames[slideIdx];
        const next = frames[(slideIdx + 1) % frames.length];

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.drawImage(current, 0, 0, W, H);

        if (elapsedInSlide > HOLD && frames.length > 1) {
          const fadeProgress = (elapsedInSlide - HOLD) / FADE;
          ctx.globalAlpha = Math.min(1, Math.max(0, fadeProgress));
          ctx.drawImage(next, 0, 0, W, H);
          ctx.globalAlpha = 1;
        }

        await new Promise((r) => window.setTimeout(r, FRAME_MS));
        t += FRAME_MS;
      }

      recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-wall-carousel-${slides.length}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Wall carousel export failed", err);
      setExportError(
        "Couldn't export the carousel video. Try Chrome/Safari on desktop.",
      );
    } finally {
      setIsExportingCarousel(false);
    }
  }, [slides, activeId, dims.width, dims.height]);

  const handleDownloadDeck = useCallback(async () => {
    setExportError("");
    setIsExportingDeck(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        setActiveId(s.id);
        // Wait for render + paint before capturing.
        await new Promise((r) => window.setTimeout(r, 220));
        if (!exportRef.current) continue;
        const canvas = await toCanvas(exportRef.current, {
          width: dims.width,
          height: dims.height,
          pixelRatio: 4,
          cacheBust: false,
          backgroundColor: s.bgColor,
        });
        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.split(",")[1] ?? "";
        zip.file(
          `wall-${String(i + 1).padStart(2, "0")}-${slugify(s.text)}.png`,
          base64,
          { base64: true },
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-wall-deck-${slides.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Wall deck export failed", err);
      setExportError("Couldn't export the deck.");
    } finally {
      setIsExportingDeck(false);
    }
  }, [slides, dims.width, dims.height]);

  // Keyboard nav (consistent with /slides studio).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if (inField) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        const idx = slides.findIndex((s) => s.id === activeId);
        const next = slides[Math.min(slides.length - 1, idx + 1)];
        if (next) setActiveId(next.id);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        const idx = slides.findIndex((s) => s.id === activeId);
        const next = slides[Math.max(0, idx - 1)];
        if (next) setActiveId(next.id);
        e.preventDefault();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSlide(activeId);
      } else if ((e.key === "Backspace" || e.key === "Delete") && slides.length > 1) {
        e.preventDefault();
        removeSlide(activeId);
      } else if (e.key === "n" || e.key === "N") {
        addSlide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides, activeId, addSlide, duplicateSlide, removeSlide]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <div className="flex items-center gap-(--ds-space-xs)">
            <Button asChild variant="pill-secondary" size="pill">
              <Link href="/wall/present" target="_blank">Present</Link>
            </Button>
            <Button asChild variant="pill-secondary" size="pill">
              <Link href="/">Back home</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* LEFT — text + style */}
        <aside
          className="flex flex-col gap-6 overflow-y-auto p-6"
          style={{
            width: 320,
            backgroundColor: BRAND.colors.paper,
            borderRight: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Text
            </label>
            <textarea
              rows={5}
              value={activeSlide.text}
              onChange={(e) => updateActive({ text: e.target.value })}
              placeholder="WHATEVER YOU WANT TO SAY"
              className="w-full rounded-md border px-3 py-2 font-sans text-sm uppercase"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: "#FFFFFF",
                outline: "none",
                resize: "vertical",
                letterSpacing: "0.02em",
                lineHeight: 1.3,
                fontWeight: 600,
              }}
            />
          </div>

          {/* Color block — presets + free picker + WCAG chip */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Color
            </label>
            <div className="flex gap-1.5">
              {WALL_COLOR_PRESETS.map((p) => {
                const active =
                  p.bg.toLowerCase() === activeSlide.bgColor.toLowerCase();
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => updateActive({ bgColor: p.bg, textColor: p.text })}
                    aria-label={p.label}
                    title={p.label}
                    className="flex-1 transition-colors"
                    style={{
                      height: 40,
                      borderRadius: 6,
                      backgroundColor: p.bg,
                      border: `2px solid ${
                        active ? BRAND.colors.ink : BRAND.colors.grey200
                      }`,
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        bottom: 4,
                        left: 0,
                        right: 0,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: p.text,
                        textAlign: "center",
                      }}
                    >
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <ColorRow
              label="Wall"
              value={activeSlide.bgColor}
              onChange={(c) => updateActive({ bgColor: c })}
            />
            <ColorRow
              label="Text"
              value={activeSlide.textColor}
              onChange={(c) => updateActive({ textColor: c })}
            />
            <ContrastBadge fg={activeSlide.textColor} bg={activeSlide.bgColor} />
          </div>

          {/* Typography controls */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Typography
            </label>
            <Slider
              label="Size"
              value={activeSlide.fontSize}
              min={80}
              max={520}
              step={4}
              suffix="px"
              onChange={(v) => updateActive({ fontSize: v })}
              disabled={activeSlide.autoFit}
            />
            <Slider
              label="Weight"
              value={activeSlide.fontWeight}
              min={100}
              max={900}
              step={10}
              onChange={(v) => updateActive({ fontWeight: v })}
            />
            <Slider
              label="Line height"
              value={activeSlide.lineHeight}
              min={0.8}
              max={1.4}
              step={0.02}
              onChange={(v) => updateActive({ lineHeight: v })}
            />
            <Slider
              label="Tracking"
              value={activeSlide.letterSpacing}
              min={-0.08}
              max={0.1}
              step={0.005}
              suffix="em"
              onChange={(v) => updateActive({ letterSpacing: v })}
            />
            <Toggle
              label="Auto-fit"
              hint="Shrinks size to fit the wall."
              checked={activeSlide.autoFit}
              onChange={(v) => updateActive({ autoFit: v })}
            />
            <Toggle
              label="Lead emphasis"
              hint="Bumps the first line's size + weight."
              checked={activeSlide.leadEmphasis}
              onChange={(v) => updateActive({ leadEmphasis: v })}
            />
          </div>

          {/* Wall / perspective sliders */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Wall
            </label>
            <Slider
              label="Perspective"
              value={activeSlide.perspective}
              min={300}
              max={1400}
              step={20}
              suffix="px"
              onChange={(v) => updateActive({ perspective: v })}
            />
            <Slider
              label="Rotate Y"
              value={activeSlide.rotateY}
              min={-30}
              max={30}
              step={1}
              suffix="°"
              onChange={(v) => updateActive({ rotateY: v })}
            />
            <Slider
              label="Skew Y"
              value={activeSlide.skewY}
              min={-12}
              max={12}
              step={0.5}
              suffix="°"
              onChange={(v) => updateActive({ skewY: v })}
            />
          </div>

          {/* 3×3 anchor */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Anchor
            </label>
            <AnchorGrid
              value={activeSlide.anchor}
              onChange={(a) => updateActive({ anchor: a })}
            />
          </div>

          {/* Reference photo backdrop */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Backdrop
            </label>
            <BgImageRow
              value={activeSlide.bgImage}
              opacity={activeSlide.bgImageOpacity ?? 0.85}
              onSet={(dataUrl) => updateActive({ bgImage: dataUrl })}
              onClear={() => updateActive({ bgImage: undefined })}
              onOpacity={(o) => updateActive({ bgImageOpacity: o })}
            />
          </div>
        </aside>

        {/* CENTER — preview */}
        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {/* Visible preview — scaled down via CSS transform on a wrapper. */}
          <div
            style={{
              width: dims.width * previewScale,
              height: dims.height * previewScale,
              boxShadow:
                "0 2px 4px rgba(0,0,0,0.15), 0 10px 25px rgba(0,0,0,0.25), 0 30px 70px rgba(0,0,0,0.45)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
                width: dims.width,
                height: dims.height,
              }}
            >
              <WallSurface
                slide={activeSlide}
                width={dims.width}
                height={dims.height}
              />
            </div>
          </div>

          {/* Offscreen source for html-to-image — rendered at full
              resolution so 4× capture produces a clean 4K asset. */}
          <div
            aria-hidden
            style={{
              position: "fixed",
              top: -99999,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <div ref={exportRef}>
              <WallSurface
                slide={activeSlide}
                width={dims.width}
                height={dims.height}
              />
            </div>
          </div>
        </main>

        {/* RIGHT — orientation, export, slides */}
        <aside
          className="flex flex-col"
          style={{
            width: 280,
            backgroundColor: BRAND.colors.paper,
            borderLeft: `1px solid ${BRAND.colors.grey200}`,
            minHeight: 0,
          }}
        >
          <div className="flex flex-col p-(--ds-space-md) pb-(--ds-space-sm)">
            <div className="mb-(--ds-space-sm) flex flex-col gap-1.5">
              <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
                Orientation
              </label>
              <div className="flex gap-1.5">
                {(Object.keys(ORIENTATIONS) as Orientation[]).map((id) => {
                  const o = ORIENTATIONS[id];
                  const active = orientation === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setOrientation(id)}
                      aria-pressed={active}
                      className="flex-1 transition-colors"
                      style={{
                        padding: "8px 6px",
                        borderRadius: "var(--ds-radius-md)",
                        backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                        color: active ? BRAND.colors.paper : BRAND.colors.ink,
                        border: `1px solid ${
                          active ? BRAND.colors.ink : BRAND.colors.grey200
                        }`,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              onClick={handleDownload}
              disabled={isExporting || isExportingDeck || isExportingCarousel}
              variant="pill-primary"
              size="pill"
              className="w-full"
            >
              {isExporting ? "Exporting 4K…" : "Download 4K PNG"}
            </Button>
            <Button
              onClick={handleDownloadDeck}
              disabled={isExporting || isExportingDeck || isExportingCarousel}
              variant="pill-secondary"
              size="pill"
              className="mt-(--ds-space-xs) w-full"
            >
              {isExportingDeck
                ? "Building deck…"
                : `Download deck (${slides.length}) zip`}
            </Button>
            <Button
              onClick={handleDownloadCarousel}
              disabled={isExporting || isExportingDeck || isExportingCarousel}
              variant="pill-secondary"
              size="pill"
              className="mt-(--ds-space-xs) w-full"
            >
              {isExportingCarousel
                ? "Rendering carousel…"
                : `Export carousel video`}
            </Button>
            <p className="type-body-sm mt-(--ds-space-sm) text-ds-on-surface-muted leading-snug">
              Output: {dims.width * 4} × {dims.height * 4} PNG · Panel{" "}
              {activeIndex + 1} of {slides.length}
            </p>
            <p className="type-body-sm mt-(--ds-space-xs) text-ds-on-surface-muted text-[11px] leading-snug">
              ← → switch · ⌘D duplicate · ⌫ delete · N new
            </p>
            {exportError ? (
              <p className="type-body-sm mt-(--ds-space-sm) text-ds-on-surface leading-snug">
                {exportError}
              </p>
            ) : null}
          </div>

          <div
            className="flex flex-1 flex-col gap-2 overflow-y-auto p-6 pt-4"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              minHeight: 0,
            }}
          >
            <div className="flex items-center justify-between">
              <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
                Panels
              </label>
              <button
                type="button"
                onClick={addSlide}
                aria-label="Add panel"
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  border: `1px solid ${BRAND.colors.grey200}`,
                  backgroundColor: "#FFFFFF",
                  color: BRAND.colors.ink,
                  fontFamily: "var(--font-ui)",
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                +
              </button>
            </div>

            <SlidePicker
              slides={slides}
              activeId={activeSlide.id}
              onSelect={setActiveId}
              onRemove={removeSlide}
              onDuplicate={duplicateSlide}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, suffix, disabled, onChange }) => {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-sans" style={{ fontSize: 11, color: BRAND.colors.grey500 }}>
          {label}
        </span>
        <code
          className="font-sans"
          style={{
            fontSize: 11,
            color: BRAND.colors.ink,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: 0,
          }}
        >
          {value.toFixed(decimals)}
          {suffix ?? ""}
        </code>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: BRAND.colors.ink, opacity: disabled ? 0.4 : 1 }}
      />
    </div>
  );
};

const Toggle: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, hint, checked, onChange }) => {
  return (
    <label
      className="flex cursor-pointer items-center gap-2"
      style={{ fontSize: 12, color: BRAND.colors.ink }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: BRAND.colors.ink, width: 14, height: 14 }}
      />
      <span className="font-sans" style={{ flex: 1 }}>
        {label}
        {hint ? (
          <span
            className="font-sans"
            style={{
              display: "block",
              fontSize: 10,
              color: BRAND.colors.grey500,
              marginTop: 1,
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
};

const AnchorGrid: React.FC<{
  value: Anchor;
  onChange: (a: Anchor) => void;
}> = ({ value, onChange }) => {
  const order: Anchor[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 4,
        width: 96,
      }}
    >
      {order.map((a) => {
        const active = a === value;
        return (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            aria-label={`Anchor ${a}`}
            aria-pressed={active}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              borderRadius: 4,
              backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
              border: `1px solid ${active ? BRAND.colors.ink : BRAND.colors.grey200}`,
              cursor: "pointer",
              padding: 0,
              position: "relative",
            }}
          >
            {/* dot showing the anchor position inside each cell */}
            <span
              style={{
                position: "absolute",
                width: 5,
                height: 5,
                borderRadius: "50%",
                backgroundColor: active ? BRAND.colors.paper : BRAND.colors.ink,
                top: a.startsWith("t") ? 4 : a.startsWith("m") ? "50%" : "auto",
                bottom: a.startsWith("b") ? 4 : "auto",
                left: a.endsWith("l") ? 4 : a.endsWith("c") ? "50%" : "auto",
                right: a.endsWith("r") ? 4 : "auto",
                transform: a === "mc"
                  ? "translate(-50%, -50%)"
                  : a.startsWith("m") && a.endsWith("l")
                    ? "translateY(-50%)"
                    : a.startsWith("m") && a.endsWith("r")
                      ? "translateY(-50%)"
                      : a.startsWith("m") && a.endsWith("c")
                        ? "translate(-50%, -50%)"
                        : a.endsWith("c")
                          ? "translateX(-50%)"
                          : "none",
              }}
            />
          </button>
        );
      })}
    </div>
  );
};

const ContrastBadge: React.FC<{ fg: string; bg: string }> = ({ fg, bg }) => {
  const ratio = contrastRatio(fg, bg);
  const { tag, ok } = contrastLabel(ratio);
  return (
    <div
      className="flex items-center gap-2"
      style={{
        backgroundColor: ok ? "#EAF7EE" : "#FCEAEA",
        color: ok ? "#1F6B3A" : "#9A1F1F",
        borderRadius: 6,
        padding: "6px 10px",
        fontFamily: "var(--font-ui)",
        fontSize: 11,
      }}
    >
      <span style={{ fontWeight: 600 }}>{tag}</span>
      <span style={{ opacity: 0.75 }}>
        {ratio.toFixed(2)}:1 contrast
      </span>
    </div>
  );
};

const BgImageRow: React.FC<{
  value: string | undefined;
  opacity: number;
  onSet: (dataUrl: string) => void;
  onClear: () => void;
  onOpacity: (o: number) => void;
}> = ({ value, opacity, onSet, onClear, onOpacity }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && f.type.startsWith("image/")) {
            const r = new FileReader();
            r.onload = () => onSet(String(r.result));
            r.readAsDataURL(f);
          }
        }}
        className="cursor-pointer rounded-md text-center transition-colors"
        style={{
          border: `1.5px dashed ${BRAND.colors.grey500}`,
          padding: 14,
          backgroundColor: "#FFFFFF",
          position: "relative",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => onSet(String(r.result));
            r.readAsDataURL(f);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
        {value ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              style={{
                width: 48,
                height: 48,
                objectFit: "cover",
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
            <span
              className="font-sans text-xs"
              style={{
                color: BRAND.colors.ink,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                textAlign: "left",
              }}
            >
              Backdrop added
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="font-sans text-[11px] underline-offset-2 hover:underline"
              style={{
                color: BRAND.colors.grey500,
                background: "none",
                padding: 0,
                border: "none",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        ) : (
          <p
            className="font-sans text-xs"
            style={{ color: BRAND.colors.grey500 }}
          >
            Drop a wall photo or click
          </p>
        )}
      </div>
      {value ? (
        <Slider
          label="Backdrop opacity"
          value={opacity}
          min={0.2}
          max={1}
          step={0.05}
          onChange={onOpacity}
        />
      ) : null}
    </div>
  );
};

const ColorRow: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-sans"
        style={{
          fontSize: 11,
          color: BRAND.colors.grey500,
          width: 40,
        }}
      >
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color`}
        style={{
          width: 44,
          height: 32,
          padding: 0,
          border: `1px solid ${BRAND.colors.grey200}`,
          borderRadius: 6,
          backgroundColor: "transparent",
          cursor: "pointer",
        }}
      />
      <code
        className="font-sans"
        style={{
          fontSize: 11,
          color: BRAND.colors.ink,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {value.toUpperCase()}
      </code>
    </div>
  );
};

const SlidePicker: React.FC<{
  slides: Slide[];
  activeId: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}> = ({ slides, activeId, onSelect, onRemove, onDuplicate }) => {
  return (
    <div className="flex flex-col gap-2">
      {slides.map((s, i) => {
        const active = s.id === activeId;
        const firstLine = (s.text || "").split("\n")[0] || `Panel ${i + 1}`;
        return (
          <div key={s.id} style={{ position: "relative", width: "100%" }}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className="flex flex-col items-stretch justify-between text-left transition-colors"
              style={{
                width: "100%",
                padding: "12px 12px 14px",
                borderRadius: 10,
                backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                color: active ? "#FFFFFF" : BRAND.colors.ink,
                border: `1px solid ${
                  active ? BRAND.colors.ink : BRAND.colors.grey200
                }`,
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  opacity: 0.65,
                }}
              >
                Panel {i + 1}
              </span>
              <span
                style={{
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                }}
              >
                {firstLine}
              </span>
            </button>

            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                display: "flex",
                gap: 4,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(s.id);
                }}
                aria-label={`Duplicate panel ${i + 1}`}
                title="Duplicate (⌘D)"
                style={ICON_BTN_STYLE}
              >
                ⧉
              </button>
              {slides.length > 1 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(s.id);
                  }}
                  aria-label={`Remove panel ${i + 1}`}
                  title="Delete (⌫)"
                  style={ICON_BTN_STYLE}
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ICON_BTN_STYLE: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: `1px solid ${BRAND.colors.grey200}`,
  backgroundColor: "#FFFFFF",
  color: BRAND.colors.ink,
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

