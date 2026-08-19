"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";
import { VideoStage } from "./VideoStage";
import { putBlob } from "@/lib/hype-edit/blob-store";
import { loadProject, saveProject } from "@/lib/hype-edit/storage";
import { EMPTY_PROJECT, type HypeFrame } from "@/lib/hype-edit/types";

type Clip = {
  src: string;
  sec: number;
  durationSec: number;
  sizeBytes: number;
};

type FrameGrabResponse = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  clipDurationSec: number;
  mode: "full-bleed" | "letterboxed";
  cropOffsetX: number;
  clips: Clip[];
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
type PickMode = "auto" | "manual" | "paste" | "random";

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; name: string; loaded: number; total: number }
  | { phase: "done"; name: string; serverPath: string }
  | { phase: "error"; message: string };

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
};

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
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

/**
 * Parse a free-form paste of timestamps like:
 *   0:12, 0:45, 1:20
 *   0:12
 *   1:20
 *   62.5 88.2 105
 */
function parseTimestampsBlob(raw: string): number[] {
  const parts = raw.split(/[\s,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const v = parseStart(p);
    if (isFinite(v) && v >= 0) out.push(v);
  }
  return out;
}

/** Deterministic 32-bit PRNG so a given randomSeed always produces the same
 *  set of moments (client preview + server extract stay in sync). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newRow = (start = "0", count = "30"): WindowRow => ({
  id: Math.random().toString(36).slice(2, 9),
  startStr: start,
  countStr: count,
});

export function FrameGrab() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local pick: instant blob URL for playback + XHR upload → server-side path for ffmpeg.
  const [pickedBlobUrl, setPickedBlobUrl] = useState<string | null>(null);
  const [pickedMeta, setPickedMeta] = useState<{ name: string; sizeMB: number } | null>(null);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<ResolveResponse | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mode, setMode] = useState<"full-bleed" | "letterboxed">("full-bleed");
  const [cropOffsetX, setCropOffsetX] = useState(0.5);
  const [pickMode, setPickMode] = useState<PickMode>("manual");
  const [clipDurationSec, setClipDurationSec] = useState(0.5);

  // Manual mode
  const [markers, setMarkers] = useState<Marker[]>([]);

  // Auto mode
  const [rows, setRows] = useState<WindowRow[]>([newRow()]);
  const [interval, setInterval] = useState(0.5);

  // Paste mode
  const [pasteText, setPasteText] = useState("");

  // Random mode
  const [randomCount, setRandomCount] = useState(30);
  // Deterministic seed for a given "roll" — bumped by the Re-roll button so
  // the moments preview + the extract call use the same set.
  const [randomSeed, setRandomSeed] = useState(() => Math.random());

  // Extraction result
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<FrameGrabResponse | null>(null);
  const [hiddenClips, setHiddenClips] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [pushingToHype, setPushingToHype] = useState(false);

  // VideoStage hooks — VideoStage registers these callbacks with us.
  const grabRef = useRef<() => number | null>(() => null);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const captureThumbRef = useRef<(sec: number) => Promise<string | null>>(
    async () => null,
  );
  // Full-frame capture unused for clip extraction, but VideoStage still requires it.
  const captureFullFrameRef = useRef<(sec: number) => Promise<Blob | null>>(
    async () => null,
  );

  const load = useCallback(async () => {
    setError(null);
    setLoaded(null);
    setResult(null);
    setMarkers([]);
    if (pickedBlobUrl) {
      URL.revokeObjectURL(pickedBlobUrl);
      setPickedBlobUrl(null);
    }
    setPickedMeta(null);
    setUpload({ phase: "idle" });
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

  // Native picker: play instantly (blob URL) + stream-upload in background.
  const onFilePicked = useCallback((file: File) => {
    setError(null);
    setResult(null);
    setMarkers([]);
    setLoaded(null);
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
    // Start upload immediately so the server path is ready when the user hits Extract.
    setUpload({ phase: "uploading", name: file.name, loaded: 0, total: file.size });
    const xhr = new XMLHttpRequest();
    const qs = new URLSearchParams({
      name: file.name,
      size: String(file.size),
      lastModified: String(file.lastModified),
    });
    xhr.open("POST", `/api/frame-grab/upload?${qs.toString()}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUpload({ phase: "uploading", name: file.name, loaded: e.loaded, total: e.total });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText) as { path: string };
          setUpload({ phase: "done", name: file.name, serverPath: json.path });
        } catch {
          setUpload({ phase: "error", message: "bad_upload_response" });
        }
      } else {
        setUpload({ phase: "error", message: `upload_failed_${xhr.status}` });
      }
    };
    xhr.onerror = () => setUpload({ phase: "error", message: "upload_network_error" });
    xhr.send(file);
  }, [pickedBlobUrl]);

  const grabMoment = useCallback(async () => {
    const sec = grabRef.current();
    if (sec == null) return;
    const id = Math.random().toString(36).slice(2, 9);
    setMarkers((m) => [...m, { id, sec }].sort((a, b) => a.sec - b.sec));
    void captureThumbRef.current(sec).then((thumb) => {
      if (!thumb) return;
      setMarkers((m) => m.map((k) => (k.id === id ? { ...k, thumb } : k)));
    });
  }, []);

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
    const marker = markers.find((k) => k.id === id);
    if (marker) {
      const newSec = Math.max(0, marker.sec + delta);
      void captureThumbRef.current(newSec).then((thumb) => {
        if (!thumb) return;
        setMarkers((m) => m.map((k) => (k.id === id ? { ...k, thumb } : k)));
      });
    }
  };

  const buildMoments = useCallback((): number[] | { error: string } => {
    if (pickMode === "manual") {
      if (markers.length === 0) {
        return { error: "No markers picked — hit Space (or Grab this moment) to add some." };
      }
      return markers.map((m) => m.sec);
    }
    if (pickMode === "paste") {
      const parsed = parseTimestampsBlob(pasteText);
      if (parsed.length === 0) {
        return { error: "Paste timestamps separated by spaces, commas, or newlines (e.g. 0:12, 0:45, 1:20)." };
      }
      return parsed;
    }
    if (pickMode === "random") {
      const effDur = duration || loaded?.durationSec || 0;
      if (!effDur || effDur < clipDurationSec * 2) {
        return { error: "Video duration unknown — let the player load first, or paste a URL that resolves." };
      }
      const usable = Math.max(0, effDur - clipDurationSec);
      const n = Math.max(1, Math.min(500, Math.floor(randomCount) || 30));
      // Stratified pick: split the timeline into N equal bands and drop one
      // clip in a random spot inside each band. Better spread than pure random
      // (avoids clumps + gaps).
      const rand = mulberry32(Math.floor(randomSeed * 2 ** 32));
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const bandStart = (i / n) * usable;
        const bandEnd = ((i + 1) / n) * usable;
        out.push(bandStart + rand() * (bandEnd - bandStart));
      }
      // Fisher-Yates shuffle so the extract grid isn't ordered by timestamp.
      // Stratification kept coverage even; shuffling only touches order, so
      // clips still cover the whole video but appear jumbled in the output.
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    // Auto: expand windows into a flat list of timestamps.
    const out: number[] = [];
    for (const r of rows) {
      const start = parseStart(r.startStr);
      const count = Math.max(1, Math.min(120, Math.floor(Number(r.countStr) || 30)));
      for (let i = 0; i < count; i++) out.push(start + i * interval);
    }
    return out;
  }, [pickMode, markers, pasteText, rows, interval, duration, loaded, clipDurationSec, randomCount, randomSeed]);

  // Extraction runs server-side against either the uploaded copy of a local file,
  // or the URL/typed path the user pasted.
  const extract = useCallback(async () => {
    if (!loaded) {
      setError("Load a video first.");
      return;
    }
    if (pickedBlobUrl && upload.phase === "uploading") {
      setError(`Still uploading (${Math.round((upload.loaded / upload.total) * 100)}%). Extraction will start when the upload finishes.`);
      return;
    }
    if (pickedBlobUrl && upload.phase === "error") {
      setError(`Upload failed: ${upload.message}. Re-pick the file.`);
      return;
    }
    const extractionSource =
      pickedBlobUrl && upload.phase === "done" ? upload.serverPath : source.trim();
    if (!extractionSource) {
      setError("No source to extract from. Pick a file or paste a URL/path.");
      return;
    }
    const moments = buildMoments();
    if (!Array.isArray(moments)) {
      setError(moments.error);
      return;
    }

    setError(null);
    setResult(null);
    setHiddenClips(new Set());
    setExtracting(true);
    try {
      const body: Record<string, unknown> = {
        source: extractionSource,
        mode,
        cropOffsetX,
        intervalSec: interval,
        clipDurationSec,
      };
      if (pickMode === "auto") {
        body.windows = rows.map((r) => ({
          startSec: parseStart(r.startStr),
          count: Math.max(1, Math.min(120, Math.floor(Number(r.countStr) || 30))),
        }));
      } else {
        body.moments = moments;
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
  }, [
    loaded,
    pickedBlobUrl,
    upload,
    source,
    mode,
    cropOffsetX,
    interval,
    clipDurationSec,
    pickMode,
    rows,
    buildMoments,
  ]);

  // Nudge a rendered clip: re-extract just that timestamp ±0.1s.
  const nudgeClip = useCallback(
    async (clip: Clip, delta: number) => {
      if (!loaded) return;
      const extractionSource =
        pickedBlobUrl && upload.phase === "done" ? upload.serverPath : source.trim();
      if (!extractionSource) return;
      const newSec = Math.max(0, clip.sec + delta);
      try {
        const res = await fetch("/api/frame-grab", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: extractionSource,
            mode,
            cropOffsetX,
            clipDurationSec,
            moments: [newSec],
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
          return;
        }
        const replacement = (json as FrameGrabResponse).clips[0];
        if (!replacement) return;
        // Cache-bust: append ?v=Date.now() so the <video> reloads the new file.
        const cacheBusted = { ...replacement, src: `${replacement.src}?v=${Date.now()}` };
        setResult((r) =>
          r
            ? {
                ...r,
                clips: r.clips.map((c) => (c.src === clip.src ? cacheBusted : c)),
              }
            : r,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "nudge_failed");
      }
    },
    [loaded, pickedBlobUrl, upload, source, mode, cropOffsetX, clipDurationSec],
  );

  const visibleClips = useMemo(
    () => (result ? result.clips.filter((c) => !hiddenClips.has(c.src)) : []),
    [result, hiddenClips],
  );

  const downloadZip = useCallback(async () => {
    if (!result || visibleClips.length === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const root = zip.folder(result.sourceId) ?? zip;
      await Promise.all(
        visibleClips.map(async (c, i) => {
          const blob = await fetch(c.src).then((r) => r.blob());
          const name = `${String(i + 1).padStart(3, "0")}_${Math.round(c.sec * 1000)}ms.mp4`;
          root.file(name, blob);
        }),
      );
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${result.sourceId}-clips.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setZipping(false);
    }
  }, [result, visibleClips]);

  const pushToHypeEdit = useCallback(
    async (replaceExisting: boolean) => {
      if (!result || visibleClips.length === 0) return;
      setPushingToHype(true);
      try {
        // Fetch each clip as a Blob and stash it in Hype Edit's IndexedDB store.
        const uuid = () =>
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36);

        const newFrames: HypeFrame[] = [];
        for (const c of visibleClips) {
          const blob = await fetch(c.src).then((r) => r.blob());
          const id = uuid();
          await putBlob(id, blob);
          newFrames.push({
            id,
            kind: "video",
            src: URL.createObjectURL(blob),
            label: `${result.sourceId} · ${c.sec.toFixed(1)}s`,
            session: true,
          });
        }

        const existing = (await loadProject()) ?? EMPTY_PROJECT;
        const merged = replaceExisting
          ? { ...existing, frames: newFrames }
          : { ...existing, frames: [...existing.frames, ...newFrames] };
        saveProject(merged);

        router.push("/hype-edit");
      } catch (e) {
        setError(e instanceof Error ? e.message : "push_to_hype_failed");
        setPushingToHype(false);
      }
    },
    [result, visibleClips, router],
  );

  const patchRow = (id: string, patch: Partial<WindowRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  const uploadPct =
    upload.phase === "uploading"
      ? Math.round((upload.loaded / upload.total) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-ds-surface text-ds-on-surface">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">Frame Grab</h1>
        <p className="mt-2 text-sm text-ds-on-surface-muted">
          Cut a video into a batch of short vertical clips ({clipDurationSec.toFixed(2)}s each, 1080×1920)
          for use in a montage. Pick moments visually, or paste timestamps blind if the browser can&apos;t play your file.
        </p>

        {/* Source row */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="YouTube URL or a local file path (e.g. C:\scenepacks\pack.mp4 — no upload needed)"
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

          {upload.phase === "uploading" && pickedMeta && (
            <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-2 text-xs text-ds-on-surface">
              <div className="flex items-center justify-between">
                <span className="truncate">
                  Uploading <span className="text-ds-on-surface">{pickedMeta.name}</span>{" "}
                  ({pickedMeta.sizeMB.toFixed(1)} MB)…
                </span>
                <span className="tabular-nums text-ds-on-surface-muted">
                  {uploadPct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-ds-border-hairline">
                <div
                  className="h-full bg-ds-primary transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-ds-on-surface-muted">
                Scrub + pick moments while this finishes. Extract will wait for the upload.
              </div>
            </div>
          )}
          {upload.phase === "done" && pickedMeta && (
            <div className="text-[11px] text-ds-on-surface-muted">
              ✓ <span className="text-ds-on-surface">{pickedMeta.name}</span> ready ({pickedMeta.sizeMB.toFixed(1)} MB uploaded).
            </div>
          )}
          {upload.phase === "error" && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              Upload failed: {upload.message}. Try picking the file again.
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
            <label className="flex items-center gap-2 text-xs text-ds-on-surface-muted">
              Clip length (s)
              <input
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                value={clipDurationSec}
                onChange={(e) => setClipDurationSec(Math.max(0.1, Math.min(10, Number(e.target.value) || 0.5)))}
                className="w-20 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-sm outline-none focus:border-ds-primary"
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Video stage — only when the browser can play the file */}
        {loaded && pickMode !== "paste" && (
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
          </div>
        )}

        {/* Pick mode tabs — visible always so you can switch to Paste even if the player is black */}
        {(loaded || pickMode === "paste") && (
          <div className="mt-4 flex items-center gap-1 border-b border-ds-border-hairline">
            {(["manual", "auto", "random", "paste"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPickMode(m)}
                className={`px-4 py-2 text-xs uppercase tracking-widest ${
                  pickMode === m
                    ? "border-b-2 border-ds-primary text-ds-on-surface"
                    : "text-ds-on-surface-muted hover:text-ds-on-surface"
                }`}
              >
                {m === "manual"
                  ? "Manual (pick)"
                  : m === "auto"
                    ? "Auto (interval)"
                    : m === "random"
                      ? "Random"
                      : "Paste timestamps"}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 py-1">
              <Button
                onClick={extract}
                disabled={extracting}
                variant="pill-primary"
                size="pill"
              >
                {extracting ? "Extracting…" : "Extract clips"}
              </Button>
            </div>
          </div>
        )}

        {loaded && pickMode === "manual" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-3 text-xs">
              <Button onClick={grabMoment} variant="outline">
                Grab this moment <span className="ml-2 text-[10px] text-ds-on-surface-muted">Space</span>
              </Button>
              <span className="text-ds-on-surface-muted">
                At {fmtTime(currentTime)} · {markers.length} picked
              </span>
            </div>
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
                        <img src={mk.thumb} alt="" className="aspect-[9/16] w-full object-cover" />
                      ) : (
                        <div className="flex aspect-[9/16] w-full items-center justify-center text-[10px] text-ds-on-surface-muted">…</div>
                      )}
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-white/85 px-1.5 py-0.5 text-[10px] text-ds-on-surface backdrop-blur-sm">
                      <span className="tabular-nums">
                        {String(i + 1).padStart(2, "0")} · {fmtTime(mk.sec)}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => nudgeMarker(mk.id, -0.1)} className="rounded bg-ds-surface-raised px-1 hover:opacity-80" title="-0.1s">−</button>
                        <button onClick={() => nudgeMarker(mk.id, 0.1)} className="rounded bg-ds-surface-raised px-1 hover:opacity-80" title="+0.1s">+</button>
                        <button onClick={() => removeMarker(mk.id)} className="rounded bg-red-500/90 px-1 text-white hover:bg-red-600" title="Remove">×</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loaded && pickMode === "auto" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-ds-on-surface-muted">
                Interval between clip starts (s)
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
                <div className="text-xs uppercase tracking-wider text-ds-on-surface-muted">Windows ({rows.length})</div>
                <Button size="xs" variant="outline" onClick={addRow}>+ Add window</Button>
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className="w-6 text-right text-xs tabular-nums text-ds-on-surface-muted">{i + 1}.</span>
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
                      {(Math.max(1, Number(r.countStr) || 0) * interval).toFixed(1)}s span · {Math.max(1, Number(r.countStr) || 0)} clips
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

        {loaded && pickMode === "random" && (() => {
          const effDur = duration || loaded.durationSec || 0;
          const canPreview = effDur > 0;
          const preview = canPreview ? (buildMoments() as number[] | { error: string }) : null;
          const previewList = Array.isArray(preview) ? preview : [];
          return (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-ds-on-surface-muted">
                  Clip count
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="1"
                    value={randomCount}
                    onChange={(e) => setRandomCount(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 30))))}
                    className="w-24 rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-2 text-sm outline-none focus:border-ds-primary"
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRandomSeed(Math.random())}
                  disabled={!canPreview}
                >
                  Re-roll
                </Button>
                <div className="text-[11px] text-ds-on-surface-muted">
                  {canPreview
                    ? `${previewList.length} random moments from a ${fmtTime(effDur)} video. Stratified — one per equal band, jittered.`
                    : "Load a video first — random pick needs a known duration."}
                </div>
              </div>
              {canPreview && previewList.length > 0 && (
                <div className="rounded-md border border-ds-border-hairline bg-ds-surface-raised p-2">
                  <div className="flex flex-wrap gap-1 font-mono text-[10px] text-ds-on-surface-muted">
                    {previewList.slice(0, 60).map((t, i) => (
                      <span
                        key={i}
                        className="rounded bg-ds-surface px-1.5 py-0.5"
                        title={`${t.toFixed(2)}s`}
                      >
                        {fmtTime(t)}
                      </span>
                    ))}
                    {previewList.length > 60 && (
                      <span className="px-1.5 py-0.5 text-ds-on-surface-muted">
                        + {previewList.length - 60} more…
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {pickMode === "paste" && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="text-xs text-ds-on-surface-muted">
              Paste start times separated by spaces, commas, or newlines. Formats: <code>0:12</code>, <code>1:20.5</code>, or plain seconds <code>62.5</code>. One clip per timestamp.
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"0:12  0:45  1:20  1:44  2:20"}
              rows={5}
              className="w-full rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-2 font-mono text-sm outline-none focus:border-ds-primary"
            />
            <div className="text-[11px] text-ds-on-surface-muted">
              {parseTimestampsBlob(pasteText).length} timestamp(s) parsed
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-3">
              <div className="text-sm text-ds-on-surface-muted">
                {visibleClips.length} of {result.clips.length} clips · {result.mode} · {result.clipDurationSec}s each
              </div>
              <Button
                variant="outline"
                onClick={downloadZip}
                disabled={zipping || visibleClips.length === 0}
              >
                {zipping ? "Zipping…" : "Download .zip"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void pushToHypeEdit(false)}
                disabled={pushingToHype || visibleClips.length === 0}
                title="Append these clips to your Hype Edit project"
              >
                {pushingToHype ? "Sending…" : "→ Add to Hype Edit"}
              </Button>
              <Button
                variant="pill-primary"
                size="pill"
                onClick={() => {
                  if (
                    confirm(
                      "Replace all existing frames in your Hype Edit project with these clips?",
                    )
                  ) {
                    void pushToHypeEdit(true);
                  }
                }}
                disabled={pushingToHype || visibleClips.length === 0}
                title="Replace all Hype Edit frames with these clips"
              >
                {pushingToHype ? "Sending…" : "→ Replace Hype Edit frames"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {result.clips.map((c, i) => {
                const hidden = hiddenClips.has(c.src);
                return (
                  <div
                    key={c.src}
                    className={`group relative overflow-hidden rounded-md border border-ds-border-hairline bg-ds-surface-raised ${hidden ? "opacity-30" : ""}`}
                  >
                    <video
                      src={c.src}
                      muted
                      loop
                      playsInline
                      onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => {
                        const v = e.currentTarget as HTMLVideoElement;
                        v.pause();
                        v.currentTime = 0;
                      }}
                      className="aspect-[9/16] w-full bg-black object-cover"
                    />
                    <a
                      href={c.src}
                      download
                      className="absolute right-1 top-1 rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-ds-on-surface backdrop-blur-sm hover:opacity-80"
                      title="Download clip"
                    >
                      ↓
                    </a>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-white/85 px-1.5 py-1 text-[10px] text-ds-on-surface backdrop-blur-sm">
                      <span className="tabular-nums">
                        {String(i + 1).padStart(2, "0")} · {fmtTime(c.sec)} · {fmtBytes(c.sizeBytes)}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => nudgeClip(c, -0.1)} className="rounded bg-ds-surface-raised px-1.5 hover:opacity-80" title="Regrab −0.1s">−</button>
                        <button onClick={() => nudgeClip(c, 0.1)} className="rounded bg-ds-surface-raised px-1.5 hover:opacity-80" title="Regrab +0.1s">+</button>
                        <button
                          onClick={() =>
                            setHiddenClips((h) => {
                              const n = new Set(h);
                              if (n.has(c.src)) n.delete(c.src);
                              else n.add(c.src);
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
        className="absolute top-0 h-full w-[2px] bg-ds-primary"
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
