"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";
import { VideoStage } from "./VideoStage";

type Frame = {
  src: string; // URL — either server /frame-grab/… path OR blob: URL from client extraction
  sec: number;
  blob?: Blob; // present for client-extracted frames; skip fetch() for zip download
};

type FrameGrabResponse = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  mode: "full-bleed" | "letterboxed";
  cropOffsetX: number;
  frames: Frame[];
};

type ResolveResponse = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  streamUrl: string;
};

type Marker = { id: string; sec: number; thumb?: string };
type WindowRow = { id: string; startStr: string; countStr: string };
type PickMode = "auto" | "manual";

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
};

function parseStart(input: string): number {
  const t = input.trim();
  if (!t) return 0;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    return Math.max(0, Number(m) * 60 + Number(s));
  }
  return Math.max(0, Number(t) || 0);
}

const newRow = (start = "0", count = "30"): WindowRow => ({
  id: Math.random().toString(36).slice(2, 9),
  startStr: start,
  countStr: count,
});

export function FrameGrab() {
  const [source, setSource] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Blob URL for local picks — playback + client-side extraction, no server round-trip.
  const [pickedBlobUrl, setPickedBlobUrl] = useState<string | null>(null);
  const [pickedMeta, setPickedMeta] = useState<{ name: string; sizeMB: number } | null>(null);
  // True when the loaded video was picked locally (extraction is client-side).
  const isLocal = !!pickedBlobUrl;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ResolveResponse | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [, setDuration] = useState(0);
  const [mode, setMode] = useState<"full-bleed" | "letterboxed">("full-bleed");
  const [cropOffsetX, setCropOffsetX] = useState(0.5);
  const [pickMode, setPickMode] = useState<PickMode>("manual");

  // Manual mode
  const [markers, setMarkers] = useState<Marker[]>([]);

  // Auto mode
  const [rows, setRows] = useState<WindowRow[]>([newRow()]);
  const [interval, setInterval] = useState(0.5);

  // Extraction result
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<FrameGrabResponse | null>(null);
  const [hiddenFrames, setHiddenFrames] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  // VideoStage hooks — VideoStage registers these callbacks with us.
  const grabRef = useRef<() => number | null>(() => null);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const captureThumbRef = useRef<(sec: number) => Promise<string | null>>(
    async () => null,
  );
  const captureFullFrameRef = useRef<(sec: number) => Promise<Blob | null>>(
    async () => null,
  );

  const load = useCallback(async () => {
    setError(null);
    setLoaded(null);
    setResult(null);
    setMarkers([]);
    // Ensure we leave "local" mode when loading via URL/path.
    if (pickedBlobUrl) {
      URL.revokeObjectURL(pickedBlobUrl);
      setPickedBlobUrl(null);
    }
    setPickedMeta(null);
    setLoading(true);
    try {
      const res = await fetch("/api/frame-grab/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: source.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      setLoaded(json as ResolveResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [source, pickedBlobUrl]);

  // Native file picker → play + extract entirely in the browser. No upload.
  const onFilePicked = useCallback((file: File) => {
    setError(null);
    setResult(null);
    setMarkers([]);
    setLoaded(null);
    // Revoke any previous blob URL.
    if (pickedBlobUrl) URL.revokeObjectURL(pickedBlobUrl);
    const blobUrl = URL.createObjectURL(file);
    setPickedBlobUrl(blobUrl);
    setPickedMeta({ name: file.name, sizeMB: file.size / (1024 * 1024) });
    setSource("");
    setLoaded({
      sourceId: `picked-${file.name}`,
      title: file.name,
      channel: "local",
      durationSec: 0,
      streamUrl: blobUrl,
    });
  }, [pickedBlobUrl]);

  const grabMoment = useCallback(async () => {
    const sec = grabRef.current();
    if (sec == null) return;
    const id = Math.random().toString(36).slice(2, 9);
    setMarkers((m) => [...m, { id, sec }].sort((a, b) => a.sec - b.sec));
    // Capture a client-side thumbnail (best-effort, doesn't block).
    void captureThumbRef.current(sec).then((thumb) => {
      if (!thumb) return;
      setMarkers((m) => m.map((k) => (k.id === id ? { ...k, thumb } : k)));
    });
  }, []);

  // Spacebar = grab moment (only when in manual mode and a video is loaded,
  // and focus isn't in an input).
  useEffect(() => {
    if (!loaded || pickMode !== "manual") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      void grabMoment();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, pickMode, grabMoment]);

  const removeMarker = (id: string) =>
    setMarkers((m) => m.filter((k) => k.id !== id));

  const nudgeMarker = (id: string, delta: number) => {
    setMarkers((m) =>
      m
        .map((k) => (k.id === id ? { ...k, sec: Math.max(0, k.sec + delta), thumb: undefined } : k))
        .sort((a, b) => a.sec - b.sec),
    );
    // Re-capture thumb after nudge.
    const marker = markers.find((k) => k.id === id);
    if (marker) {
      const newSec = Math.max(0, marker.sec + delta);
      void captureThumbRef.current(newSec).then((thumb) => {
        if (!thumb) return;
        setMarkers((m) => m.map((k) => (k.id === id ? { ...k, thumb } : k)));
      });
    }
  };

  // Build the list of timestamps to extract from either pick mode.
  const buildMoments = useCallback((): number[] | { error: string } => {
    if (pickMode === "manual") {
      if (markers.length === 0) {
        return { error: "No markers picked — hit Space (or Grab this moment) to add some." };
      }
      return markers.map((m) => m.sec);
    }
    // Auto: expand windows into a flat list of timestamps.
    const out: number[] = [];
    for (const r of rows) {
      const start = parseStart(r.startStr);
      const count = Math.max(1, Math.min(120, Math.floor(Number(r.countStr) || 30)));
      for (let i = 0; i < count; i++) out.push(start + i * interval);
    }
    return out;
  }, [pickMode, markers, rows, interval]);

  const extract = useCallback(async () => {
    if (!loaded) return;
    setError(null);
    setResult(null);
    setHiddenFrames(new Set());
    setExtracting(true);

    try {
      const moments = buildMoments();
      if (!Array.isArray(moments)) {
        setError(moments.error);
        return;
      }

      // Native-picked local file → client-side extraction, no upload, no server ffmpeg.
      if (isLocal) {
        const frames: Frame[] = [];
        for (const sec of moments) {
          const blob = await captureFullFrameRef.current(sec);
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          frames.push({ src: url, sec, blob });
        }
        if (frames.length === 0) {
          setError("Client extraction produced no frames — the browser may not decode this codec.");
          return;
        }
        setResult({
          sourceId: loaded.sourceId,
          title: loaded.title,
          channel: loaded.channel,
          durationSec: loaded.durationSec,
          intervalSec: interval,
          mode,
          cropOffsetX,
          frames,
        });
        return;
      }

      // URL / typed path → server ffmpeg (original path).
      const body: Record<string, unknown> = {
        source: source.trim(),
        mode,
        cropOffsetX,
        intervalSec: interval,
      };
      if (pickMode === "manual") body.moments = moments;
      else {
        body.windows = rows.map((r) => ({
          startSec: parseStart(r.startStr),
          count: Math.max(1, Math.min(120, Math.floor(Number(r.countStr) || 30))),
        }));
      }
      const res = await fetch("/api/frame-grab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      setResult(json as FrameGrabResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "extract_failed");
    } finally {
      setExtracting(false);
    }
  }, [loaded, isLocal, buildMoments, source, mode, cropOffsetX, interval, pickMode, markers, rows]);

  // Nudge a rendered frame: re-capture just that timestamp ±0.1s.
  const nudgeResultFrame = useCallback(
    async (frame: Frame, delta: number) => {
      if (!loaded) return;
      const newSec = Math.max(0, frame.sec + delta);
      try {
        let replacement: Frame | null = null;
        if (isLocal) {
          const blob = await captureFullFrameRef.current(newSec);
          if (!blob) return;
          // Revoke the old blob URL to free memory.
          if (frame.src.startsWith("blob:")) URL.revokeObjectURL(frame.src);
          replacement = { src: URL.createObjectURL(blob), sec: newSec, blob };
        } else {
          const res = await fetch("/api/frame-grab", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              source: source.trim(),
              mode,
              cropOffsetX,
              moments: [newSec],
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
            return;
          }
          const r = (json as FrameGrabResponse).frames[0];
          if (!r) return;
          replacement = { ...r, src: `${r.src}?v=${Date.now()}` };
        }
        setResult((r) =>
          r && replacement
            ? {
                ...r,
                frames: r.frames.map((f) => (f.src === frame.src ? replacement! : f)),
              }
            : r,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "nudge_failed");
      }
    },
    [loaded, isLocal, source, mode, cropOffsetX],
  );

  const visibleFrames = useMemo(
    () => (result ? result.frames.filter((f) => !hiddenFrames.has(f.src)) : []),
    [result, hiddenFrames],
  );

  const downloadZip = useCallback(async () => {
    if (!result || visibleFrames.length === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const root = zip.folder(result.sourceId) ?? zip;
      await Promise.all(
        visibleFrames.map(async (f, i) => {
          const blob: Blob = f.blob
            ? f.blob
            : await fetch(f.src).then((r) => r.blob());
          const name = `${String(i + 1).padStart(3, "0")}_${Math.round(f.sec * 1000)}ms.jpg`;
          root.file(name, blob);
        }),
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${result.sourceId}-frames.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setZipping(false);
    }
  }, [result, visibleFrames]);

  const patchRow = (id: string, patch: Partial<WindowRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  return (
    <div className="min-h-screen bg-ds-surface text-ds-on-surface">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Frame Grab</h1>
        <p className="mt-2 text-sm text-ds-on-surface-muted">
          Click <span className="text-ds-on-surface">Choose file</span> for a local video — nothing is uploaded, the browser does the cropping and extraction. For a YouTube link, paste and hit <span className="text-ds-on-surface">Load URL</span> (server-side via yt-dlp). Then drag the 9:16 crop, scrub, and hand-pick moments — or use even-spaced Auto mode.
        </p>

        {/* Source row */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…  OR  C:\path\to\scenepack.mp4"
              className="w-full rounded-md border border-ds-border-hairline bg-ds-surface-raised px-4 py-3 text-sm outline-none focus:border-ds-primary"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFilePicked(f);
                e.target.value = "";
              }}
            />
            <Button onClick={load} disabled={loading || !source.trim()}>
              {loading ? "Loading…" : "Load URL"}
            </Button>
          </div>

          {pickedMeta && (
            <div className="text-[11px] text-ds-on-surface-muted">
              ✓ <span className="text-ds-on-surface">{pickedMeta.name}</span> — {pickedMeta.sizeMB.toFixed(1)} MB · nothing uploaded, extraction runs in your browser
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ds-on-surface-muted">
              Mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-sm outline-none focus:border-ds-primary"
              >
                <option value="full-bleed">Full-bleed 9:16 (crop)</option>
                <option value="letterboxed">Letterboxed 16:9 (fit)</option>
              </select>
            </label>
            {mode === "full-bleed" && (
              <label className="flex items-center gap-2 text-xs text-ds-on-surface-muted">
                Crop X
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={cropOffsetX}
                  onChange={(e) => setCropOffsetX(Number(e.target.value))}
                  className="w-40 accent-ds-primary"
                />
                <span className="tabular-nums text-ds-on-surface">
                  {(cropOffsetX * 100).toFixed(0)}%
                </span>
              </label>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Video stage */}
        {loaded && (
          <div className="mt-6 flex flex-col gap-4 rounded-md border border-ds-border-hairline bg-ds-surface-raised p-4">
            <div className="text-xs text-ds-on-surface-muted">
              <span className="text-ds-on-surface">{loaded.title}</span>
              {loaded.channel ? <> · {loaded.channel}</> : null}
              {loaded.durationSec ? <> · {fmtTime(loaded.durationSec)}</> : null}
            </div>
            <VideoStage
              src={loaded.streamUrl}
              mode={mode}
              cropOffsetX={cropOffsetX}
              onCropOffsetChange={setCropOffsetX}
              onTimeUpdate={setCurrentTime}
              onDuration={setDuration}
              registerGrab={(fn) => (grabRef.current = fn)}
              registerSeek={(fn) => (seekRef.current = fn)}
              registerCaptureThumb={(fn) => (captureThumbRef.current = fn)}
              registerCaptureFullFrame={(fn) => (captureFullFrameRef.current = fn)}
            />

            {/* Pick mode tabs */}
            <div className="flex items-center gap-1 border-b border-ds-border-hairline">
              {(["manual", "auto"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPickMode(m)}
                  className={`px-4 py-2 text-xs uppercase tracking-widest ${
                    pickMode === m
                      ? "border-b-2 border-ds-primary text-ds-on-surface"
                      : "text-ds-on-surface-muted hover:text-ds-on-surface"
                  }`}
                >
                  {m === "manual" ? "Manual (pick)" : "Auto (interval)"}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  onClick={extract}
                  disabled={extracting}
                  variant="pill-primary"
                  size="pill"
                >
                  {extracting ? "Extracting…" : "Extract frames"}
                </Button>
              </div>
            </div>

            {pickMode === "manual" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 text-xs">
                  <Button onClick={grabMoment} variant="outline">
                    Grab this moment  <span className="ml-2 text-[10px] text-ds-on-surface-muted">Space</span>
                  </Button>
                  <span className="text-ds-on-surface-muted">
                    At {fmtTime(currentTime)} · {markers.length} picked
                  </span>
                </div>

                {/* Timeline with marker pins */}
                <MarkerTimeline
                  duration={loaded.durationSec}
                  markers={markers}
                  currentSec={currentTime}
                  onSeek={(sec) => seekRef.current(sec)}
                />

                {markers.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-8">
                    {markers.map((mk, i) => (
                      <div
                        key={mk.id}
                        className="group relative overflow-hidden rounded-md border border-ds-border-hairline bg-ds-surface-raised"
                      >
                        <button
                          onClick={() => seekRef.current(mk.sec)}
                          className="block w-full"
                          title="Seek here"
                        >
                          {mk.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mk.thumb}
                              alt=""
                              className="aspect-[9/16] w-full object-cover"
                            />
                          ) : (
                            <div className="flex aspect-[9/16] w-full items-center justify-center text-[10px] text-ds-on-surface-muted">
                              …
                            </div>
                          )}
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-white/85 text-ds-on-surface backdrop-blur-sm px-1.5 py-0.5 text-[10px]">
                          <span className="tabular-nums">
                            {String(i + 1).padStart(2, "0")} · {fmtTime(mk.sec)}
                          </span>
                          <div className="flex gap-1">
                            <button
                              onClick={() => nudgeMarker(mk.id, -0.1)}
                              className="rounded bg-ds-surface-raised px-1 hover:opacity-80"
                              title="-0.1s"
                            >
                              −
                            </button>
                            <button
                              onClick={() => nudgeMarker(mk.id, 0.1)}
                              className="rounded bg-ds-surface-raised px-1 hover:opacity-80"
                              title="+0.1s"
                            >
                              +
                            </button>
                            <button
                              onClick={() => removeMarker(mk.id)}
                              className="rounded bg-red-500/90 px-1 text-white hover:bg-red-600"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pickMode === "auto" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-ds-on-surface-muted">
                    Interval (s)
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={interval}
                      onChange={(e) => setInterval(Math.max(0.1, Number(e.target.value) || 0.5))}
                      className="w-24 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-2 text-sm outline-none focus:border-ds-primary"
                    />
                  </label>
                </div>
                <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-ds-on-surface-muted">
                      Windows ({rows.length})
                    </div>
                    <Button size="xs" variant="outline" onClick={addRow}>
                      + Add window
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {rows.map((r, i) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <span className="w-6 text-right text-xs tabular-nums text-ds-on-surface-muted">
                          {i + 1}.
                        </span>
                        <label className="flex flex-col gap-1 text-[10px] text-ds-on-surface-muted">
                          start
                          <input
                            type="text"
                            value={r.startStr}
                            onChange={(e) => patchRow(r.id, { startStr: e.target.value })}
                            className="w-28 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-sm outline-none focus:border-ds-primary"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[10px] text-ds-on-surface-muted">
                          count
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={r.countStr}
                            onChange={(e) => patchRow(r.id, { countStr: e.target.value })}
                            className="w-20 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-sm outline-none focus:border-ds-primary"
                          />
                        </label>
                        <span className="text-[11px] text-ds-on-surface-muted">
                          {(Math.max(1, Number(r.countStr) || 0) * interval).toFixed(1)}s window
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => removeRow(r.id)}
                          disabled={rows.length <= 1}
                          className="ml-auto text-ds-on-surface-muted hover:text-ds-on-surface"
                        >
                          remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <div className="text-sm text-ds-on-surface-muted">
                {visibleFrames.length} of {result.frames.length} frames · {result.mode}
              </div>
              <Button
                variant="outline"
                onClick={downloadZip}
                disabled={zipping || visibleFrames.length === 0}
              >
                {zipping ? "Zipping…" : "Download .zip"}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {result.frames.map((f, i) => {
                const hidden = hiddenFrames.has(f.src);
                return (
                  <div
                    key={f.src}
                    className={`group relative overflow-hidden rounded-md border border-ds-border-hairline bg-ds-surface-raised ${
                      hidden ? "opacity-30" : ""
                    }`}
                  >
                    <a href={f.src} download className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.src}
                        alt={`frame ${i + 1}`}
                        className="aspect-[9/16] w-full object-cover"
                      />
                    </a>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-white/85 text-ds-on-surface backdrop-blur-sm px-1.5 py-1 text-[10px]">
                      <span className="tabular-nums">
                        {String(i + 1).padStart(2, "0")} · {fmtTime(f.sec)}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => nudgeResultFrame(f, -0.1)}
                          className="rounded bg-ds-surface-raised px-1.5 hover:opacity-80"
                          title="Regrab −0.1s"
                        >
                          −
                        </button>
                        <button
                          onClick={() => nudgeResultFrame(f, 0.1)}
                          className="rounded bg-ds-surface-raised px-1.5 hover:opacity-80"
                          title="Regrab +0.1s"
                        >
                          +
                        </button>
                        <button
                          onClick={() =>
                            setHiddenFrames((h) => {
                              const n = new Set(h);
                              if (n.has(f.src)) n.delete(f.src);
                              else n.add(f.src);
                              return n;
                            })
                          }
                          className="rounded bg-red-500/90 px-1.5 text-white hover:bg-red-600"
                          title={hidden ? "Restore" : "Delete"}
                        >
                          {hidden ? "↺" : "×"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MarkerTimeline({
  duration,
  markers,
  currentSec,
  onSeek,
}: {
  duration: number;
  markers: Marker[];
  currentSec: number;
  onSeek: (sec: number) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const d = duration || 1;
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * d);
  };
  return (
    <div
      ref={barRef}
      onClick={handleClick}
      className="relative h-8 w-full cursor-pointer rounded-md border border-ds-border-hairline bg-ds-surface-raised"
    >
      <div
        className="absolute top-0 h-full w-[2px] bg-ds-primary/80"
        style={{ left: `${(currentSec / d) * 100}%` }}
      />
      {markers.map((m) => (
        <div
          key={m.id}
          className="absolute top-0 h-full w-[3px] bg-orange-400"
          style={{ left: `${(m.sec / d) * 100}%` }}
          title={`${m.sec.toFixed(1)}s`}
        />
      ))}
    </div>
  );
}
