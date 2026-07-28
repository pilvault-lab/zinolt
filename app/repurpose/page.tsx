"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from "mediabunny";

// ── Config ────────────────────────────────────────────────────────────────
const SPEED = 1.05;
const BITRATE_FLOOR = 8_000_000; // 8 Mbps
// Watermark: top-right, small margins so social-app UI overlays can't clip it.
const LOGO = {
  src: "/brand/vernavle-logo.png",
  widthRatio: 0.12, // fraction of output width
  rightRatio: 0.03, // right margin as fraction of output width
  topRatio: 0.04, // top margin as fraction of output height (a few % down)
  opacity: 0.9,
};

// Content aspect ratios (width / height) available inside the 9:16 output frame.
// Source is scaled with "cover" fit inside the chosen box; the box is centered
// vertically; black bars fill the remainder of the 9:16 canvas.
const ASPECTS = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "16:9": 16 / 9,
} as const;
type AspectKey = keyof typeof ASPECTS;
const ASPECT_KEYS: readonly AspectKey[] = ["9:16", "1:1", "4:5", "16:9"] as const;

// ── Types ─────────────────────────────────────────────────────────────────
type JobState =
  | { kind: "queued" }
  | { kind: "processing"; progress: number }
  | {
      kind: "done";
      blob: Blob;
      outFile: File;
      elapsedMs: number;
      inSeconds: number;
      outSeconds: number;
      width: number;
      height: number;
    }
  | { kind: "error"; message: string };

type Job = {
  id: string;
  file: File;
  state: JobState;
};

// ── Support detection ─────────────────────────────────────────────────────
function checkSupport(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: true };
  if (typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === "undefined") {
    return { ok: false, reason: "WebCodecs (VideoEncoder) not available" };
  }
  if (typeof (window as unknown as { VideoDecoder?: unknown }).VideoDecoder === "undefined") {
    return { ok: false, reason: "WebCodecs (VideoDecoder) not available" };
  }
  if (typeof OffscreenCanvas === "undefined") {
    return { ok: false, reason: "OffscreenCanvas not available" };
  }
  return { ok: true };
}

// ── Load logo once ────────────────────────────────────────────────────────
let logoPromise: Promise<ImageBitmap> | null = null;
function loadLogo(): Promise<ImageBitmap> {
  if (!logoPromise) {
    logoPromise = fetch(LOGO.src)
      .then((r) => {
        if (!r.ok) throw new Error(`Logo fetch failed: ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
  }
  return logoPromise;
}

// ── Core: process one file ───────────────────────────────────────────────
async function processFile(
  file: File,
  aspect: AspectKey,
  onProgress: (p: number) => void,
): Promise<{
  blob: Blob;
  outFile: File;
  elapsedMs: number;
  inSeconds: number;
  outSeconds: number;
  width: number;
  height: number;
}> {
  const t0 = performance.now();

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("No video track");
  if (!(await videoTrack.canDecode())) {
    throw new Error("This video's codec cannot be decoded in-browser");
  }

  const audioTrack = await input.getPrimaryAudioTrack();

  const srcW = await videoTrack.getDisplayWidth();
  const srcH = await videoTrack.getDisplayHeight();
  const inSeconds = await videoTrack.computeDuration();
  const outSeconds = inSeconds / SPEED;

  // Output canvas is always 9:16. Height matches the source's longer dimension
  // (in the 9:16 sense) so we don't downscale portrait clips.
  const outH = Math.max(srcH, Math.round((srcW * 16) / 9));
  const outW = Math.round((outH * 9) / 16);

  // Content box (chosen aspect), centered inside the 9:16 canvas.
  const boxAspect = ASPECTS[aspect];
  let boxW = outW;
  let boxH = Math.round(outW / boxAspect);
  if (boxH > outH) {
    boxH = outH;
    boxW = Math.round(outH * boxAspect);
  }
  const boxX = Math.round((outW - boxW) / 2);
  const boxY = Math.round((outH - boxH) / 2);

  // Cover-fit source inside the content box.
  const coverScale = Math.max(boxW / srcW, boxH / srcH);
  const drawW = srcW * coverScale;
  const drawH = srcH * coverScale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;

  // Source bitrate (video only), matched with a floor for quality preservation.
  const videoStats = await videoTrack.computePacketStats(200);
  const targetBitrate = Math.max(
    Math.round(videoStats.averageBitrate) || 0,
    BITRATE_FLOOR,
  );

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas context unavailable");

  const logo = await loadLogo();
  const logoW = Math.round(outW * LOGO.widthRatio);
  const logoH = Math.round((logo.height / logo.width) * logoW);
  const logoX = outW - logoW - Math.round(outW * LOGO.rightRatio);
  const logoY = Math.round(outH * LOGO.topRatio);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: targetBitrate,
    keyFrameInterval: 5,
    onEncoderConfig: (cfg) => {
      // Bias for throughput over latency-hiding — matters on long clips.
      (cfg as VideoEncoderConfig).latencyMode = "realtime";
    },
  });
  output.addVideoTrack(videoSource);

  let audioSource: EncodedAudioPacketSource | null = null;
  if (audioTrack) {
    const audioCodec = await audioTrack.getCodec();
    if (audioCodec) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  // ── Video pass ─────────────────────────────────────────────────────
  const videoSink = new VideoSampleSink(videoTrack);
  const videoPass = (async () => {
    for await (const sample of videoSink.samples()) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);

      // Clip to the content box so cover-scaled source doesn't spill out.
      ctx.save();
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.clip();
      sample.draw(ctx, drawX, drawY, drawW, drawH);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = LOGO.opacity;
      ctx.drawImage(logo, logoX, logoY, logoW, logoH);
      ctx.restore();

      const scaledTs = sample.timestamp / SPEED;
      const scaledDur = Math.max(sample.duration / SPEED, 1 / 240);
      await videoSource.add(scaledTs, scaledDur);

      if (inSeconds > 0) {
        onProgress(Math.min(0.99, sample.timestamp / inSeconds));
      }
      sample.close();
    }
    videoSource.close();
  })();

  // ── Audio pass (passthrough, retimed) ──────────────────────────────
  const audioPass = (async () => {
    if (!audioSource || !audioTrack) return;
    const decoderConfig = await audioTrack.getDecoderConfig();
    const packetSink = new EncodedPacketSink(audioTrack);
    let first = true;
    for await (const packet of packetSink.packets()) {
      const startTs = packet.timestamp / SPEED;
      const endTs = startTs + packet.duration / SPEED;
      // AAC priming produces negative-timestamped packets. Skip any that end
      // at or before zero, and clamp the first partial one to 0 so the muxer
      // sees a valid non-negative stream.
      if (endTs <= 0) continue;
      const ts = Math.max(0, startTs);
      const dur = endTs - ts;
      const retimed = packet.clone({ timestamp: ts, duration: dur });
      const meta = first && decoderConfig ? { decoderConfig } : undefined;
      first = false;
      await audioSource.add(retimed, meta);
    }
    audioSource.close();
  })();

  await Promise.all([videoPass, audioPass]);
  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Encoder produced no output");
  const blob = new Blob([buffer], { type: "video/mp4" });
  const outName = file.name.replace(/\.[^.]+$/, "") + " · Vernavle.mp4";
  const outFile = new File([blob], outName, { type: "video/mp4" });

  return {
    blob,
    outFile,
    elapsedMs: performance.now() - t0,
    inSeconds,
    outSeconds,
    width: outW,
    height: outH,
  };
}

// ── UI helpers ────────────────────────────────────────────────────────────
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtSec(s: number): string {
  return `${s.toFixed(2)}s`;
}

// ── Download ─────────────────────────────────────────────────────────────
function saveJob(job: Job) {
  if (job.state.kind !== "done") return;
  const { outFile, blob } = job.state;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outFile.name;
  a.rel = "noopener";
  // iOS Safari needs the anchor to be in the DOM and clicked in the user
  // gesture; some builds also honor target="_blank" better for blob downloads.
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function RepurposePage() {
  const [support, setSupport] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [aspect, setAspect] = useState<AspectKey>("9:16");
  const aspectRef = useRef<AspectKey>("9:16");
  const runningRef = useRef(false);
  // Pending job ids waiting to be processed, in FIFO order. Lives in a ref
  // (not state) so the queue loop reads a stable, mutation-safe source that
  // isn't affected by React 19 strict-mode updater double-invocation.
  const queueRef = useRef<Job[]>([]);

  useEffect(() => {
    setSupport(checkSupport());
  }, []);

  useEffect(() => {
    aspectRef.current = aspect;
  }, [aspect]);

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        const asp = aspectRef.current;
        updateJob(next.id, { state: { kind: "processing", progress: 0 } });
        try {
          const result = await processFile(next.file, asp, (p) => {
            updateJob(next.id, { state: { kind: "processing", progress: p } });
          });
          updateJob(next.id, { state: { kind: "done", ...result } });
        } catch (err) {
          updateJob(next.id, {
            state: {
              kind: "error",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [updateJob]);

  const onPick = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const added: Job[] = Array.from(files).map((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        state: { kind: "queued" as const },
      }));
      queueRef.current.push(...added);
      setJobs((prev) => [...prev, ...added]);
      queueMicrotask(() => {
        void runQueue();
      });
    },
    [runQueue],
  );

  const queuedCount = useMemo(
    () => jobs.filter((j) => j.state.kind === "queued").length,
    [jobs],
  );

  if (support === null) {
    return <main className="min-h-dvh bg-black" />;
  }

  if (!support.ok) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-black text-white px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-2xl font-medium mb-3">Browser not supported</h1>
          <p className="text-white/70 text-sm leading-relaxed">
            Repurpose needs WebCodecs, which runs on Safari 17+ or a recent Chrome.
            Open this page in one of those and try again.
          </p>
          {support.reason ? (
            <p className="text-white/40 text-xs mt-4">({support.reason})</p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-dvh bg-black text-white flex flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="px-5 pt-4 pb-2">
        <h1 className="text-xl font-medium tracking-tight">Repurpose</h1>
        <p className="text-white/50 text-sm mt-1">
          Watermark · 1.05× · on-device
        </p>
      </header>

      <section className="px-5 pt-4 space-y-3">
        <label
          className="block w-full rounded-2xl bg-white text-black text-center py-6 text-lg font-medium active:opacity-80 select-none cursor-pointer"
        >
          Pick reels
          <input
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPick(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-white/60 text-xs uppercase tracking-wider">
              Aspect (in 9:16)
            </span>
            {queuedCount > 0 ? (
              <span className="text-white/40 text-[11px]">
                applies to {queuedCount} queued
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ASPECT_KEYS.map((k) => {
              const active = aspect === k;
              return (
                <button
                  key={k}
                  onClick={() => setAspect(k)}
                  className={
                    "rounded-xl py-3 text-sm font-medium border transition-colors " +
                    (active
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white/80 border-white/10 active:bg-white/10")
                  }
                >
                  {k}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-white/40 text-xs text-center">
          Multiple OK · processed one at a time
        </p>
      </section>

      <section className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {jobs.length === 0 ? (
          <div className="text-white/30 text-sm text-center pt-16">
            Queued clips will show here.
          </div>
        ) : null}
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} onSave={() => saveJob(job)} />
        ))}
      </section>
    </main>
  );
}

// ── Job row ──────────────────────────────────────────────────────────────
function JobRow({ job, onSave }: { job: Job; onSave: () => void }) {
  const name = job.file.name;
  const size = fmtBytes(job.file.size);

  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-white/40 text-xs mt-0.5">{size}</div>
        </div>
        <StateBadge state={job.state} />
      </div>

      {job.state.kind === "processing" ? (
        <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-white transition-[width] duration-150"
            style={{ width: `${Math.round(job.state.progress * 100)}%` }}
          />
        </div>
      ) : null}

      {job.state.kind === "error" ? (
        <div className="mt-3 text-xs text-red-300/90">{job.state.message}</div>
      ) : null}

      {job.state.kind === "done" ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-white/50 text-xs">
            {fmtBytes(job.state.blob.size)} · {job.state.width}×{job.state.height}
            {" · "}
            {fmtSec(job.state.outSeconds)} · {(job.state.elapsedMs / 1000).toFixed(1)}s
          </div>
          <button
            onClick={onSave}
            className="rounded-full bg-white text-black text-sm font-medium px-4 py-2 active:opacity-80"
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StateBadge({ state }: { state: JobState }) {
  const label =
    state.kind === "queued"
      ? "Queued"
      : state.kind === "processing"
        ? `${Math.round(state.progress * 100)}%`
        : state.kind === "done"
          ? "Ready"
          : "Error";
  return (
    <span className="text-[11px] uppercase tracking-wider text-white/60 shrink-0">
      {label}
    </span>
  );
}
