"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import { stripVideoMetadata } from "@/lib/strip-video-metadata";
import {
  ConceptReelComposition,
  conceptReelDefaultProps,
  computeConceptReelDurationFrames,
  CR_FPS,
  CR_EXPORT_FPS_FAST,
  CR_EXPORT_FPS_FULL,
  CR_WIDTH,
  CR_HEIGHT,
  type ConceptReelProps,
  type ConceptReelWord,
  type ConceptReelMode,
} from "@/remotion/concept-reel/ConceptReelComposition";
import { CONCEPTS } from "@/lib/explainer/concepts";

const PLAYER_WIDTH = 380;
const PLAYER_HEIGHT = Math.round((PLAYER_WIDTH * CR_HEIGHT) / CR_WIDTH);

const VOICES: { id: string; label: string }[] = [
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew — multilingual (brand)" },
  { id: "en-US-BrianMultilingualNeural", label: "Brian — multilingual" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava — multilingual" },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma — multilingual" },
  { id: "en-US-EricNeural", label: "Eric — neural" },
  { id: "en-US-ChristopherNeural", label: "Christopher — neural" },
  { id: "en-US-GuyNeural", label: "Guy — neural" },
  { id: "en-US-JennyNeural", label: "Jenny — neural" },
  { id: "en-US-AriaNeural", label: "Aria — neural" },
  { id: "en-GB-RyanNeural", label: "Ryan — neural (UK)" },
];
const DEFAULT_VOICE = VOICES[0].id;

const DIAGRAM_OPTIONS: { id: string; label: string }[] = [
  { id: "", label: "— pick a concept —" },
  ...CONCEPTS.map((c) => ({ id: c.id, label: c.label })),
];

type NarrationState = {
  audioSrc: string;
  words: ConceptReelWord[];
  durationSec: number;
  key: string;
} | null;

export const ConceptReelStudio: React.FC = () => {
  const [text, setText] = useState(conceptReelDefaultProps.text);
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [mode, setMode] = useState<ConceptReelMode>("text");
  const [diagramId, setDiagramId] = useState<string>("");

  const [narration, setNarration] = useState<NarrationState>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportFullFps, setExportFullFps] = useState(false);

  const [playerDims, setPlayerDims] = useState({
    w: PLAYER_WIDTH,
    h: PLAYER_HEIGHT,
  });
  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) {
        const w = Math.min(PLAYER_WIDTH, window.innerWidth - 32);
        setPlayerDims({ w, h: Math.round((w * CR_HEIGHT) / CR_WIDTH) });
      } else {
        setPlayerDims({ w: PLAYER_WIDTH, h: PLAYER_HEIGHT });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: CR_WIDTH,
      height: CR_HEIGHT,
    })
      .then((r) => {
        if (!cancelled) setCanExport(r.canRender);
      })
      .catch(() => {
        if (!cancelled) setCanExport(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Client-side narration cache (keyed by text+voice hash).
  const cacheRef = useRef<Map<string, NarrationState>>(new Map());
  const cacheKey = useMemo(() => `${voice}::${text.trim()}`, [voice, text]);

  const handleGenerate = useCallback(async () => {
    setGenError("");
    const key = cacheKey;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setNarration(cached);
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/concept-reel/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `narrate_${res.status}`);
      }
      const data = (await res.json()) as {
        audio: string;
        words: ConceptReelWord[];
        durationSec: number;
      };
      if (!data.words?.length) {
        throw new Error("no_word_boundaries");
      }
      const state: NarrationState = {
        audioSrc: data.audio,
        words: data.words,
        durationSec: data.durationSec,
        key,
      };
      cacheRef.current.set(key, state);
      setNarration(state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [cacheKey, text, voice]);

  // Auto-regenerate when the voice changes (after the first user-triggered
  // generation). Text edits stay manual — otherwise every keystroke would
  // hammer the TTS endpoint.
  const hasGeneratedOnce = useRef(false);
  useEffect(() => {
    if (!hasGeneratedOnce.current) return;
    if (!text.trim()) return;
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);
  useEffect(() => {
    if (narration) hasGeneratedOnce.current = true;
  }, [narration]);

  const currentProps: ConceptReelProps = {
    text: text.trim() || conceptReelDefaultProps.text,
    words: narration?.words ?? [],
    audioSrc: narration?.audioSrc ?? "",
    mode,
    diagramId,
  };

  const durationFrames = computeConceptReelDurationFrames(
    currentProps.words,
    CR_FPS,
  );

  const handleDownload = useCallback(async () => {
    if (!narration) {
      setExportError("Generate narration first.");
      return;
    }
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const exportFps = exportFullFps ? CR_EXPORT_FPS_FULL : CR_EXPORT_FPS_FAST;
      const exportFrames = computeConceptReelDurationFrames(
        currentProps.words,
        exportFps,
      );
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "ConceptReel",
          component: ConceptReelComposition,
          durationInFrames: exportFrames,
          fps: exportFps,
          width: CR_WIDTH,
          height: CR_HEIGHT,
          defaultProps: conceptReelDefaultProps,
          calculateMetadata: () => ({
            width: CR_WIDTH,
            height: CR_HEIGHT,
            durationInFrames: exportFrames,
            fps: exportFps,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: currentProps as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        // 6 Mbps is plenty for 1080p text + chart video — halves file size
        // (faster to write on mobile) with no visible quality loss.
        videoBitrate: 6_000_000,
        audioCodec: "aac",
        hardwareAcceleration: "prefer-hardware",
        keyframeIntervalInSeconds: 2,
        delayRenderTimeoutInMilliseconds: 90_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await stripVideoMetadata(await getBlob());

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "concept-reel.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object")
          ? msg
          : "Export failed. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [narration, currentProps, exportFullFps]);

  const narrationReady = Boolean(narration);
  const narrationStale = narration != null && narration.key !== cacheKey;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      <div className="flex flex-col md:flex-1 md:min-h-0 md:flex-row">
        {/* LEFT — inputs. Mobile: flows in document scroll. Desktop: fixed column with internal scroll. */}
        <aside
          className="flex flex-col gap-6 p-6 border-b md:overflow-y-auto md:w-[320px] md:border-b-0 md:border-r"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          {/* Concept text */}
          <div className="flex flex-col gap-3">
            <label
              htmlFor="cr-text"
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Concept excerpt
            </label>
            <p
              className="font-sans text-[11px] leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              First spoken line is the hook — no dead intro card. Blank line
              between paragraphs → each becomes its own scene.
            </p>
            <textarea
              id="cr-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Compound interest is when your money makes money…"
              className="w-full resize-none rounded-md border px-3 py-2 font-sans text-sm leading-relaxed"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: "#FFFFFF",
                outline: "none",
              }}
            />
          </div>

          {/* Mode */}
          <div className="flex flex-col gap-3">
            <span
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Mode
            </span>
            <div className="flex gap-2">
              {(["text", "diagram"] as ConceptReelMode[]).map((m) => {
                const active = mode === m;
                const label = m === "text" ? "Text" : "Diagram";
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className="flex-1 rounded-md border px-3 py-2 font-sans text-sm"
                    style={{
                      borderColor: active
                        ? BRAND.colors.ink
                        : BRAND.colors.grey200,
                      backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                      color: active ? BRAND.colors.paper : BRAND.colors.ink,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {mode === "diagram" && (
              <div className="flex flex-col gap-2">
                <span
                  className="font-sans text-[11px]"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Diagram script (stub — engine coming)
                </span>
                <select
                  value={diagramId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDiagramId(id);
                    const concept = CONCEPTS.find((c) => c.id === id);
                    if (concept) setText(concept.narration);
                  }}
                  className="rounded-md border px-3 py-2 font-sans text-sm"
                  style={{
                    borderColor: BRAND.colors.grey200,
                    color: BRAND.colors.ink,
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  {DIAGRAM_OPTIONS.map((o) => (
                    <option key={o.id || "none"} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Voice */}
          <div className="flex flex-col gap-3">
            <label
              htmlFor="cr-voice"
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Voice
            </label>
            <select
              id="cr-voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="rounded-md border px-3 py-2 font-sans text-sm"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: "#FFFFFF",
              }}
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {/* Generate */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
              className="w-full font-sans"
              variant={narrationStale || !narrationReady ? "default" : "outline"}
            >
              {isGenerating
                ? "Generating narration…"
                : narrationReady && !narrationStale
                ? "Regenerate narration"
                : "Generate narration"}
            </Button>
            {narrationReady && (
              <p
                className="font-sans text-[11px]"
                style={{ color: BRAND.colors.grey500 }}
              >
                {narration?.words.length} words · {narration?.durationSec.toFixed(1)}s
                {narrationStale ? " · stale (text or voice changed)" : ""}
              </p>
            )}
            {genError && (
              <p
                role="alert"
                className="font-sans text-xs"
                style={{ color: BRAND.colors.ink }}
              >
                {genError}
              </p>
            )}
          </div>
        </aside>

        {/* CENTER — player */}
        <main
          className="flex flex-1 items-center justify-center p-4 md:p-12"
          style={{ backgroundColor: "#5A5A60" }}
        >
          <Player
            component={ConceptReelComposition}
            compositionWidth={CR_WIDTH}
            compositionHeight={CR_HEIGHT}
            durationInFrames={durationFrames}
            fps={CR_FPS}
            controls
            loop
            inputProps={currentProps}
            style={{ width: playerDims.w, height: playerDims.h }}
          />
        </main>

        {/* RIGHT — download */}
        <aside
          className="flex flex-col gap-3 p-6 border-t md:border-t-0 md:border-l md:w-[260px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <Button
            onClick={handleDownload}
            disabled={isRendering || canExport === false || !narrationReady}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>

          {/* Speed / quality toggle. Fast = 30fps (~½ render time). */}
          <label
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 font-sans text-xs cursor-pointer"
            style={{
              borderColor: BRAND.colors.grey200,
              color: BRAND.colors.ink,
            }}
          >
            <span className="flex flex-col leading-tight">
              <span style={{ fontWeight: 600 }}>Full 60fps export</span>
              <span style={{ color: BRAND.colors.grey500 }}>
                ~2× slower to render
              </span>
            </span>
            <input
              type="checkbox"
              checked={exportFullFps}
              onChange={(e) => setExportFullFps(e.target.checked)}
              disabled={isRendering}
            />
          </label>

          {!narrationReady && (
            <p
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Generate narration before exporting.
            </p>
          )}

          {canExport === false && (
            <p
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Exporting needs Chrome or Edge on desktop.
            </p>
          )}

          {exportError && (
            <p
              role="alert"
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {exportError}
            </p>
          )}

          <p
            className="font-sans text-xs leading-snug"
            style={{ color: BRAND.colors.grey500 }}
          >
            1080×1920 · 60fps · H.264 + AAC. Narration length drives total length +
            {" "}
            2s tail.
          </p>
        </aside>
      </div>
    </div>
  );
};
