"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toCanvas } from "html-to-image";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import { ContentSurface, type ContentSlideData } from "./ContentSurface";
import { CoverSurface, type CoverSlideData } from "./CoverSurface";

/* -------------------------------------------------------------------------
 * Wire Carousel — 1080x1350 (4:5) carousel with a news-card cover slide
 * followed by reusable frosted-glass content slides.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = "zinolt:wire-carousel:slides:v1";
const PREFILL_SEEN_KEY = "zinolt:wire-carousel:prefill-seen:v1";
const OUT_W = 1080;
const OUT_H = 1350;
const DEFAULT_TAG_COLOR = "#E11D2A";

type CoverSlide = { id: string; kind: "cover" } & CoverSlideData;
type ContentSlide = { id: string; kind: "content" } & ContentSlideData;
type CarouselSlide = CoverSlide | ContentSlide;

const DEFAULT_CONTENT: ContentSlideData = {
  bgType: "color",
  bgImageSrc: "",
  bgColorHex: "#1E2733",
  glassOpacity: 0.15,
  cardWidthPct: 0.88,
  cardHeightPct: 0.78,
  centerText: "Add your\ntake here",
  textScale: 1,
  bottomLeft: "Vernavle · Wire",
  bottomRight: "Read more",
  bottomIconKey: "chevronRight",
};

const DEFAULT_COVER: CoverSlideData = {
  bgImageSrc: "",
  tagText: "Breaking",
  tagColor: DEFAULT_TAG_COLOR,
  headline: "Your headline\nAnchors here",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const makeCover = (overrides: Partial<CoverSlideData> = {}): CoverSlide => ({
  id: newId(),
  kind: "cover",
  ...DEFAULT_COVER,
  ...overrides,
});

const makeContent = (overrides: Partial<ContentSlideData> = {}): ContentSlide => ({
  id: newId(),
  kind: "content",
  ...DEFAULT_CONTENT,
  ...overrides,
});

const initialSeed = (): CarouselSlide[] => [makeCover(), makeContent()];

const loadSlides = (): CarouselSlide[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CarouselSlide[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Ensure first is a cover; if not, prepend one.
    const first = parsed[0];
    if (first?.kind !== "cover") {
      return [makeCover(), ...parsed.map(normalizeSlide)];
    }
    return parsed.map(normalizeSlide);
  } catch {
    return null;
  }
};

function normalizeSlide(s: CarouselSlide): CarouselSlide {
  if (s.kind === "cover") return { ...DEFAULT_COVER, ...s, id: s.id ?? newId() };
  return { ...DEFAULT_CONTENT, ...s, id: s.id ?? newId() };
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "slide";

// ── Prefill from wire item ─────────────────────────────────────────────────
type Prefill = {
  title: string;
  category: string;
  snippet: string;
  url: string;
};

function readPrefill(sp: URLSearchParams): Prefill | null {
  const title = sp.get("title")?.trim() || "";
  if (!title) return null;
  return {
    title,
    category: sp.get("category")?.trim() || "",
    snippet: sp.get("snippet")?.trim() || "",
    url: sp.get("url")?.trim() || "",
  };
}

function prefillToSlides(p: Prefill): CarouselSlide[] {
  return [
    makeCover({
      headline: p.title,
      tagText: p.category ? p.category.toUpperCase() : DEFAULT_COVER.tagText,
    }),
    makeContent({
      centerText: p.snippet || DEFAULT_CONTENT.centerText,
    }),
  ];
}

function prefillKey(p: Prefill): string {
  return `${p.url}|${p.title}`;
}

// ── Studio ─────────────────────────────────────────────────────────────────
export const WireCarouselStudio: React.FC = () => {
  const sp = useSearchParams();

  const [slides, setSlides] = useState<CarouselSlide[]>(initialSeed);
  const [activeId, setActiveId] = useState<string>(() => slides[0].id);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [exportError, setExportError] = useState("");
  const [prefillBanner, setPrefillBanner] = useState<Prefill | null>(null);
  const [ogFetching, setOgFetching] = useState(false);

  const exportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });

  const hydratedRef = useRef(false);

  // Fetch og:image and apply to the given cover slide id (only if slot empty).
  const fetchOg = useCallback(async (url: string, coverId: string) => {
    setOgFetching(true);
    try {
      const r = await fetch(`/api/og-image?url=${encodeURIComponent(url)}`);
      if (!r.ok) return;
      const j = (await r.json()) as { image: string | null };
      if (!j.image) return;
      setSlides((prev) =>
        prev.map((s) =>
          s.id === coverId && s.kind === "cover" && !s.bgImageSrc
            ? { ...s, bgImageSrc: j.image! }
            : s,
        ),
      );
    } catch {
      // silent
    } finally {
      setOgFetching(false);
    }
  }, []);

  // Hydrate + prefill logic on mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const params = new URLSearchParams(sp?.toString() ?? "");
    const prefill = readPrefill(params);
    const saved = loadSlides();

    if (saved) {
      // Have saved slides — never clobber. Show banner if new prefill.
      setSlides(saved);
      setActiveId(saved[0].id);
      if (prefill) {
        const seenKey = window.localStorage.getItem(PREFILL_SEEN_KEY);
        if (seenKey !== prefillKey(prefill)) {
          setPrefillBanner(prefill);
        }
      }
    } else if (prefill) {
      // Empty studio + prefill present → silent seed.
      const seeded = prefillToSlides(prefill);
      setSlides(seeded);
      setActiveId(seeded[0].id);
      window.localStorage.setItem(PREFILL_SEEN_KEY, prefillKey(prefill));
      // Try og:image in background.
      if (prefill.url) void fetchOg(prefill.url, seeded[0].id);
    }
    // else: keep initialSeed default.
  }, [sp, fetchOg]);

  // Persist slides.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const h = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slides));
      } catch {}
    }, 200);
    return () => window.clearTimeout(h);
  }, [slides]);

  // Measure stage.
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

  const previewScale =
    stageBox.w === 0 || stageBox.h === 0
      ? 0.3
      : Math.min(stageBox.w / OUT_W, stageBox.h / OUT_H);

  const activeSlide = slides.find((s) => s.id === activeId) ?? slides[0];
  const activeIndex = Math.max(
    0,
    slides.findIndex((s) => s.id === activeSlide.id),
  );

  const updateCover = useCallback(
    (patch: Partial<CoverSlideData>) => {
      setSlides((prev) =>
        prev.map((s) =>
          s.id === activeId && s.kind === "cover" ? { ...s, ...patch } : s,
        ),
      );
    },
    [activeId],
  );

  const updateContent = useCallback(
    (patch: Partial<ContentSlideData>) => {
      setSlides((prev) =>
        prev.map((s) =>
          s.id === activeId && s.kind === "content" ? { ...s, ...patch } : s,
        ),
      );
    },
    [activeId],
  );

  const addContent = useCallback(() => {
    const s = makeContent();
    setSlides((prev) => [...prev, s]);
    setActiveId(s.id);
  }, []);

  const duplicateSlide = useCallback((id: string) => {
    setSlides((prev) => {
      const src = prev.find((s) => s.id === id);
      if (!src || src.kind === "cover") return prev; // never duplicate cover
      const copy: CarouselSlide = { ...src, id: newId() };
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
        const src = prev.find((s) => s.id === id);
        if (!src || src.kind === "cover") return prev; // cover locked
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

  const moveContent = useCallback(
    (id: string, dir: -1 | 1) => {
      setSlides((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx < 0) return prev;
        const target = idx + dir;
        // Cover is locked at index 0 — never let anything move above index 1.
        if (target < 1 || target > prev.length - 1) return prev;
        const next = [...prev];
        [next[idx], next[target]] = [next[target], next[idx]];
        return next;
      });
    },
    [],
  );

  const applyPrefill = useCallback(() => {
    if (!prefillBanner) return;
    const seeded = prefillToSlides(prefillBanner);
    setSlides(seeded);
    setActiveId(seeded[0].id);
    try {
      window.localStorage.setItem(PREFILL_SEEN_KEY, prefillKey(prefillBanner));
    } catch {}
    if (prefillBanner.url) void fetchOg(prefillBanner.url, seeded[0].id);
    setPrefillBanner(null);
  }, [prefillBanner, fetchOg]);

  const dismissPrefill = useCallback(() => {
    if (prefillBanner) {
      try {
        window.localStorage.setItem(
          PREFILL_SEEN_KEY,
          prefillKey(prefillBanner),
        );
      } catch {}
    }
    setPrefillBanner(null);
  }, [prefillBanner]);

  // Paste image → active slide bg.
  useEffect(() => {
    const canPaste =
      activeSlide.kind === "cover" ||
      (activeSlide.kind === "content" && activeSlide.bgType === "image");
    if (!canPaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const r = new FileReader();
          r.onload = () => {
            const src = String(r.result);
            if (activeSlide.kind === "cover") updateCover({ bgImageSrc: src });
            else updateContent({ bgImageSrc: src });
          };
          r.readAsDataURL(file);
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeSlide, updateCover, updateContent]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField =
        t === "input" ||
        t === "textarea" ||
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
        addContent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides, activeId, addContent, duplicateSlide, removeSlide]);

  // ── Exports ─────────────────────────────────────────────────────────────
  const captureActive = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!exportRef.current) throw new Error("Export source not ready");
    return toCanvas(exportRef.current, {
      width: OUT_W,
      height: OUT_H,
      pixelRatio: 1,
      cacheBust: false,
    });
  }, []);

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsExporting(true);
    try {
      await new Promise((r) => window.setTimeout(r, 140));
      const canvas = await captureActive();
      const dataUrl = canvas.toDataURL("image/png");
      const label =
        activeSlide.kind === "cover"
          ? slugify(activeSlide.headline)
          : slugify(activeSlide.centerText);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `wire-carousel-${String(activeIndex + 1).padStart(2, "0")}-${label}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Wire carousel export failed", err);
      setExportError(
        "Couldn't export this slide. Try Chrome on desktop — Safari's backdrop-filter capture is unreliable.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [activeIndex, activeSlide, captureActive]);

  const handleDownloadDeck = useCallback(async () => {
    setExportError("");
    setIsExportingDeck(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const originalId = activeId;
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        setActiveId(s.id);
        await new Promise((r) => window.setTimeout(r, 260));
        if (!exportRef.current) continue;
        const canvas = await toCanvas(exportRef.current, {
          width: OUT_W,
          height: OUT_H,
          pixelRatio: 1,
          cacheBust: false,
        });
        const dataUrl = canvas.toDataURL("image/png");
        const base64 = dataUrl.split(",")[1] ?? "";
        const label =
          s.kind === "cover" ? slugify(s.headline) : slugify(s.centerText);
        zip.file(
          `wire-carousel-${String(i + 1).padStart(2, "0")}-${label}.png`,
          base64,
          { base64: true },
        );
      }
      setActiveId(originalId);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wire-carousel-deck-${slides.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Deck export failed", err);
      setExportError("Couldn't export the deck.");
    } finally {
      setIsExportingDeck(false);
    }
  }, [slides, activeId]);

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

  // Query-derived reference url for the sidebar display.
  const referenceUrl = useMemo(
    () => sp?.get("url")?.trim() || "",
    [sp],
  );

  const renderActive = (w: number, h: number) => {
    if (activeSlide.kind === "cover") {
      return <CoverSurface slide={activeSlide} width={w} height={h} />;
    }
    return <ContentSurface slide={activeSlide} width={w} height={h} />;
  };

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <Button asChild variant="pill-secondary" size="pill">
            <Link href="/">Back home</Link>
          </Button>
        }
      />

      {prefillBanner ? (
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{
            backgroundColor: "#FFF6D0",
            borderBottom: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          <div className="min-w-0 flex-1">
            <div
              className="text-xs uppercase tracking-wider"
              style={{ color: BRAND.colors.grey500 }}
            >
              Prefill available
            </div>
            <div
              className="truncate text-sm font-medium"
              style={{ color: BRAND.colors.ink }}
            >
              {prefillBanner.title}
            </div>
          </div>
          <button
            type="button"
            onClick={applyPrefill}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: BRAND.colors.ink }}
          >
            Load prefill
          </button>
          <button
            type="button"
            onClick={dismissPrefill}
            className="shrink-0 text-xs underline"
            style={{ color: BRAND.colors.grey500 }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* LEFT — editor */}
        <aside
          className="flex flex-col gap-6 overflow-y-auto p-4 md:p-6 order-2 md:order-1 w-full md:w-[320px] flex-shrink-0 border-b md:border-b-0 md:border-r"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          {activeSlide.kind === "cover" ? (
            <CoverEditor
              slide={activeSlide}
              onChange={updateCover}
              inputStyle={inputStyle}
              ogFetching={ogFetching}
            />
          ) : (
            <ContentEditor
              slide={activeSlide}
              onChange={updateContent}
              inputStyle={inputStyle}
            />
          )}

          {referenceUrl ? (
            <div
              className="flex flex-col gap-1"
              style={{
                borderTop: `1px solid ${BRAND.colors.grey200}`,
                paddingTop: 20,
              }}
            >
              <span
                className="text-[11px] uppercase tracking-wider"
                style={{ color: BRAND.colors.grey500 }}
              >
                Source
              </span>
              <a
                href={referenceUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs underline"
                style={{ color: BRAND.colors.ink }}
              >
                {referenceUrl}
              </a>
            </div>
          ) : null}
        </aside>

        {/* CENTER — preview */}
        <main
          ref={stageRef}
          className="flex flex-1 items-center justify-center order-1 md:order-2 min-h-[40vh] md:min-h-0"
          style={{ backgroundColor: "#5A5A60", padding: 20 }}
        >
          {previewScale > 0 ? (
            <div
              style={{
                width: OUT_W * previewScale,
                height: OUT_H * previewScale,
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
                  width: OUT_W,
                  height: OUT_H,
                }}
              >
                {renderActive(OUT_W, OUT_H)}
              </div>
            </div>
          ) : null}

          {/* Offscreen export source @ native resolution */}
          <div
            aria-hidden
            style={{
              position: "fixed",
              top: -99999,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <div ref={exportRef}>{renderActive(OUT_W, OUT_H)}</div>
          </div>
        </main>

        {/* RIGHT — export + slides */}
        <aside
          className="flex flex-col order-3 w-full md:w-[260px] flex-shrink-0 border-t md:border-t-0 md:border-l"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
            minHeight: 0,
          }}
        >
          <div className="flex flex-col p-(--ds-space-md) pb-(--ds-space-sm)">
            <div className="mb-(--ds-space-sm) text-[11px] uppercase tracking-wider" style={{ color: BRAND.colors.grey500 }}>
              Output · 1080 × 1350 (4:5)
            </div>
            <Button
              onClick={handleDownload}
              disabled={isExporting || isExportingDeck}
              variant="pill-primary"
              size="pill"
              className="w-full"
            >
              {isExporting ? "Exporting…" : "Download PNG"}
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
              Slide {activeIndex + 1} of {slides.length}
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
              <label className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.colors.grey500 }}>
                Slides
              </label>
              <button
                type="button"
                onClick={addContent}
                aria-label="Add content slide"
                className="flex items-center justify-center transition-colors"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  border: `1px solid ${BRAND.colors.grey200}`,
                  backgroundColor: "#FFFFFF",
                  color: BRAND.colors.ink,
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
                const isCover = s.kind === "cover";
                const label = isCover
                  ? s.headline.split("\n").find((l) => l.trim()) || "(cover)"
                  : s.centerText.split("\n").find((l) => l.trim()) || "(empty)";
                return (
                  <div key={s.id} style={{ position: "relative", width: "100%" }}>
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
                        {isCover ? "Cover" : `Slide ${i + 1}`}
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
                        {label}
                      </span>
                    </button>
                    {!isCover ? (
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
                            moveContent(s.id, -1);
                          }}
                          aria-label="Move up"
                          title="Move up"
                          style={ICON_BTN_STYLE}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveContent(s.id, +1);
                          }}
                          aria-label="Move down"
                          title="Move down"
                          style={ICON_BTN_STYLE}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateSlide(s.id);
                          }}
                          aria-label="Duplicate"
                          title="Duplicate (⌘D)"
                          style={ICON_BTN_STYLE}
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSlide(s.id);
                          }}
                          aria-label="Remove"
                          title="Delete (⌫)"
                          style={ICON_BTN_STYLE}
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
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

// ── Editors ────────────────────────────────────────────────────────────────
const CoverEditor: React.FC<{
  slide: CoverSlide;
  onChange: (patch: Partial<CoverSlideData>) => void;
  inputStyle: React.CSSProperties;
  ogFetching: boolean;
}> = ({ slide, onChange, inputStyle, ogFetching }) => {
  return (
    <>
      <div className="flex flex-col gap-3">
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Cover background
        </label>
        <BgImageRow
          value={slide.bgImageSrc}
          onSet={(src) => onChange({ bgImageSrc: src })}
          onClear={() => onChange({ bgImageSrc: "" })}
        />
        {ogFetching ? (
          <p className="text-[11px]" style={{ color: BRAND.colors.grey500 }}>
            Fetching article image…
          </p>
        ) : null}
      </div>

      <div
        className="flex flex-col gap-3"
        style={{
          borderTop: `1px solid ${BRAND.colors.grey200}`,
          paddingTop: 20,
        }}
      >
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Tag
        </label>
        <input
          type="text"
          value={slide.tagText}
          onChange={(e) => onChange({ tagText: e.target.value })}
          placeholder="BREAKING"
          style={inputStyle}
        />
        <div className="flex items-center gap-2">
          <span
            className="text-[11px]"
            style={{ color: BRAND.colors.grey500, width: 40 }}
          >
            Color
          </span>
          <input
            type="color"
            value={slide.tagColor}
            onChange={(e) => onChange({ tagColor: e.target.value })}
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
            style={{
              fontSize: 11,
              color: BRAND.colors.ink,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {slide.tagColor.toUpperCase()}
          </code>
        </div>
      </div>

      <div
        className="flex flex-col gap-3"
        style={{
          borderTop: `1px solid ${BRAND.colors.grey200}`,
          paddingTop: 20,
        }}
      >
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Headline
        </label>
        <textarea
          rows={5}
          value={slide.headline}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Line one\nLine two"
          style={{
            ...inputStyle,
            resize: "vertical",
            lineHeight: 1.35,
          }}
        />
      </div>
    </>
  );
};

const ContentEditor: React.FC<{
  slide: ContentSlide;
  onChange: (patch: Partial<ContentSlideData>) => void;
  inputStyle: React.CSSProperties;
}> = ({ slide, onChange, inputStyle }) => {
  return (
    <>
      <div className="flex flex-col gap-3">
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Background
        </label>
        <div className="flex gap-1.5">
          {(["image", "color"] as const).map((t) => {
            const active = slide.bgType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ bgType: t })}
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
        {slide.bgType === "image" ? (
          <BgImageRow
            value={slide.bgImageSrc}
            onSet={(src) => onChange({ bgImageSrc: src })}
            onClear={() => onChange({ bgImageSrc: "" })}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span
              className="text-[11px]"
              style={{ color: BRAND.colors.grey500, width: 40 }}
            >
              Color
            </span>
            <input
              type="color"
              value={slide.bgColorHex}
              onChange={(e) => onChange({ bgColorHex: e.target.value })}
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
              style={{
                fontSize: 11,
                color: BRAND.colors.ink,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {slide.bgColorHex.toUpperCase()}
            </code>
          </div>
        )}
      </div>

      <div
        className="flex flex-col gap-3"
        style={{
          borderTop: `1px solid ${BRAND.colors.grey200}`,
          paddingTop: 20,
        }}
      >
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Glass
        </label>
        <NumberSlider
          label="Opacity"
          value={slide.glassOpacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ glassOpacity: v })}
        />
        <NumberSlider
          label="Width"
          value={slide.cardWidthPct}
          min={0.3}
          max={1}
          step={0.01}
          suffix="×"
          onChange={(v) => onChange({ cardWidthPct: v })}
        />
        <NumberSlider
          label="Height"
          value={slide.cardHeightPct}
          min={0.3}
          max={1}
          step={0.01}
          suffix="×"
          onChange={(v) => onChange({ cardHeightPct: v })}
        />
      </div>

      <div
        className="flex flex-col gap-3"
        style={{
          borderTop: `1px solid ${BRAND.colors.grey200}`,
          paddingTop: 20,
        }}
      >
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Center text
        </label>
        <textarea
          rows={4}
          value={slide.centerText}
          onChange={(e) => onChange({ centerText: e.target.value })}
          placeholder="Your text"
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.35 }}
        />
        <NumberSlider
          label="Size"
          value={slide.textScale ?? 1}
          min={0.5}
          max={2}
          step={0.05}
          suffix="×"
          onChange={(v) => onChange({ textScale: v })}
        />
      </div>

      <div
        className="flex flex-col gap-3"
        style={{
          borderTop: `1px solid ${BRAND.colors.grey200}`,
          paddingTop: 20,
        }}
      >
        <label
          className="text-[11px] uppercase tracking-wider"
          style={{ color: BRAND.colors.grey500 }}
        >
          Bottom row
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: BRAND.colors.grey500 }}>
            Left label
          </span>
          <input
            type="text"
            value={slide.bottomLeft}
            onChange={(e) => onChange({ bottomLeft: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: BRAND.colors.grey500 }}>
            Right label
          </span>
          <input
            type="text"
            value={slide.bottomRight}
            onChange={(e) => onChange({ bottomRight: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>
    </>
  );
};

// ── Small helpers ──────────────────────────────────────────────────────────
const NumberSlider: React.FC<{
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
        <span style={{ fontSize: 11, color: BRAND.colors.grey500 }}>{label}</span>
        <code
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
              className="text-xs"
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
              className="text-[11px] underline-offset-2 hover:underline"
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
          <p className="text-xs" style={{ color: BRAND.colors.grey500 }}>
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
  fontSize: 12,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};
