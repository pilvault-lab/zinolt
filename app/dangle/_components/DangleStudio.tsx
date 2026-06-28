"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { toCanvas } from "html-to-image";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import type {
  ImageFit,
  LanyardHandle,
} from "@/components/lanyard/InteractiveLanyard";

/* Rapier-free static lanyard. Loaded client-only via dynamic({ ssr: false })
 * because Three/WebGL touches `window`. */
const InteractiveLanyard = dynamic(
  () => import("@/components/lanyard/InteractiveLanyard"),
  { ssr: false },
);

const STORAGE_KEY = "zinolt:dangle:slides:v1";
const ORIENTATION_KEY = "zinolt:dangle:orientation:v1";
const CARD_PX_W = 900;
const CARD_PX_H = 1430;

type Orientation = "9:16" | "1:1" | "4:5";
const ORIENTATIONS: Record<
  Orientation,
  { label: string; width: number; height: number }
> = {
  "9:16": { label: "9 : 16", width: 1080, height: 1920 },
  "4:5": { label: "4 : 5", width: 1080, height: 1350 },
  "1:1": { label: "1 : 1", width: 1080, height: 1080 },
};
const DEFAULT_ORIENTATION: Orientation = "9:16";

type Slide = {
  id: string;
  text: string;
  /** Optional image rendered as the card face background, below the text.
   *  Data URL when uploaded/pasted, or a remote URL. */
  cardImage: string | null;
  textColor: string;
  cardBgColor: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number; // em
  textAlign: "left" | "center" | "right";
  uppercase: boolean;
  /** Optional override for the band texture. Null → default zinolt strap. */
  lanyardImage: string | null;
  lanyardWidth: number;
  /** Visual size of the lanyard within the canvas. Drives camera distance —
   *  higher value = closer camera = bigger lanyard. */
  lanyardSize: number;
};

const DEFAULT_SLIDE: Omit<Slide, "id"> = {
  text: "A short, well-formed\nquote that anchors\nthe slide.",
  cardImage: null,
  textColor: "#0A0A0A",
  cardBgColor: "#FAFAFA",
  fontSize: 92,
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: -0.02,
  textAlign: "left",
  uppercase: false,
  lanyardImage: null,
  lanyardWidth: 1,
  lanyardSize: 1,
};

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

const slugify = (s: string): string =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "card";

/* The hidden DOM source rasterised by html-to-image. Rendered at a fixed
 * 900×1430 canvas-pixel size; html-to-image picks up the computed styles
 * and bakes them into a canvas we hand off as the lanyard's frontImage. */
type TextureSourceProps = { slide: Slide };
const TextureSource = forwardRef<HTMLDivElement, TextureSourceProps>(
  function TextureSource({ slide }, ref) {
    return (
      <div
        ref={ref}
        style={{
          width: CARD_PX_W,
          height: CARD_PX_H,
          backgroundColor: slide.cardBgColor,
          backgroundImage: slide.cardImage ? `url(${slide.cardImage})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: slide.textColor,
          fontFamily:
            "'AngelList', Inter, 'Helvetica Neue', Arial, sans-serif",
          padding: "150px 90px 150px 90px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent:
            slide.textAlign === "left"
              ? "flex-start"
              : slide.textAlign === "right"
                ? "flex-end"
                : "center",
        }}
      >
        <div
          style={{
            fontSize: slide.fontSize,
            fontWeight: slide.fontWeight,
            lineHeight: slide.lineHeight,
            letterSpacing: `${slide.letterSpacing}em`,
            textAlign: slide.textAlign,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            textTransform: slide.uppercase ? "uppercase" : "none",
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textRendering: "optimizeLegibility",
            width: "100%",
          }}
        >
          {slide.text}
        </div>
      </div>
    );
  },
);

export const DangleStudio: React.FC = () => {
  const [slides, setSlides] = useState<Slide[]>(() => [makeSlide()]);
  const [activeId, setActiveId] = useState<string>(() => slides[0]?.id ?? "");
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [exportError, setExportError] = useState("");
  const [imageFit, setImageFit] = useState<ImageFit>("cover");

  /* Rasterised front-face URL (data URL produced by html-to-image). */
  const [frontImage, setFrontImage] = useState<string | null>(null);

  const lanyardRef = useRef<LanyardHandle | null>(null);
  const textureSourceRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });

  /* Hydrate */
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
    } catch {}
  }, []);

  /* Persist */
  useEffect(() => {
    if (!hydratedRef.current) return;
    const h = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slides));
      } catch {}
    }, 250);
    return () => window.clearTimeout(h);
  }, [slides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {}
  }, [orientation]);

  /* Stage size — drives the preview wrapper so the lanyard fills the space. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const padding = 56;
      setStageBox({
        w: Math.max(320, el.clientWidth - padding),
        h: Math.max(320, el.clientHeight - padding),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dims = ORIENTATIONS[orientation];
  const previewScale =
    stageBox.w === 0
      ? 0.3
      : Math.min(stageBox.w / dims.width, stageBox.h / dims.height);
  const previewW = dims.width * previewScale;
  const previewH = dims.height * previewScale;

  const activeSlide = slides.find((s) => s.id === activeId) ?? slides[0];
  const activeIndex = Math.max(
    0,
    slides.findIndex((s) => s.id === activeSlide.id),
  );

  /* Rebake the front-face texture from the hidden DOM whenever the active
   * slide's content or appearance changes. Debounced to amortise typing. */
  useEffect(() => {
    const el = textureSourceRef.current;
    if (!el) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const canvas = await toCanvas(el, {
          width: CARD_PX_W,
          height: CARD_PX_H,
          pixelRatio: 2,
          cacheBust: false,
          backgroundColor: activeSlide.cardBgColor,
        });
        if (cancelled) return;
        setFrontImage(canvas.toDataURL("image/png"));
      } catch (err) {
        console.error("Texture rebake failed", err);
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeSlide.id,
    activeSlide.text,
    activeSlide.cardImage,
    activeSlide.textColor,
    activeSlide.cardBgColor,
    activeSlide.fontSize,
    activeSlide.fontWeight,
    activeSlide.lineHeight,
    activeSlide.letterSpacing,
    activeSlide.textAlign,
    activeSlide.uppercase,
  ]);

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
      textColor: activeSlide?.textColor,
      cardBgColor: activeSlide?.cardBgColor,
      fontSize: activeSlide?.fontSize,
      fontWeight: activeSlide?.fontWeight,
      lineHeight: activeSlide?.lineHeight,
      letterSpacing: activeSlide?.letterSpacing,
      textAlign: activeSlide?.textAlign,
      uppercase: activeSlide?.uppercase,
      lanyardImage: activeSlide?.lanyardImage,
      lanyardWidth: activeSlide?.lanyardWidth,
      lanyardSize: activeSlide?.lanyardSize,
      cardImage: activeSlide?.cardImage,
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

  /* 4K export — flush DOM rebake + paint, then call the lanyard's
   * imperative exportPng(scale=4). Restores backbuffer afterwards. */
  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsExporting(true);
    try {
      /* Wait for the full rebake chain to settle before exporting:
       *   - 80ms texture-rebake debounce in the DOM-to-canvas effect
       *   - useTexture loads the new data URL into a THREE.Texture
       *   - cardMap useMemo recomposites the GLB atlas with it
       *   - R3F renders the next frame with the new map
       * Total worst-case observed ~450ms. 600ms buys safety margin. */
      await new Promise((r) => window.setTimeout(r, 600));
      /* Poll briefly for the apiRef in case ExportBridge hasn't registered
       * yet on the very first download. */
      for (let i = 0; i < 10 && !lanyardRef.current; i++) {
        await new Promise((r) => window.setTimeout(r, 60));
      }
      if (!lanyardRef.current) throw new Error("Lanyard not ready");
      const dataUrl = await lanyardRef.current.exportPng(4);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `zinolt-dangle-${String(activeIndex + 1).padStart(2, "0")}-${slugify(activeSlide.text)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Dangle export failed", err);
      setExportError(
        "Couldn't export this card. Try Chrome on desktop.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [activeIndex, activeSlide.text]);

  const handleDownloadDeck = useCallback(async () => {
    setExportError("");
    setIsExportingDeck(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const originalActiveId = activeId;
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        setActiveId(s.id);
        /* Wait for React render + the 80ms texture rebake debounce +
         * useTexture image load + cardMap recomposite + paint. 700ms is
         * the safest deck-wide bound; single export uses 600ms. */
        await new Promise((r) => window.setTimeout(r, 700));
        /* Poll for apiRef in case of a first-time race. */
        for (let attempt = 0; attempt < 10 && !lanyardRef.current; attempt++) {
          await new Promise((r) => window.setTimeout(r, 60));
        }
        if (!lanyardRef.current) continue;
        const dataUrl = await lanyardRef.current.exportPng(4);
        const base64 = dataUrl.split(",")[1] ?? "";
        zip.file(
          `dangle-${String(i + 1).padStart(2, "0")}-${slugify(s.text)}.png`,
          base64,
          { base64: true },
        );
      }
      setActiveId(originalActiveId);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-dangle-deck-${slides.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Dangle deck export failed", err);
      setExportError("Couldn't export the deck.");
    } finally {
      setIsExportingDeck(false);
    }
  }, [slides, activeId]);

  /* Global clipboard paste — image goes onto the active card face. Skips
   * non-image payloads so text paste into the sidebar still works. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const r = new FileReader();
          r.onload = () => updateActive({ cardImage: String(r.result) });
          r.readAsDataURL(file);
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [updateActive]);

  /* Keyboard nav matches the other studios. */
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
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        slides.length > 1
      ) {
        e.preventDefault();
        removeSlide(activeId);
      } else if (e.key === "n" || e.key === "N") {
        addSlide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides, activeId, addSlide, duplicateSlide, removeSlide]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: `1px solid ${BRAND.colors.grey200}`,
    fontSize: 13,
    color: BRAND.colors.ink,
    backgroundColor: "#FFFFFF",
    outline: "none",
    fontFamily: "var(--font-ui), Inter, sans-serif",
  };

  const previewWrapperShadow = useMemo(
    () =>
      "0 2px 4px rgba(0,0,0,0.15), 0 10px 25px rgba(0,0,0,0.25), 0 30px 70px rgba(0,0,0,0.45)",
    [],
  );

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <div className="flex items-center gap-(--ds-space-xs)">
            <Button asChild variant="pill-secondary" size="pill">
              <Link href="/">Back home</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* LEFT — editor */}
        <aside
          className="flex flex-col gap-6 overflow-y-auto p-6"
          style={{
            width: 320,
            backgroundColor: BRAND.colors.paper,
            borderRight: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          {/* Text */}
          <div className="flex flex-col gap-3">
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Text
            </label>
            <textarea
              rows={6}
              value={activeSlide.text}
              onChange={(e) => updateActive({ text: e.target.value })}
              placeholder="Your statement here"
              style={{
                ...inputStyle,
                resize: "vertical",
                lineHeight: 1.35,
              }}
            />
            <FieldRow label="Alignment">
              <div className="flex gap-1.5">
                {(["left", "center", "right"] as const).map((a) => {
                  const active = activeSlide.textAlign === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => updateActive({ textAlign: a })}
                      className="flex-1 transition-colors"
                      style={{
                        padding: "6px 4px",
                        borderRadius: 6,
                        backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                        color: active ? BRAND.colors.paper : BRAND.colors.ink,
                        border: `1px solid ${
                          active ? BRAND.colors.ink : BRAND.colors.grey200
                        }`,
                        fontFamily: "var(--font-ui)",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </FieldRow>
            <Toggle
              label="Uppercase"
              checked={activeSlide.uppercase}
              onChange={(v) => updateActive({ uppercase: v })}
            />
            <FieldRow label="Card image">
              <ImageRow
                label=""
                value={activeSlide.cardImage}
                onSet={(src) => updateActive({ cardImage: src })}
                onClear={() => updateActive({ cardImage: null })}
                hint="Drop · click · or paste (⌘V)"
              />
            </FieldRow>
          </div>

          {/* Color */}
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
            <ColorRow
              label="Card"
              value={activeSlide.cardBgColor}
              onChange={(c) => updateActive({ cardBgColor: c })}
            />
            <ColorRow
              label="Text"
              value={activeSlide.textColor}
              onChange={(c) => updateActive({ textColor: c })}
            />
          </div>

          {/* Typography */}
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
              min={32}
              max={180}
              step={2}
              suffix="px"
              onChange={(v) => updateActive({ fontSize: v })}
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
              min={0.85}
              max={1.8}
              step={0.02}
              onChange={(v) => updateActive({ lineHeight: v })}
            />
            <Slider
              label="Tracking"
              value={activeSlide.letterSpacing}
              min={-0.06}
              max={0.1}
              step={0.005}
              suffix="em"
              onChange={(v) => updateActive({ letterSpacing: v })}
            />
          </div>

          {/* Band */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Band
            </label>
            <ImageRow
              label="Texture"
              value={activeSlide.lanyardImage}
              onSet={(src) => updateActive({ lanyardImage: src })}
              onClear={() => updateActive({ lanyardImage: null })}
            />
            <Slider
              label="Width"
              value={activeSlide.lanyardWidth}
              min={0.4}
              max={5}
              step={0.05}
              suffix="×"
              onChange={(v) => updateActive({ lanyardWidth: v })}
            />
            <Slider
              label="Size"
              value={activeSlide.lanyardSize}
              min={0.5}
              max={2}
              step={0.02}
              suffix="×"
              onChange={(v) => updateActive({ lanyardSize: v })}
            />
            <FitToggle value={imageFit} onChange={setImageFit} />
          </div>
        </aside>

        {/* CENTER — preview (ResizeObserver-fit) */}
        <main
          ref={stageRef}
          className="flex flex-1 items-center justify-center"
          style={{
            backgroundColor: "#0d0d10",
            padding: 28,
            position: "relative",
          }}
        >
          {/* Subtle vignette so the card pops off the dark canvas. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 60% 50% at 50% 45%, rgba(60,60,68,0.7) 0%, rgba(8,8,12,0) 70%)",
              pointerEvents: "none",
            }}
          />
          {previewScale > 0 ? (
            <div
              style={{
                width: previewW,
                height: previewH,
                position: "relative",
                boxShadow: previewWrapperShadow,
                overflow: "hidden",
              }}
            >
              <InteractiveLanyard
                apiRef={lanyardRef}
                slideWidth={dims.width}
                slideHeight={dims.height}
                /* Size slider drives camera distance — higher size = closer
                 * camera = bigger lanyard in frame. 22 is the base @ 1×. */
                position={[0, 0, 22 / Math.max(0.1, activeSlide.lanyardSize)]}
                fov={20}
                transparent
                frontImage={frontImage}
                imageFit={imageFit}
                lanyardImage={activeSlide.lanyardImage}
                lanyardWidth={activeSlide.lanyardWidth}
              />
            </div>
          ) : null}

          {/* Offscreen DOM source — html-to-image rasterises this into the
              front-face texture above. Position fixed at -99999 so it never
              affects layout but stays in the live DOM for measurement. */}
          <div
            aria-hidden
            style={{
              position: "fixed",
              top: -99999,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <TextureSource ref={textureSourceRef} slide={activeSlide} />
          </div>
        </main>

        {/* RIGHT — export + slides */}
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
              disabled={isExporting || isExportingDeck}
              variant="pill-primary"
              size="pill"
              className="w-full"
            >
              {isExporting ? "Exporting 4K…" : "Download 4K PNG"}
            </Button>
            <Button
              onClick={handleDownloadDeck}
              disabled={isExporting || isExportingDeck}
              variant="pill-secondary"
              size="pill"
              className="mt-(--ds-space-xs) w-full"
            >
              {isExportingDeck
                ? "Building deck…"
                : `Download deck (${slides.length}) zip`}
            </Button>
            <p className="type-body-sm mt-(--ds-space-sm) text-ds-on-surface-muted leading-snug">
              Output: {dims.width * 4} × {dims.height * 4} PNG · Card{" "}
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
                Cards
              </label>
              <button
                type="button"
                onClick={addSlide}
                aria-label="Add card"
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
            <div className="flex flex-col gap-2">
              {slides.map((s, i) => {
                const active = s.id === activeId;
                const firstLine =
                  s.text.split("\n").find((l) => l.trim()) || "(empty)";
                return (
                  <div
                    key={s.id}
                    style={{ position: "relative", width: "100%" }}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(s.id)}
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
                        Card {i + 1}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          width: "100%",
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
                          duplicateSlide(s.id);
                        }}
                        aria-label={`Duplicate card ${i + 1}`}
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
                            removeSlide(s.id);
                          }}
                          aria-label={`Remove card ${i + 1}`}
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
          </div>
        </aside>
      </div>
    </div>
  );
};

/* ---------------------- helpers ---------------------- */

const FieldRow: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <span
      className="font-sans"
      style={{ fontSize: 11, color: BRAND.colors.grey500 }}
    >
      {label}
    </span>
    {children}
  </div>
);

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, suffix, onChange }) => {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span
          className="font-sans"
          style={{ fontSize: 11, color: BRAND.colors.grey500 }}
        >
          {label}
        </span>
        <code
          className="font-sans"
          style={{
            fontSize: 11,
            color: BRAND.colors.ink,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: BRAND.colors.ink }}
      />
    </div>
  );
};

const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
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
    </span>
  </label>
);

const ColorRow: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span
      className="font-sans"
      style={{ fontSize: 11, color: BRAND.colors.grey500, width: 40 }}
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

const FitToggle: React.FC<{
  value: ImageFit;
  onChange: (v: ImageFit) => void;
}> = ({ value, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <span
      className="font-sans"
      style={{ fontSize: 11, color: BRAND.colors.grey500 }}
    >
      Image fit
    </span>
    <div className="flex gap-1.5">
      {(["cover", "contain"] as ImageFit[]).map((t) => {
        const active = value === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
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
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  </div>
);

const ImageRow: React.FC<{
  label: string;
  value: string | null;
  onSet: (src: string) => void;
  onClear: () => void;
  hint?: string;
}> = ({ label, value, onSet, onClear, hint }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <span
          className="font-sans"
          style={{ fontSize: 11, color: BRAND.colors.grey500 }}
        >
          {label}
        </span>
      ) : null}
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
          padding: 12,
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
                width: 40,
                height: 40,
                objectFit: "cover",
                borderRadius: 4,
                flexShrink: 0,
              }}
            />
            <span
              className="font-sans text-xs"
              style={{ color: BRAND.colors.ink, flex: 1, textAlign: "left" }}
            >
              Image set
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
            {hint ?? "Drop image or click"}
          </p>
        )}
      </div>
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
