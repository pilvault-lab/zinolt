"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toCanvas } from "html-to-image";
import {
  ArrowRight,
  ChevronRight,
  MoveRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";

/* -------------------------------------------------------------------------
 * Frosted Card v3 — text-only glass canvas with editable bottom row,
 * resizable glass surface, and zinolt logo corner mark.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = "zinolt:frosted:slides:v3";
const ORIENTATION_KEY = "zinolt:frosted:orientation:v1";
const BADGE_FONT =
  "'AngelList', Inter, 'Helvetica Neue', Arial, sans-serif";
const ZINOLT_LOGO = "/brand/zinolt-logo-white.png";

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

const BOTTOM_ICONS: Record<string, LucideIcon> = {
  chevronRight: ChevronRight,
  arrowRight: ArrowRight,
  moveRight: MoveRight,
};
const BOTTOM_ICON_KEYS = Object.keys(BOTTOM_ICONS);

type BgType = "image" | "color";

type Slide = {
  id: string;
  bgType: BgType;
  bgImageSrc: string;
  bgColorHex: string;
  glassOpacity: number;
  /** Card width as a 0..1 fraction of the canvas width. */
  cardWidthPct: number;
  /** Card height as a 0..1 fraction of the canvas height. */
  cardHeightPct: number;
  centerText: string;
  bottomLeft: string;
  bottomRight: string;
  bottomIconKey: string;
};

const DEFAULT_SLIDE: Omit<Slide, "id"> = {
  bgType: "color",
  bgImageSrc: "",
  bgColorHex: "#1E2733",
  glassOpacity: 0.15,
  cardWidthPct: 0.88,
  cardHeightPct: 0.78,
  centerText: "Elevate Assets\nWith Glass\nEffects",
  bottomLeft: "2500×3200 Dimensions",
  bottomRight: "Ready for Web Use",
  bottomIconKey: "chevronRight",
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "card";

/* ---------------------- The card + background surface --------------------- */
const FrostedSurface: React.FC<{
  slide: Slide;
  width: number;
  height: number;
}> = ({ slide, width, height }) => {
  const isImage = slide.bgType === "image" && Boolean(slide.bgImageSrc);

  const cardW = width * slide.cardWidthPct;
  const cardH = height * slide.cardHeightPct;
  const scaleBase = Math.min(cardW, cardH);

  const radius = scaleBase * 0.034;
  const padX = scaleBase * 0.075;
  const padY = scaleBase * 0.08;

  const logoHeight = scaleBase * 0.06;
  const bottomFontSize = scaleBase * 0.018;
  const bottomIconSize = scaleBase * 0.03;

  // Center text base size scales with card width.
  const centerFontSize = cardW * 0.085;

  const BottomIcon = BOTTOM_ICONS[slide.bottomIconKey] ?? ChevronRight;
  const glassRgba = `rgba(255, 255, 255, ${slide.glassOpacity.toFixed(3)})`;

  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        backgroundColor: isImage ? "#000" : slide.bgColorHex,
        backgroundImage: isImage ? `url(${slide.bgImageSrc})` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: cardW,
          height: cardH,
          backgroundColor: glassRgba,
          backdropFilter: "blur(25px)",
          WebkitBackdropFilter: "blur(25px)",
          borderRadius: radius,
          border: "1px solid rgba(255, 255, 255, 0.2)",
          padding: `${padY}px ${padX}px`,
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: BADGE_FONT,
        }}
      >
        {/* zinolt logo — absolutely positioned in the top-right corner */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ZINOLT_LOGO}
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            top: padY,
            right: padX,
            height: logoHeight,
            width: "auto",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />

        {/* Top spacer — keeps the center text from sliding under the logo. */}
        <div style={{ height: logoHeight }} aria-hidden />

        {/* Center text */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            textAlign: "left",
            paddingTop: scaleBase * 0.02,
            paddingBottom: scaleBase * 0.02,
          }}
        >
          <div
            style={{
              fontSize: centerFontSize,
              fontWeight: 700,
              lineHeight: 0.95,
              letterSpacing: "-0.025em",
              textTransform: "uppercase",
              color: "#FFFFFF",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              width: "100%",
            }}
          >
            {slide.centerText}
          </div>
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: padX * 0.5,
          }}
        >
          <span
            style={{
              fontSize: bottomFontSize,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.75)",
              fontWeight: 500,
              flex: 1,
              textAlign: "left",
            }}
          >
            {slide.bottomLeft}
          </span>
          <BottomIcon
            size={bottomIconSize}
            color="rgba(255, 255, 255, 0.85)"
            strokeWidth={1.5}
            aria-hidden
          />
          <span
            style={{
              fontSize: bottomFontSize,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.75)",
              fontWeight: 500,
              flex: 1,
              textAlign: "right",
            }}
          >
            {slide.bottomRight}
          </span>
        </div>
      </div>
    </div>
  );
};

export const FrostedStudio: React.FC = () => {
  const [slides, setSlides] = useState<Slide[]>(() => [makeSlide()]);
  const [activeId, setActiveId] = useState<string>(() => slides[0]?.id ?? "");
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [exportError, setExportError] = useState("");

  const exportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });

  /* hydrate */
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

  /* persist */
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

  /* Measure the center stage so the preview fills as much space as possible. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const padding = 56; // leave room for box-shadow + margins
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
    stageBox.w === 0 || stageBox.h === 0
      ? 0.3
      : Math.min(stageBox.w / dims.width, stageBox.h / dims.height);

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
      bgType: activeSlide?.bgType,
      bgImageSrc: activeSlide?.bgImageSrc,
      bgColorHex: activeSlide?.bgColorHex,
      glassOpacity: activeSlide?.glassOpacity,
      cardWidthPct: activeSlide?.cardWidthPct,
      cardHeightPct: activeSlide?.cardHeightPct,
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

  /* Global clipboard paste — when bg type is image and the user pastes an
   * image, route it into the active slide's bgImageSrc. Skips non-image
   * payloads so text paste into the sidebar still behaves normally. */
  useEffect(() => {
    if (activeSlide.bgType !== "image") return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const r = new FileReader();
          r.onload = () =>
            updateActive({ bgImageSrc: String(r.result) });
          r.readAsDataURL(file);
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeSlide.bgType, updateActive]);

  /* exports */
  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsExporting(true);
    try {
      await new Promise((r) => window.setTimeout(r, 140));
      if (!exportRef.current) throw new Error("Export source not ready");
      const canvas = await toCanvas(exportRef.current, {
        width: dims.width,
        height: dims.height,
        pixelRatio: 4,
        cacheBust: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `zinolt-frosted-${String(activeIndex + 1).padStart(2, "0")}-${slugify(activeSlide.centerText)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Frosted export failed", err);
      setExportError(
        "Couldn't export this card. Try Chrome on desktop — Safari's backdrop-filter capture is unreliable.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [dims.width, dims.height, activeIndex, activeSlide.centerText]);

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
        await new Promise((r) => window.setTimeout(r, 240));
        if (!exportRef.current) continue;
        const canvas = await toCanvas(exportRef.current, {
          width: dims.width,
          height: dims.height,
          pixelRatio: 4,
          cacheBust: false,
        });
        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.split(",")[1] ?? "";
        zip.file(
          `frosted-${String(i + 1).padStart(2, "0")}-${slugify(s.centerText)}.png`,
          base64,
          { base64: true },
        );
      }
      setActiveId(originalActiveId);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-frosted-deck-${slides.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Frosted deck export failed", err);
      setExportError("Couldn't export the deck.");
    } finally {
      setIsExportingDeck(false);
    }
  }, [slides, activeId, dims.width, dims.height]);

  /* keyboard */
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

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <div className="flex items-center gap-(--ds-space-xs)">
            <Button asChild variant="pill-secondary" size="pill">
              <Link href="/frosted/present" target="_blank">
                Present
              </Link>
            </Button>
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
          {/* Background */}
          <div className="flex flex-col gap-3">
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Background
            </label>
            <div className="flex gap-1.5">
              {(["image", "color"] as BgType[]).map((t) => {
                const active = activeSlide.bgType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateActive({ bgType: t })}
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
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {activeSlide.bgType === "image" ? (
              <BgImageRow
                value={activeSlide.bgImageSrc}
                onSet={(src) => updateActive({ bgImageSrc: src })}
                onClear={() => updateActive({ bgImageSrc: "" })}
              />
            ) : (
              <ColorRow
                label="Color"
                value={activeSlide.bgColorHex}
                onChange={(c) => updateActive({ bgColorHex: c })}
              />
            )}
          </div>

          {/* Glass */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Glass
            </label>
            <Slider
              label="Opacity"
              value={activeSlide.glassOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => updateActive({ glassOpacity: v })}
            />
            <Slider
              label="Width"
              value={activeSlide.cardWidthPct}
              min={0.3}
              max={1}
              step={0.01}
              suffix="×"
              onChange={(v) => updateActive({ cardWidthPct: v })}
            />
            <Slider
              label="Height"
              value={activeSlide.cardHeightPct}
              min={0.3}
              max={1}
              step={0.01}
              suffix="×"
              onChange={(v) => updateActive({ cardHeightPct: v })}
            />
          </div>

          {/* Center text */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Center text
            </label>
            <textarea
              rows={4}
              value={activeSlide.centerText}
              onChange={(e) => updateActive({ centerText: e.target.value })}
              placeholder="Your statement here"
              style={{
                ...inputStyle,
                resize: "vertical",
                lineHeight: 1.35,
              }}
            />
          </div>

          {/* Bottom row */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]">
              Bottom row
            </label>
            <FieldRow label="Left label">
              <input
                type="text"
                value={activeSlide.bottomLeft}
                onChange={(e) => updateActive({ bottomLeft: e.target.value })}
                style={inputStyle}
              />
            </FieldRow>
            <FieldRow label="Right label">
              <input
                type="text"
                value={activeSlide.bottomRight}
                onChange={(e) => updateActive({ bottomRight: e.target.value })}
                style={inputStyle}
              />
            </FieldRow>
            <FieldRow label="Center icon">
              <select
                value={activeSlide.bottomIconKey}
                onChange={(e) =>
                  updateActive({ bottomIconKey: e.target.value })
                }
                style={inputStyle}
              >
                {BOTTOM_ICON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        </aside>

        {/* CENTER — preview, expanded to fill the available stage. */}
        <main
          ref={stageRef}
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 28 }}
        >
          {previewScale > 0 ? (
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
                <FrostedSurface
                  slide={activeSlide}
                  width={dims.width}
                  height={dims.height}
                />
              </div>
            </div>
          ) : null}

          {/* Offscreen export source @ full resolution */}
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
              <FrostedSurface
                slide={activeSlide}
                width={dims.width}
                height={dims.height}
              />
            </div>
          </div>
        </main>

        {/* RIGHT — export + slides */}
        <aside
          className="flex flex-col"
          style={{
            width: 260,
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
              ← → switch · ⌘D duplicate · ⌫ delete · N new · ⌘V paste image
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
                  s.centerText.split("\n").find((l) => l.trim()) || "(empty)";
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
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
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

/* ---------------------- Small helpers ---------------------- */

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
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: BRAND.colors.ink }}
      />
    </div>
  );
};

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

const BgImageRow: React.FC<{
  value: string;
  onSet: (src: string) => void;
  onClear: () => void;
}> = ({ value, onSet, onClear }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");
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
              Image added
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
            Drop · click · or paste (⌘V)
          </p>
        )}
      </div>
      <input
        type="url"
        placeholder="…or paste image URL"
        value={urlInput}
        onChange={(e) => setUrlInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && urlInput.trim()) {
            onSet(urlInput.trim());
            setUrlInput("");
          }
        }}
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: 6,
          border: `1px solid ${BRAND.colors.grey200}`,
          fontSize: 12,
          color: BRAND.colors.ink,
          backgroundColor: "#FFFFFF",
          outline: "none",
          fontFamily: "var(--font-ui), Inter, sans-serif",
        }}
      />
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

export { FrostedSurface };
