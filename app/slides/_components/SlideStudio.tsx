"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import {
  SLIDE_LAYOUTS,
  DEFAULT_LAYOUT_ID,
  getLayout,
  type Field,
  type SlideTypography,
  type SlideValues,
} from "@/lib/slide-layouts";
import {
  BadgeShell,
  ORIENTATIONS,
  DEFAULT_ORIENTATION,
  type BackgroundTone,
  type BadgeShellHandle,
  type Orientation,
} from "@/components/slides/BadgeShell";
import { Header } from "../../_components/Header";

const PREVIEW_WIDTH = 380;
const STORAGE_KEY = "zinolt:slides:v1";
const ORIENTATION_KEY = "zinolt:slides:orientation:v1";

type Slide = {
  id: string;
  layoutId: string;
  values: SlideValues;
  backgroundTone: BackgroundTone;
  cardTone: CardTone;
  /** Hex (#RRGGBB) override for the card body. When set, supersedes the
   *  preset tone's cardColor. Ink (text) color is auto-derived from this. */
  customCardColor?: string;
  /** Per-slide typography overrides for the layout. */
  typography?: SlideTypography;
};

type CardTone = "paper" | "bone" | "ink";

const CARD_TONES: Record<
  CardTone,
  { label: string; cardColor: string; cardInk: string; strap: string }
> = {
  paper: { label: "Paper", cardColor: "#FAFAFA", cardInk: "#0A0A0A", strap: "#0A0A0A" },
  bone: { label: "Bone", cardColor: "#F3F1EC", cardInk: "#1A1715", strap: "#1A1612" },
  ink: { label: "Ink", cardColor: "#101013", cardInk: "#F2F2F2", strap: "#0A0A0A" },
};

/**
 * YIQ perceived-brightness contrast picker. Light cards → near-black ink,
 * dark cards → near-white ink. Threshold of 140 keeps mid-tone surfaces
 * (e.g. mustard, terracotta) reading as dark text since text legibility
 * skews stricter than pure 50% luminance.
 */
const INK_DARK = "#0A0A0A";
const INK_LIGHT = "#F2F2F2";
const readableInkFor = (hex: string): string => {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return INK_DARK;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return INK_DARK;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? INK_DARK : INK_LIGHT;
};

const TONE_LABELS: Record<BackgroundTone, string> = {
  neutral: "Neutral",
  warm: "Warm",
  cool: "Cool",
};

const newSlideId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const makeSlide = (
  layoutId: string = DEFAULT_LAYOUT_ID,
  overrides: Partial<Slide> = {},
): Slide => ({
  id: newSlideId(),
  layoutId,
  values: {},
  backgroundTone: "neutral",
  cardTone: "paper",
  ...overrides,
});

const isPersistableValue = (v: string) =>
  typeof v === "string" && !v.startsWith("blob:");

const sanitizeForStorage = (slides: Slide[]): Slide[] =>
  slides.map((s) => ({
    ...s,
    values: Object.fromEntries(
      Object.entries(s.values).filter(([, v]) => isPersistableValue(v)),
    ),
  }));

const loadSlides = (): Slide[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Slide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((s) => ({
      id: s.id ?? newSlideId(),
      layoutId: s.layoutId ?? DEFAULT_LAYOUT_ID,
      values: s.values ?? {},
      backgroundTone: s.backgroundTone ?? "neutral",
      // Map any unknown card tone (e.g. legacy "ink" from prior sessions)
      // back to paper so removed tones don't blow up the renderer.
      cardTone:
        s.cardTone && s.cardTone in CARD_TONES
          ? (s.cardTone as CardTone)
          : "paper",
    }));
  } catch {
    return null;
  }
};

export const SlideStudio: React.FC = () => {
  const [slides, setSlides] = useState<Slide[]>(() => [makeSlide()]);
  const [activeId, setActiveId] = useState<string>(() => slides[0]?.id ?? "");
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [exportError, setExportError] = useState("");

  const dims = ORIENTATIONS[orientation];
  const previewWidth = PREVIEW_WIDTH;
  const previewHeight = Math.round((PREVIEW_WIDTH * dims.height) / dims.width);

  // Hydrate orientation from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ORIENTATION_KEY);
      if (raw && raw in ORIENTATIONS) {
        setOrientation(raw as Orientation);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist orientation choice.
  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {
      // ignore
    }
  }, [orientation]);

  const badgeRef = useRef<BadgeShellHandle>(null);

  // Hydrate from localStorage on mount (client only).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = loadSlides();
    if (saved && saved.length > 0) {
      setSlides(saved);
      setActiveId(saved[0].id);
    }
  }, []);

  // Persist slides whenever they change (debounced via requestIdleCallback).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(sanitizeForStorage(slides)),
        );
      } catch {
        // quota or serialisation failure — non-fatal
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [slides]);

  const activeSlide = slides.find((s) => s.id === activeId) ?? slides[0];
  const activeIndex = Math.max(
    0,
    slides.findIndex((s) => s.id === activeSlide.id),
  );
  const layout = getLayout(activeSlide.layoutId);
  const values = activeSlide.values;
  const cardTone = CARD_TONES[activeSlide.cardTone];
  // Effective surface colour: picker override beats the tone preset. Ink
  // colour adapts to it automatically so the typography always contrasts.
  const effectiveCardColor =
    activeSlide.customCardColor && /^#[0-9a-fA-F]{6}$/.test(activeSlide.customCardColor)
      ? activeSlide.customCardColor
      : cardTone.cardColor;
  const effectiveCardInk = readableInkFor(effectiveCardColor);

  const updateSlide = useCallback(
    (id: string, mut: (s: Slide) => Slide) => {
      setSlides((prev) => prev.map((s) => (s.id === id ? mut(s) : s)));
    },
    [],
  );
  const updateActive = useCallback(
    (mut: (s: Slide) => Slide) => updateSlide(activeId, mut),
    [updateSlide, activeId],
  );

  const setLayoutId = useCallback(
    (id: string) => updateActive((s) => ({ ...s, layoutId: id })),
    [updateActive],
  );
  const setValue = useCallback(
    (key: string, value: string) =>
      updateActive((s) => ({
        ...s,
        values: { ...s.values, [key]: value },
      })),
    [updateActive],
  );
  const setBackgroundTone = useCallback(
    (t: BackgroundTone) =>
      updateActive((s) => ({ ...s, backgroundTone: t })),
    [updateActive],
  );
  const setCardTone = useCallback(
    (t: CardTone) =>
      updateActive((s) => ({ ...s, cardTone: t })),
    [updateActive],
  );
  const setCustomCardColor = useCallback(
    (color: string | undefined) =>
      updateActive((s) => ({ ...s, customCardColor: color })),
    [updateActive],
  );
  const setTypography = useCallback(
    (patch: Partial<SlideTypography>) =>
      updateActive((s) => ({
        ...s,
        typography: { ...(s.typography ?? {}), ...patch },
      })),
    [updateActive],
  );

  // Revoke object URLs we created when the user replaces or unmounts.
  const previousUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return () => {
      for (const url of previousUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      previousUrlsRef.current.clear();
    };
  }, []);

  const onImageFile = useCallback(
    (key: string, file: File) => {
      const url = URL.createObjectURL(file);
      previousUrlsRef.current.add(url);
      updateActive((s) => {
        const old = s.values[key];
        if (old && previousUrlsRef.current.has(old)) {
          URL.revokeObjectURL(old);
          previousUrlsRef.current.delete(old);
        }
        return {
          ...s,
          values: { ...s.values, [key]: url },
        };
      });
    },
    [updateActive],
  );

  const addSlide = useCallback(() => {
    const s = makeSlide(activeSlide?.layoutId ?? DEFAULT_LAYOUT_ID, {
      backgroundTone: activeSlide?.backgroundTone ?? "neutral",
      cardTone: activeSlide?.cardTone ?? "paper",
    });
    setSlides((prev) => [...prev, s]);
    setActiveId(s.id);
  }, [activeSlide]);

  const duplicateSlide = useCallback(
    (id: string) => {
      setSlides((prev) => {
        const src = prev.find((s) => s.id === id);
        if (!src) return prev;
        const copy: Slide = {
          ...src,
          id: newSlideId(),
          values: { ...src.values },
        };
        const idx = prev.findIndex((s) => s.id === id);
        const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
        setActiveId(copy.id);
        return next;
      });
    },
    [],
  );

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

  const reorderSlide = useCallback((fromId: string, toId: string) => {
    setSlides((prev) => {
      const fromIdx = prev.findIndex((s) => s.id === fromId);
      const toIdx = prev.findIndex((s) => s.id === toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const handleDownload = useCallback(async () => {
    const api = badgeRef.current;
    if (!api) return;
    setExportError("");
    setIsExporting(true);
    try {
      // Flush BadgeShell's 80ms texture-rebake debounce so we never export
      // a stale card face when the user types and immediately hits download.
      await new Promise((r) => window.setTimeout(r, 140));
      const dataUrl = await api.exportPng();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `zinolt-slide-${activeIndex + 1}-${layout.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("PNG export failed", err);
      setExportError(
        "Couldn't export this slide. Try Chrome on desktop, or remove a problematic image.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [layout.id, activeIndex]);

  const handleDownloadDeck = useCallback(async () => {
    const api = badgeRef.current;
    if (!api) return;
    setExportError("");
    setIsExportingDeck(true);
    try {
      // Lazy import keeps JSZip out of the initial bundle.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      // Render each slide in turn: flip the active slide and wait for the
      // texture-rebake debounce (80ms) plus a frame before exporting.
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        setActiveId(s.id);
        // Wait long enough for: React re-render + BadgeShell's 80ms texture
        // rebake debounce + paint. 320ms is comfortably above the typical
        // measured worst case (~220ms in dev mode).
        await new Promise<void>((r) => window.setTimeout(r, 320));
        const dataUrl = await api.exportPng();
        const base64 = dataUrl.split(",")[1] ?? "";
        zip.file(`slide-${String(i + 1).padStart(2, "0")}-${s.layoutId}.png`, base64, {
          base64: true,
        });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-deck-${slides.length}-slides.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Deck export failed", err);
      setExportError("Couldn't export the deck. Try again or export a single slide.");
    } finally {
      setIsExportingDeck(false);
    }
  }, [slides]);

  // Keyboard nav — arrow keys + cmd/ctrl+D + backspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField =
        tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable;
      if (inField) return;
      if (e.key === "ArrowRight" || (e.key === "ArrowDown" && !inField)) {
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

  const presenterHref = useMemo(() => `/slides/present`, []);

  const LayoutRender = layout.Render;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <div className="flex items-center gap-(--ds-space-xs)">
            <Button asChild variant="pill-secondary" size="pill">
              <Link href={presenterHref} target="_blank">
                Present
              </Link>
            </Button>
            <Button asChild variant="pill-secondary" size="pill">
              <Link href="/">Back home</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* LEFT — layout picker + tones + form */}
        <aside
          className="flex flex-col gap-6 overflow-y-auto p-4 md:p-6 order-2 md:order-1 w-full md:w-[320px] flex-shrink-0 border-b md:border-b-0 md:border-r"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <div className="flex flex-col gap-2">
            <label
              className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]"
            >
              Layout
            </label>
            <div className="flex flex-col gap-1.5">
              {SLIDE_LAYOUTS.map((l) => {
                const active = l.id === layout.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLayoutId(l.id)}
                    className="text-left transition-colors"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                      color: active ? BRAND.colors.paper : BRAND.colors.ink,
                      border: `1px solid ${
                        active ? BRAND.colors.ink : BRAND.colors.grey200
                      }`,
                      fontFamily: BRAND.fonts.ui.family,
                      fontSize: 14,
                    }}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Style block — per-slide background + card tone */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label
              className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]"
            >
              Style
            </label>

            <div className="flex flex-col gap-1.5">
              <span
                className="font-sans text-[11px]"
                style={{ color: BRAND.colors.grey500 }}
              >
                Background
              </span>
              <div className="flex gap-1.5">
                {(Object.keys(TONE_LABELS) as BackgroundTone[]).map((t) => {
                  const active = activeSlide.backgroundTone === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBackgroundTone(t)}
                      className="flex-1 transition-colors"
                      style={{
                        padding: "8px 6px",
                        borderRadius: 6,
                        backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                        color: active ? BRAND.colors.paper : BRAND.colors.ink,
                        border: `1px solid ${
                          active ? BRAND.colors.ink : BRAND.colors.grey200
                        }`,
                        fontFamily: BRAND.fonts.ui.family,
                        fontSize: 12,
                      }}
                    >
                      {TONE_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                className="font-sans text-[11px]"
                style={{ color: BRAND.colors.grey500 }}
              >
                Card
              </span>
              <div className="flex gap-1.5">
                {(Object.keys(CARD_TONES) as CardTone[]).map((t) => {
                  const active = activeSlide.cardTone === t;
                  const tone = CARD_TONES[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCardTone(t)}
                      className="flex-1 transition-colors"
                      style={{
                        padding: "8px 6px",
                        borderRadius: 6,
                        backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                        color: active ? BRAND.colors.paper : BRAND.colors.ink,
                        border: `1px solid ${
                          active ? BRAND.colors.ink : BRAND.colors.grey200
                        }`,
                        fontFamily: BRAND.fonts.ui.family,
                        fontSize: 12,
                      }}
                    >
                      {tone.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom color picker — overrides the active card tone. Ink
                colour adapts automatically (light card → black text, dark
                card → white text) via YIQ luminance. */}
            <div className="flex flex-col gap-1.5">
              <span
                className="font-sans text-[11px]"
                style={{ color: BRAND.colors.grey500 }}
              >
                Custom color
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={effectiveCardColor}
                  onChange={(e) => setCustomCardColor(e.target.value)}
                  aria-label="Card color"
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
                    letterSpacing: 0,
                  }}
                >
                  {effectiveCardColor.toUpperCase()}
                </code>
                {activeSlide.customCardColor ? (
                  <button
                    type="button"
                    onClick={() => setCustomCardColor(undefined)}
                    aria-label="Reset to tone preset"
                    title="Reset to tone preset"
                    className="ml-auto font-sans"
                    style={{
                      fontSize: 11,
                      color: BRAND.colors.grey500,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Typography controls — overrides the active layout's defaults
              per slide. Stored on `slide.typography` so each slide can have
              its own settings. */}
          <div
            className="flex flex-col gap-3"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label
              className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]"
            >
              Typography
            </label>
            <TypographyControl
              label="Size"
              value={activeSlide.typography?.fontSize ?? 130}
              min={60}
              max={220}
              step={2}
              suffix="px"
              onChange={(v) => setTypography({ fontSize: v })}
            />
            <TypographyControl
              label="Weight"
              value={activeSlide.typography?.fontWeight ?? 400}
              min={300}
              max={900}
              step={100}
              onChange={(v) => setTypography({ fontWeight: v })}
            />
            <TypographyControl
              label="Line height"
              value={activeSlide.typography?.lineHeight ?? 1.4}
              min={1}
              max={2}
              step={0.05}
              onChange={(v) => setTypography({ lineHeight: v })}
            />
            <TypographyControl
              label="Tracking"
              value={activeSlide.typography?.letterSpacing ?? 0}
              min={-0.05}
              max={0.1}
              step={0.005}
              suffix="em"
              onChange={(v) => setTypography({ letterSpacing: v })}
            />
            <button
              type="button"
              onClick={() => setTypography({
                fontSize: undefined,
                fontWeight: undefined,
                lineHeight: undefined,
                letterSpacing: undefined,
              })}
              className="self-start font-sans"
              style={{
                fontSize: 11,
                color: BRAND.colors.grey500,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Reset typography
            </button>
          </div>

          <div
            className="flex flex-col gap-4"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              paddingTop: 24,
            }}
          >
            <label
              className="type-label-sm uppercase tracking-wide text-ds-on-surface-muted text-[11px]"
            >
              Content
            </label>
            {layout.fields.map((field) => (
              <FieldInput
                key={`${activeSlide.id}-${field.key}`}
                field={field}
                value={values[field.key] ?? ""}
                onText={(v) => setValue(field.key, v)}
                onFile={(f) => onImageFile(field.key, f)}
                onClearImage={() => setValue(field.key, "")}
              />
            ))}
          </div>
        </aside>

        {/* CENTER — preview */}
        <main
          className="flex flex-1 items-center justify-center order-1 md:order-2 min-h-[40vh] md:min-h-0"
          style={{ backgroundColor: "#5A5A60", padding: 20 }}
        >
          <div
            style={{
              width: `min(${previewWidth}px, calc(100vw - 56px))`,
              aspectRatio: `${dims.width} / ${dims.height}`,
              maxHeight: "calc(100vh - 200px)",
              position: "relative",
              flexShrink: 0,
              // Three-layer ambient depth — sharp structural grounding +
              // mid soft + ultra-wide diffuse, per the design spec.
              boxShadow:
                "0 2px 4px rgba(0,0,0,0.15), 0 10px 25px rgba(0,0,0,0.25), 0 30px 70px rgba(0,0,0,0.45)",
            }}
          >
            <BadgeShell
              ref={badgeRef}
              backgroundTone={activeSlide.backgroundTone}
              cardColor={effectiveCardColor}
              cardInkColor={effectiveCardInk}
              strapColor={cardTone.strap}
              orientation={orientation}
            >
              <LayoutRender
                values={values}
                typography={activeSlide.typography}
              />
            </BadgeShell>
          </div>
        </main>

        {/* RIGHT — export + slide picker */}
        <aside
          className="flex flex-col order-3 w-full md:w-[280px] flex-shrink-0 border-t md:border-t-0 md:border-l"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
            minHeight: 0,
          }}
        >
          {/* Export block — pinned at the top */}
          <div className="flex flex-col p-(--ds-space-md) pb-(--ds-space-sm)">
            {/* Orientation toggle — drives preview & export dimensions. */}
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
              Output: {dims.width * 4} × {dims.height * 4} PNG · Slide{" "}
              {activeIndex + 1} of {slides.length}
            </p>
            <p className="type-body-sm mt-(--ds-space-xs) text-ds-on-surface-muted text-[11px] leading-snug">
              ← → switch · ⌘D duplicate · ⌫ delete · N new
            </p>
            {exportError ? (
              <p
                role="alert"
                className="type-body-sm mt-(--ds-space-sm) text-ds-on-surface leading-snug"
              >
                {exportError}
              </p>
            ) : null}
          </div>

          {/* Slides list — scrollable column */}
          <div
            className="flex flex-1 flex-col gap-2 overflow-y-auto p-6 pt-4"
            style={{
              borderTop: `1px solid ${BRAND.colors.grey200}`,
              minHeight: 0,
            }}
          >
            <div className="flex items-center justify-between">
              <label
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Slides
              </label>
              <button
                type="button"
                onClick={addSlide}
                aria-label="Add slide"
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  border: `1px solid ${BRAND.colors.grey200}`,
                  backgroundColor: "#FFFFFF",
                  color: BRAND.colors.ink,
                  fontFamily: BRAND.fonts.ui.family,
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
              onReorder={reorderSlide}
              onAdd={addSlide}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};

const TypographyControl: React.FC<{
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
        style={{
          accentColor: BRAND.colors.ink,
        }}
      />
    </div>
  );
};

const SlidePicker: React.FC<{
  slides: Slide[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
}> = ({ slides, activeId, onSelect, onAdd, onRemove, onDuplicate, onReorder }) => {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {slides.map((s, i) => {
        const l = getLayout(s.layoutId);
        const active = s.id === activeId;
        const isDragOver = dragOverId === s.id;
        return (
          <SlideThumb
            key={s.id}
            index={i + 1}
            label={l.label}
            active={active}
            dragOver={isDragOver}
            canRemove={slides.length > 1}
            onSelect={() => onSelect(s.id)}
            onRemove={() => onRemove(s.id)}
            onDuplicate={() => onDuplicate(s.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", s.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverId(s.id);
            }}
            onDragLeave={() => {
              setDragOverId((prev) => (prev === s.id ? null : prev));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/plain");
              setDragOverId(null);
              if (from && from !== s.id) onReorder(from, s.id);
            }}
          />
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        aria-label="Add slide"
        className="flex shrink-0 items-center justify-center transition-colors"
        style={{
          width: "100%",
          height: 56,
          borderRadius: 10,
          border: `1.5px dashed ${BRAND.colors.grey500}`,
          backgroundColor: "transparent",
          color: BRAND.colors.grey500,
          fontFamily: BRAND.fonts.ui.family,
          fontSize: 22,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        + Add slide
      </button>
    </div>
  );
};

const SlideThumb: React.FC<{
  index: number;
  label: string;
  active: boolean;
  dragOver: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}> = ({
  index,
  label,
  active,
  dragOver,
  canRemove,
  onSelect,
  onRemove,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        width: "100%",
      }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-col items-stretch justify-between text-left transition-colors"
        style={{
          width: "100%",
          padding: "12px 12px 14px",
          borderRadius: 10,
          backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
          color: active ? "#FFFFFF" : BRAND.colors.ink,
          border: `${dragOver ? 2 : 1}px solid ${
            dragOver
              ? "#4f46e5"
              : active
                ? BRAND.colors.ink
                : BRAND.colors.grey200
          }`,
          fontFamily: BRAND.fonts.ui.family,
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
          Slide {index}
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
          {label}
        </span>
      </button>

      {/* Hover-revealed action row */}
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
            onDuplicate();
          }}
          aria-label={`Duplicate slide ${index}`}
          title="Duplicate (⌘D)"
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${BRAND.colors.grey200}`,
            backgroundColor: "#FFFFFF",
            color: BRAND.colors.ink,
            fontFamily: BRAND.fonts.ui.family,
            fontSize: 11,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ⧉
        </button>
        {canRemove ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label={`Remove slide ${index}`}
            title="Delete (⌫)"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: `1px solid ${BRAND.colors.grey200}`,
              backgroundColor: "#FFFFFF",
              color: BRAND.colors.ink,
              fontFamily: BRAND.fonts.ui.family,
              fontSize: 13,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
};

const FieldInput: React.FC<{
  field: Field;
  value: string;
  onText: (v: string) => void;
  onFile: (f: File) => void;
  onClearImage: () => void;
}> = ({ field, value, onText, onFile, onClearImage }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  if (field.kind === "image") {
    const hasImage = Boolean(value);
    return (
      <div className="flex flex-col gap-1.5">
        <span
          className="font-sans text-xs"
          style={{ color: BRAND.colors.ink }}
        >
          {field.label}
        </span>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && f.type.startsWith("image/")) onFile(f);
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
              if (f) onFile(f);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
          {hasImage ? (
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
                  onClearImage();
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
              {field.placeholder ?? "Drop or click"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Text input
  if (field.multiline) {
    return (
      <div className="flex flex-col gap-1.5">
        <label
          className="font-sans text-xs"
          style={{ color: BRAND.colors.ink }}
        >
          {field.label}
        </label>
        <textarea
          rows={4}
          value={value}
          onChange={(e) => onText(e.target.value)}
          placeholder={field.placeholder}
          className="w-full rounded-md border px-3 py-2 font-sans text-sm"
          style={{
            borderColor: BRAND.colors.grey200,
            color: BRAND.colors.ink,
            backgroundColor: "#FFFFFF",
            outline: "none",
            resize: "vertical",
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="font-sans text-xs"
        style={{ color: BRAND.colors.ink }}
      >
        {field.label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onText(e.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-md border px-3 py-2 font-sans text-sm"
        style={{
          borderColor: BRAND.colors.grey200,
          color: BRAND.colors.ink,
          backgroundColor: "#FFFFFF",
          outline: "none",
        }}
      />
    </div>
  );
};
