"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const LOGO = {
  src: "/brand/vernavle-logo.png",
  widthRatio: 0.12, // fraction of video width
  topRatio: 0.02, // top margin as fraction of video height
  opacity: 0.9,
};

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

  const displayWidth = await videoTrack.getDisplayWidth();
  const displayHeight = await videoTrack.getDisplayHeight();
  const inSeconds = await videoTrack.computeDuration();
  const outSeconds = inSeconds / SPEED;

  // Source bitrate (video only), matched with a floor for quality preservation.
  const videoStats = await videoTrack.computePacketStats(200);
  const targetBitrate = Math.max(
    Math.round(videoStats.averageBitrate) || 0,
    BITRATE_FLOOR,
  );

  // Compose canvas at source display resolution.
  const canvas = new OffscreenCanvas(displayWidth, displayHeight);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas context unavailable");

  const logo = await loadLogo();
  const logoW = Math.round(displayWidth * LOGO.widthRatio);
  const logoH = Math.round((logo.height / logo.width) * logoW);
  const logoX = Math.round((displayWidth - logoW) / 2);
  const logoY = Math.round(displayHeight * LOGO.topRatio);

  // Output.
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: targetBitrate,
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
      ctx.fillRect(0, 0, displayWidth, displayHeight);
      sample.drawWithFit(ctx, { fit: "fill" });
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
      const retimed = packet.clone({
        timestamp: packet.timestamp / SPEED,
        duration: packet.duration / SPEED,
      });
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
    width: displayWidth,
    height: displayHeight,
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

// ── Share / download ─────────────────────────────────────────────────────
async function saveJob(job: Job) {
  if (job.state.kind !== "done") return;
  const { outFile, blob } = job.state;
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (nav.canShare?.({ files: [outFile] }) && nav.share) {
    try {
      await nav.share({ files: [outFile], title: outFile.name });
      return;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outFile.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function RepurposePage() {
  const [support, setSupport] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    setSupport(checkSupport());
  }, []);

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (true) {
        let next: Job | undefined;
        setJobs((prev) => {
          next = prev.find((j) => j.state.kind === "queued");
          return prev;
        });
        // wait a microtask for setJobs to settle
        await Promise.resolve();
        if (!next) break;
        updateJob(next.id, { state: { kind: "processing", progress: 0 } });
        try {
          const result = await processFile(next.file, (p) => {
            updateJob(next!.id, { state: { kind: "processing", progress: p } });
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
      setJobs((prev) => [...prev, ...added]);
      // kick the queue after state update
      queueMicrotask(() => {
        void runQueue();
      });
    },
    [runQueue],
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

      <section className="px-5 pt-4">
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
        <p className="text-white/40 text-xs mt-2 text-center">
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
          <JobRow key={job.id} job={job} onSave={() => void saveJob(job)} />
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
