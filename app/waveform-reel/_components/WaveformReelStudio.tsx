"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { upload as blobUpload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import { stripVideoMetadata } from "@/lib/strip-video-metadata";
import {
  WaveformReelComposition,
  waveformReelDefaultProps,
  wrDefaultStyle,
  computeWaveformDurationFrames,
  WR_FPS,
  WR_WIDTH,
  WR_HEIGHT,
  type WaveformReelProps,
  type WaveformReelStyleConfig,
  type WaveformStyle,
} from "@/remotion/waveform-reel/WaveformReel";
import {
  fetchAndDecode,
  analyzeMono,
  serializeAnalysis,
  type SerializedAnalysis,
} from "@/lib/waveform-reel/analyze";

const PLAYER_WIDTH = 360;
const PLAYER_HEIGHT = Math.round((PLAYER_WIDTH * WR_HEIGHT) / WR_WIDTH);

const STYLE_OPTIONS: { id: WaveformStyle; label: string }[] = [
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "orb", label: "Orb" },
  { id: "orb-ring", label: "Orb Ring" },
];

type Source =
  | { kind: "none" }
  | {
      kind: "ready";
      audioUrl: string;
      source: "upload" | "youtube";
      label: string;
      key: string;
    };

function toMono(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
  const len = audio.length;
  const out = new Float32Array(len);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i];
  }
  const inv = 1 / audio.numberOfChannels;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

export const WaveformReelStudio: React.FC = () => {
  const [inputMode, setInputMode] = useState<"upload" | "url">("upload");
  const [ytUrl, setYtUrl] = useState("");
  const [source, setSource] = useState<Source>({ kind: "none" });
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestError, setIngestError] = useState("");

  const [monoBuf, setMonoBuf] = useState<{
    mono: Float32Array;
    sampleRate: number;
    fullDurationSec: number;
  } | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const [analysis, setAnalysis] = useState<SerializedAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [config, setConfig] = useState<WaveformReelStyleConfig>(wrDefaultStyle);

  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState("");

  const [playerDims, setPlayerDims] = useState({
    w: PLAYER_WIDTH,
    h: PLAYER_HEIGHT,
  });
  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) {
        const w = Math.min(PLAYER_WIDTH, window.innerWidth - 32);
        setPlayerDims({ w, h: Math.round((w * WR_HEIGHT) / WR_WIDTH) });
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
      width: WR_WIDTH,
      height: WR_HEIGHT,
    })
      .then((r) => !cancelled && setCanExport(r.canRender))
      .catch(() => !cancelled && setCanExport(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // ------- Decode -------
  const decode = useCallback(async (audioUrl: string) => {
    setIsDecoding(true);
    setAnalysis(null);
    setMonoBuf(null);
    try {
      const audio = await fetchAndDecode(audioUrl);
      const mono = toMono(audio);
      setMonoBuf({
        mono,
        sampleRate: audio.sampleRate,
        fullDurationSec: audio.duration,
      });
      const end = Math.min(audio.duration, 30);
      setTrimStart(0);
      setTrimEnd(end);
    } catch (err) {
      setIngestError(
        "Failed to decode audio: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setIsDecoding(false);
    }
  }, []);

  // ------- Ingest -------
  const [uploadPct, setUploadPct] = useState(0);
  const ingestFile = useCallback(async (file: File) => {
    setIngestError("");
    setIsIngesting(true);
    setUploadPct(0);
    try {
      // Try direct-to-Blob upload first. This bypasses Vercel's 4.5 MB
      // function-body cap — bytes stream straight from the browser to Blob
      // storage. If Blob isn't configured (local dev without token) the
      // upload rejects instantly and we fall through to the multipart
      // route so local uploads keep working.
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80);
      const pathname = `waveform-reel/uploads/${Date.now()}-${safeName}`;
      let blobUrl: string | null = null;
      try {
        const blob = await blobUpload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/waveform-reel/upload-token",
          contentType: file.type || "audio/mpeg",
          onUploadProgress: (p) => setUploadPct(p.percentage),
        });
        blobUrl = blob.url;
      } catch {
        blobUrl = null;
      }

      let audioUrl: string;
      let key: string;
      if (blobUrl) {
        const res = await fetch("/api/waveform-reel/audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blobUrl, name: file.name }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `register_${res.status}`);
        }
        const j = (await res.json()) as { audioUrl: string; key: string };
        audioUrl = j.audioUrl;
        key = j.key;
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/waveform-reel/audio", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `ingest_${res.status}`);
        }
        const j = (await res.json()) as { audioUrl: string; key: string };
        audioUrl = j.audioUrl;
        key = j.key;
      }

      setSource({
        kind: "ready",
        audioUrl,
        source: "upload",
        key,
        label: file.name,
      });
      await decode(audioUrl);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
      setUploadPct(0);
    }
  }, [decode]);

  const ingestUrl = useCallback(async () => {
    const url = ytUrl.trim();
    if (!url) return;
    setIngestError("");
    setIsIngesting(true);
    try {
      const res = await fetch("/api/waveform-reel/audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `ingest_${res.status}`);
      }
      const j = (await res.json()) as {
        audioUrl: string;
        source: "youtube";
        key: string;
        title?: string;
      };
      setSource({
        kind: "ready",
        audioUrl: j.audioUrl,
        source: "youtube",
        key: j.key,
        label: j.title ?? url,
      });
      await decode(j.audioUrl);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
    }
  }, [ytUrl, decode]);

  // ------- Analyze (debounced on trim changes) -------
  useEffect(() => {
    if (!monoBuf) return;
    if (trimEnd <= trimStart) return;
    const timer = window.setTimeout(() => {
      setIsAnalyzing(true);
      // Yield to the browser so the button re-renders before the sync loop.
      window.setTimeout(() => {
        try {
          const a = analyzeMono(monoBuf.mono, monoBuf.sampleRate, WR_FPS, {
            trimStartSec: trimStart,
            trimEndSec: trimEnd,
          });
          setAnalysis(serializeAnalysis(a));
        } finally {
          setIsAnalyzing(false);
        }
      }, 0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [monoBuf, trimStart, trimEnd]);

  // Audio URL trimmed via #t=start,end so <MediaAudio> starts/stops in the
  // right place inside the composition.
  const trimmedAudioUrl = useMemo(() => {
    if (source.kind !== "ready") return "";
    return `${source.audioUrl}#t=${trimStart.toFixed(3)},${trimEnd.toFixed(3)}`;
  }, [source, trimStart, trimEnd]);

  const currentProps: WaveformReelProps = useMemo(
    () => ({
      audioSrc: trimmedAudioUrl,
      analysis,
      config,
      forRender: false,
    }),
    [trimmedAudioUrl, analysis, config],
  );

  const durationFrames = computeWaveformDurationFrames(analysis, WR_FPS);

  const handleDownload = useCallback(async () => {
    if (!analysis) {
      setExportError("Load audio and pick trim first.");
      return;
    }
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "WaveformReel",
          component: WaveformReelComposition,
          durationInFrames: durationFrames,
          fps: WR_FPS,
          width: WR_WIDTH,
          height: WR_HEIGHT,
          defaultProps: waveformReelDefaultProps,
          calculateMetadata: () => ({
            width: WR_WIDTH,
            height: WR_HEIGHT,
            durationInFrames: durationFrames,
            fps: WR_FPS,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: { ...currentProps, forRender: true } as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: 8_000_000,
        audioCodec: "aac",
        hardwareAcceleration: "no-preference",
        keyframeIntervalInSeconds: 2,
        delayRenderTimeoutInMilliseconds: 90_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await stripVideoMetadata(await getBlob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "waveform-reel.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object")
          ? msg
          : "Export failed. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [analysis, currentProps, durationFrames]);

  const ready = source.kind === "ready" && !!analysis;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      <div className="flex flex-col md:flex-1 md:min-h-0 md:flex-row">
        {/* LEFT */}
        <aside
          className="flex flex-col gap-6 p-6 border-b md:overflow-y-auto md:w-[320px] md:border-b-0 md:border-r"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          {/* Source toggle */}
          <div className="flex flex-col gap-3">
            <span
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Source
            </span>
            <div className="flex gap-2">
              {(["upload", "url"] as const).map((m) => {
                const active = inputMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInputMode(m)}
                    className="flex-1 rounded-md border px-3 py-2 font-sans text-sm"
                    style={{
                      borderColor: active
                        ? BRAND.colors.ink
                        : BRAND.colors.grey200,
                      backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                      color: active ? BRAND.colors.paper : BRAND.colors.ink,
                    }}
                  >
                    {m === "upload" ? "Upload file" : "Paste URL"}
                  </button>
                );
              })}
            </div>

            {inputMode === "upload" ? (
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-3 py-6 font-sans text-xs"
                style={{
                  borderColor: BRAND.colors.grey200,
                  color: BRAND.colors.grey500,
                }}
              >
                <input
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) ingestFile(f);
                  }}
                  disabled={isIngesting}
                />
                {isIngesting
                  ? uploadPct > 0 && uploadPct < 100
                    ? `Uploading ${Math.round(uploadPct)}%`
                    : "Uploading…"
                  : "Drop or choose audio / video"}
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  type="url"
                  placeholder="https://youtube.com/watch?v=…"
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  className="rounded-md border px-3 py-2 font-sans text-sm"
                  style={{
                    borderColor: BRAND.colors.grey200,
                    backgroundColor: "#FFFFFF",
                    color: BRAND.colors.ink,
                  }}
                />
                <Button
                  onClick={ingestUrl}
                  disabled={isIngesting || !ytUrl.trim()}
                  className="w-full font-sans"
                >
                  {isIngesting ? "Fetching audio…" : "Fetch YouTube audio"}
                </Button>
                <p
                  className="font-sans text-[11px] leading-snug"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Uses yt-dlp + your Firefox cookies. Cached by video ID.
                </p>
              </div>
            )}

            {source.kind === "ready" && (
              <p
                className="truncate rounded-md border px-2 py-1 font-sans text-[11px]"
                style={{
                  borderColor: BRAND.colors.grey200,
                  color: BRAND.colors.grey500,
                }}
                title={source.label}
              >
                Loaded: {source.label}
              </p>
            )}
            {ingestError && (
              <p
                role="alert"
                className="font-sans text-xs"
                style={{ color: BRAND.colors.ink }}
              >
                {ingestError}
              </p>
            )}
          </div>

          {/* Trim */}
          {monoBuf && (
            <div className="flex flex-col gap-2">
              <span
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Trim ({(trimEnd - trimStart).toFixed(1)}s of{" "}
                {monoBuf.fullDurationSec.toFixed(1)}s)
              </span>
              <TrimSlider
                start={trimStart}
                end={trimEnd}
                max={monoBuf.fullDurationSec}
                onChange={(s, e) => {
                  setTrimStart(s);
                  setTrimEnd(e);
                }}
              />
              <p
                className="font-sans text-[11px]"
                style={{ color: BRAND.colors.grey500 }}
              >
                {trimStart.toFixed(2)}s → {trimEnd.toFixed(2)}s
                {isAnalyzing ? " · analyzing…" : isDecoding ? " · decoding…" : ""}
              </p>
            </div>
          )}

          {/* Style */}
          <div className="flex flex-col gap-3">
            <span
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Visualizer style
            </span>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((o) => {
                const active = config.style === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() =>
                      setConfig((c) => ({ ...c, style: o.id }))
                    }
                    className="rounded-md border px-3 py-2 font-sans text-sm"
                    style={{
                      borderColor: active
                        ? BRAND.colors.ink
                        : BRAND.colors.grey200,
                      backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                      color: active ? BRAND.colors.paper : BRAND.colors.ink,
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sliders */}
          <div className="flex flex-col gap-3">
            {(config.style === "bars" || config.style === "line") && (
              <>
                {config.style === "bars" && (
                  <Slider
                    label="Bar count"
                    min={16}
                    max={200}
                    step={1}
                    value={config.barCount}
                    onChange={(v) =>
                      setConfig((c) => ({ ...c, barCount: v }))
                    }
                  />
                )}
                {config.style === "bars" && (
                  <Slider
                    label="Bar thickness"
                    min={2}
                    max={24}
                    step={1}
                    value={config.barThickness}
                    onChange={(v) =>
                      setConfig((c) => ({ ...c, barThickness: v }))
                    }
                  />
                )}
                {config.style === "bars" && (
                  <div className="flex flex-col gap-1">
                    <span
                      className="font-sans text-xs"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      Bar layout
                    </span>
                    <div className="flex gap-2">
                      {(["symmetric", "linear"] as const).map((mode) => {
                        const active = config.barsLayout === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              setConfig((c) => ({ ...c, barsLayout: mode }))
                            }
                            className="flex-1 rounded-md border px-2 py-1.5 font-sans text-xs"
                            style={{
                              borderColor: active
                                ? BRAND.colors.ink
                                : BRAND.colors.grey200,
                              backgroundColor: active
                                ? BRAND.colors.ink
                                : "#FFFFFF",
                              color: active
                                ? BRAND.colors.paper
                                : BRAND.colors.ink,
                            }}
                          >
                            {mode === "symmetric" ? "Symmetric" : "Linear"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {config.style === "line" && (
                  <Slider
                    label="Line thickness"
                    min={2}
                    max={16}
                    step={1}
                    value={config.lineThickness}
                    onChange={(v) =>
                      setConfig((c) => ({ ...c, lineThickness: v }))
                    }
                  />
                )}
                <Slider
                  label="Vertical position"
                  min={0.2}
                  max={0.8}
                  step={0.01}
                  value={config.verticalPosition}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, verticalPosition: v }))
                  }
                />
              </>
            )}
            {(config.style === "orb" || config.style === "orb-ring") && (
              <>
                <Slider
                  label="Orb size"
                  min={0.12}
                  max={0.48}
                  step={0.01}
                  value={config.orbRadius}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, orbRadius: v }))
                  }
                />
                <Slider
                  label="Displacement"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={config.orbDisplacement}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, orbDisplacement: v }))
                  }
                />
                <Slider
                  label="Rotation speed"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={config.orbRotation}
                  onChange={(v) =>
                    setConfig((c) => ({ ...c, orbRotation: v }))
                  }
                />
                {config.style === "orb-ring" && (
                  <Slider
                    label="Ring bar count"
                    min={40}
                    max={240}
                    step={2}
                    value={config.orbRingBars}
                    onChange={(v) =>
                      setConfig((c) => ({ ...c, orbRingBars: v }))
                    }
                  />
                )}
              </>
            )}
            <Slider
              label="Bass pulse"
              min={0}
              max={0.25}
              step={0.005}
              value={config.pulseAmount}
              onChange={(v) => setConfig((c) => ({ ...c, pulseAmount: v }))}
            />
            <Slider
              label="Sensitivity"
              min={0.3}
              max={2.5}
              step={0.01}
              value={config.sensitivity}
              onChange={(v) => setConfig((c) => ({ ...c, sensitivity: v }))}
            />
            <Slider
              label="Glow"
              min={0}
              max={1}
              step={0.01}
              value={config.glow}
              onChange={(v) => setConfig((c) => ({ ...c, glow: v }))}
            />
            <label
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 font-sans text-xs cursor-pointer"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
              }}
            >
              <span>VERNAVLE watermark</span>
              <input
                type="checkbox"
                checked={config.watermark}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, watermark: e.target.checked }))
                }
              />
            </label>
          </div>
        </aside>

        {/* CENTER */}
        <main
          className="flex flex-1 items-center justify-center p-4 md:p-12"
          style={{ backgroundColor: "#5A5A60" }}
        >
          <Player
            component={WaveformReelComposition}
            compositionWidth={WR_WIDTH}
            compositionHeight={WR_HEIGHT}
            durationInFrames={durationFrames}
            fps={WR_FPS}
            controls
            loop
            inputProps={currentProps}
            style={{ width: playerDims.w, height: playerDims.h }}
          />
        </main>

        {/* RIGHT */}
        <aside
          className="flex flex-col gap-3 p-6 border-t md:border-t-0 md:border-l md:w-[260px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <Button
            onClick={handleDownload}
            disabled={isRendering || !ready || canExport === false}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>

          {!ready && (
            <p
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              {source.kind === "none"
                ? "Load audio or a YouTube URL to start."
                : isDecoding
                  ? "Decoding audio…"
                  : isAnalyzing
                    ? "Analyzing waveform…"
                    : "Adjust trim to enable export."}
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
            1080×1920 · 60fps · H.264 + AAC · audio muxed in.
          </p>
        </aside>
      </div>
    </div>
  );
};

const Slider: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}> = ({ label, min, max, step, value, onChange }) => (
  <label className="flex flex-col gap-1">
    <span
      className="flex items-baseline justify-between font-sans text-xs"
      style={{ color: BRAND.colors.grey500 }}
    >
      <span>{label}</span>
      <span style={{ color: BRAND.colors.ink }}>
        {step >= 1 ? value.toFixed(0) : value.toFixed(2)}
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </label>
);

/**
 * Two-thumb range slider using a pair of native inputs stacked. Not the
 * prettiest but zero deps and precise. Values in seconds.
 */
const TrimSlider: React.FC<{
  start: number;
  end: number;
  max: number;
  onChange: (start: number, end: number) => void;
}> = ({ start, end, max, onChange }) => {
  const startPct = max > 0 ? (start / max) * 100 : 0;
  const endPct = max > 0 ? (end / max) * 100 : 100;
  return (
    <div className="relative h-8">
      <div
        className="absolute left-0 right-0 top-3 h-2 rounded"
        style={{ backgroundColor: BRAND.colors.grey200 }}
      />
      <div
        className="absolute top-3 h-2 rounded"
        style={{
          left: `${startPct}%`,
          right: `${100 - endPct}%`,
          backgroundColor: BRAND.colors.ink,
        }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={start}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), end - 0.5);
          onChange(v, end);
        }}
        className="pointer-events-auto absolute inset-0 h-8 w-full appearance-none bg-transparent"
        style={{ WebkitAppearance: "none" }}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={end}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), start + 0.5);
          onChange(start, v);
        }}
        className="pointer-events-auto absolute inset-0 h-8 w-full appearance-none bg-transparent"
        style={{ WebkitAppearance: "none" }}
      />
    </div>
  );
};
