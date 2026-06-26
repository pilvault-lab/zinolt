"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STAGE_W = 1080;
const STAGE_H = 1920;
const VIDEO_W = Math.round(STAGE_W * 0.88); // 950
const VIDEO_H = Math.round(VIDEO_W * (9 / 16)); // 534
const VIDEO_X = (STAGE_W - VIDEO_W) / 2;
const VIDEO_Y = (STAGE_H - VIDEO_H) / 2;

// roundRect was added to TypeScript lib in TS 5.1; guard for older envs
type Ctx2D = CanvasRenderingContext2D & {
  roundRect?(x: number, y: number, w: number, h: number, radii: number): void;
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const m of [
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="font-sans text-[11px] uppercase tracking-widest"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function BgSwatch({
  label,
  bg,
  fg,
  active,
  onClick,
}: {
  label: string;
  bg: string;
  fg: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded py-2 font-sans text-xs transition-all"
      style={{
        backgroundColor: bg,
        color: fg,
        border: "none",
        outline: active ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
        outlineOffset: 2,
      }}
    >
      {label}
    </button>
  );
}

export default function LetterboxCardPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs for the draw loop — avoids stale closures in the rAF callback
  const bgRef = useRef("#0A0A0A");
  const isRecordingRef = useRef(false);

  const [scale, setScale] = useState(0.2);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const [startOffset, setStartOffset] = useState(0);
  const [isDark, setIsDark] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  // Keep refs in sync with state
  useEffect(() => {
    bgRef.current = isDark ? "#0A0A0A" : "#F5F5F5";
  }, [isDark]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Container resize → CSS scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const pad = 56;
        const s = Math.min(
          (width - pad * 2) / STAGE_W,
          (height - pad * 2) / STAGE_H,
        );
        setScale(Math.max(0.04, s));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Persistent rAF draw loop — stable, reads everything from refs
  useEffect(() => {
    let handle: number;
    function loop() {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d") as Ctx2D | null;
        if (ctx) {
          ctx.fillStyle = bgRef.current;
          ctx.fillRect(0, 0, STAGE_W, STAGE_H);

          if (video && video.readyState >= 2) {
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(VIDEO_X, VIDEO_Y, VIDEO_W, VIDEO_H, 28);
            } else {
              ctx.rect(VIDEO_X, VIDEO_Y, VIDEO_W, VIDEO_H);
            }
            ctx.clip();
            ctx.drawImage(video, VIDEO_X, VIDEO_Y, VIDEO_W, VIDEO_H);
            ctx.restore();
          }
        }
      }
      handle = requestAnimationFrame(loop);
    }
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, []);

  const loadVideo = useCallback((file: File) => {
    setVideoName(file.name);
    const url = URL.createObjectURL(file);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  // Seek + play for preview whenever URL or offset changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (isRecordingRef.current) return;
    const setup = () => {
      video.currentTime = startOffset;
      video.play().catch(() => {});
    };
    if (video.readyState >= 1) {
      setup();
    } else {
      video.addEventListener("loadedmetadata", setup, { once: true });
      return () => video.removeEventListener("loadedmetadata", setup);
    }
  }, [videoUrl, startOffset]);

  // Revoke blob URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const handleRecord = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !videoUrl || isRecordingRef.current) return;

    const mimeType = pickMimeType();
    const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const chunks: Blob[] = [];

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `letterbox-card.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setIsRecording(false);
      video.loop = true;
      video.currentTime = startOffset;
      video.play().catch(() => {});
    };

    const startCapture = () => {
      video
        .play()
        .then(() => recorder.start())
        .catch(() => {
          setIsRecording(false);
          video.loop = true;
        });
    };

    video.loop = false;
    setIsRecording(true);

    video.addEventListener(
      "ended",
      () => {
        if (recorder.state === "recording") recorder.stop();
      },
      { once: true },
    );

    // If already at the right position, start immediately; otherwise seek first
    if (Math.abs(video.currentTime - startOffset) < 0.1) {
      startCapture();
    } else {
      video.addEventListener("seeked", startCapture, { once: true });
      video.currentTime = startOffset;
    }
  }, [videoUrl, startOffset]);

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "#181818" }}>
      {/* ── Sidebar ── */}
      <aside
        className="flex shrink-0 flex-col gap-5 overflow-y-auto"
        style={{
          width: 280,
          padding: 24,
          backgroundColor: "#0F0F0F",
          borderRight: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <p
          className="font-sans text-[11px] uppercase tracking-widest"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          Letterbox Card
        </p>

        <Field label="Video file">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded text-center transition-colors"
            style={{
              border: "1.5px dashed rgba(255,255,255,0.18)",
              padding: "14px 12px",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor =
                "rgba(255,255,255,0.38)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor =
                "rgba(255,255,255,0.18)";
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadVideo(f);
                e.target.value = "";
              }}
            />
            {videoName ? (
              <p
                className="break-all font-sans text-xs"
                style={{ color: "rgba(255,255,255,0.65)" }}
              >
                {videoName}
              </p>
            ) : (
              <p
                className="font-sans text-xs"
                style={{ color: "rgba(255,255,255,0.28)" }}
              >
                Click to browse · MP4, MOV, WebM
              </p>
            )}
          </div>
        </Field>

        <Field label="Start at (s)">
          <input
            type="number"
            min={0}
            step={0.1}
            value={startOffset}
            onChange={(e) =>
              setStartOffset(Math.max(0, Number(e.target.value)))
            }
            className="w-full rounded px-3 py-2 font-sans text-sm text-white"
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              outline: "none",
            }}
          />
        </Field>

        <Field label="Background">
          <div className="flex gap-2">
            <BgSwatch
              label="Dark"
              bg="#0A0A0A"
              fg="#F5F5F5"
              active={isDark}
              onClick={() => setIsDark(true)}
            />
            <BgSwatch
              label="Light"
              bg="#F5F5F5"
              fg="#0A0A0A"
              active={!isDark}
              onClick={() => setIsDark(false)}
            />
          </div>
        </Field>

        {/* Spacer + record button + debug info pinned to bottom */}
        <div className="mt-auto flex flex-col gap-4">
          <button
            type="button"
            onClick={handleRecord}
            disabled={!videoUrl || isRecording}
            className="w-full rounded px-4 py-2.5 font-sans text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              backgroundColor: "#FFFFFF",
              color: "#000000",
              border: "none",
            }}
          >
            {isRecording ? "Recording…" : "Record & download"}
          </button>

          <div
            className="font-sans text-[10px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.18)" }}
          >
            Stage: {STAGE_W}×{STAGE_H}
            <br />
            Scale: {(scale * 100).toFixed(0)}%
          </div>
        </div>
      </aside>

      {/* ── Stage area ── */}
      <main
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-hidden"
      >
        {/*
          Outer wrapper sized to the visual (scaled) dimensions so flex
          centering works. Canvas lives at full 1080×1920 and is scaled
          via CSS transform — the recorded stream captures the unscaled buffer.
        */}
        <div
          style={{
            width: STAGE_W * scale,
            height: STAGE_H * scale,
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* Hidden video — frame source for the draw loop and MediaRecorder */}
          <video
            ref={videoRef}
            src={videoUrl || undefined}
            muted
            playsInline
            loop
            style={{ display: "none" }}
          />

          {/* Canvas — 1080×1920 internal buffer, CSS-scaled for preview */}
          <canvas
            ref={canvasRef}
            width={STAGE_W}
            height={STAGE_H}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </main>
    </div>
  );
}
