"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  mode: "full-bleed" | "letterboxed";
  cropOffsetX: number; // 0..1
  onCropOffsetChange: (v: number) => void;
  onTimeUpdate: (t: number) => void;
  onDuration: (d: number) => void;
  onReady?: () => void;
  registerGrab: (fn: () => number | null) => void;
  registerSeek: (fn: (sec: number) => void) => void;
  registerCaptureThumb: (
    fn: (sec: number) => Promise<string | null>,
  ) => void;
  registerCaptureFullFrame: (
    fn: (sec: number) => Promise<Blob | null>,
  ) => void;
};

/** Draw the current video frame into a 1080x1920 canvas with the given crop/mode. */
function drawFrameTo1080(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  mode: "full-bleed" | "letterboxed",
  cropOffsetX: number,
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const W = 1080;
  const H = 1920;
  if (!vw || !vh) return;
  if (mode === "letterboxed") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, 0, 0, vw, vh, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const cropW = Math.min(vw, (vh * 9) / 16);
    const cropH = Math.min(vh, (vw * 16) / 9);
    const cropX = (vw - cropW) * cropOffsetX;
    const cropY = (vh - cropH) / 2;
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, W, H);
  }
}

/**
 * Video player with a draggable 9:16 crop overlay (for full-bleed mode)
 * and a live preview pane showing what the exported crop will look like.
 */
export function VideoStage({
  src,
  mode,
  cropOffsetX,
  onCropOffsetChange,
  onTimeUpdate,
  onDuration,
  onReady,
  registerGrab,
  registerSeek,
  registerCaptureThumb,
  registerCaptureFullFrame,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const [dragging, setDragging] = useState(false);

  // Wire up parent-invoked helpers.
  useEffect(() => {
    registerGrab(() => {
      const v = videoRef.current;
      if (!v) return null;
      return v.currentTime;
    });
    registerSeek((sec) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || sec, sec));
    });
    registerCaptureThumb(async (sec) => {
      const v = videoRef.current;
      if (!v) return null;
      const wasPaused = v.paused;
      const prev = v.currentTime;
      // Seek, wait for frame, draw.
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        };
        v.addEventListener("seeked", onSeeked, { once: true });
        v.currentTime = sec;
        // Fallback timeout in case seek doesn't fire cleanly.
        setTimeout(resolve, 800);
      });
      const c = document.createElement("canvas");
      const targetW = 108;
      const targetH = 192;
      c.width = targetW;
      c.height = targetH;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      // Draw the same crop the export would use.
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!vw || !vh) return null;
      if (mode === "letterboxed") {
        // Fit the whole frame into 9:16, black bars.
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, targetW, targetH);
        const scale = Math.min(targetW / vw, targetH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (targetW - dw) / 2;
        const dy = (targetH - dh) / 2;
        ctx.drawImage(v, 0, 0, vw, vh, dx, dy, dw, dh);
      } else {
        const cropW = Math.min(vw, (vh * 9) / 16);
        const cropH = Math.min(vh, (vw * 16) / 9);
        const cropX = (vw - cropW) * cropOffsetX;
        const cropY = (vh - cropH) / 2;
        ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
      }
      // Restore playback state.
      if (!wasPaused) void v.play().catch(() => {});
      // Only restore prev if we didn't want to stay at `sec`.
      void prev;
      return c.toDataURL("image/jpeg", 0.7);
    });
    registerCaptureFullFrame(async (sec) => {
      const v = videoRef.current;
      if (!v) return null;
      // Pause during extraction so seeks are stable.
      const wasPaused = v.paused;
      if (!wasPaused) v.pause();
      // Seek precisely.
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        };
        v.addEventListener("seeked", onSeeked, { once: true });
        v.currentTime = sec;
        setTimeout(resolve, 1500);
      });
      // Some browsers signal 'seeked' before the frame is truly ready; give it a rAF.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const c = document.createElement("canvas");
      c.width = 1080;
      c.height = 1920;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      drawFrameTo1080(ctx, v, mode, cropOffsetX);
      const blob = await new Promise<Blob | null>((res) =>
        c.toBlob((b) => res(b), "image/jpeg", 0.92),
      );
      if (!wasPaused) void v.play().catch(() => {});
      return blob;
    });
  }, [
    registerGrab,
    registerSeek,
    registerCaptureThumb,
    registerCaptureFullFrame,
    mode,
    cropOffsetX,
  ]);

  // Live preview canvas (renders on every animation frame while playing / on scrub).
  useEffect(() => {
    let raf = 0;
    // Preview is 135x240 but drawFrameTo1080 outputs 1080x1920 — instead reuse
    // the same crop math at preview size by scaling the canvas transform.
    const draw = () => {
      const v = videoRef.current;
      const c = previewCanvasRef.current;
      if (v && c && v.videoWidth && v.videoHeight) {
        const ctx = c.getContext("2d");
        if (ctx) {
          const targetW = c.width;
          const targetH = c.height;
          const vw = v.videoWidth;
          const vh = v.videoHeight;
          if (mode === "letterboxed") {
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, targetW, targetH);
            const scale = Math.min(targetW / vw, targetH / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            ctx.drawImage(v, 0, 0, vw, vh, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
          } else {
            const cropW = Math.min(vw, (vh * 9) / 16);
            const cropH = Math.min(vh, (vw * 16) / 9);
            const cropX = (vw - cropW) * cropOffsetX;
            const cropY = (vh - cropH) / 2;
            ctx.drawImage(v, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, cropOffsetX]);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    onDuration(v.duration || 0);
    onReady?.();
  }, [onDuration, onReady]);

  const onTime = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    onTimeUpdate(v.currentTime);
  }, [onTimeUpdate]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration || sec, sec));
  };

  const step = (delta: number) => seek(currentTime + delta);

  // Crop overlay drag.
  const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "full-bleed") return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || mode !== "full-bleed") return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    // Displayed video size within the stage (letterboxed if aspect mismatch).
    const stageAspect = rect.width / rect.height;
    const vAspect = videoSize.w / videoSize.h;
    let dispW: number;
    let dispLeft: number;
    if (stageAspect > vAspect) {
      // Stage is wider — video is height-fitted.
      dispW = rect.height * vAspect;
      dispLeft = rect.left + (rect.width - dispW) / 2;
    } else {
      dispW = rect.width;
      dispLeft = rect.left;
    }
    // Crop box width in display units = dispHeight * 9/16.
    const dispH = stageAspect > vAspect ? rect.height : rect.width / vAspect;
    const cropDispW = dispH * (9 / 16);
    const usable = dispW - cropDispW;
    if (usable <= 0) return;
    const x = e.clientX - dispLeft - cropDispW / 2;
    const clamped = Math.max(0, Math.min(usable, x));
    onCropOffsetChange(clamped / usable);
  };
  const onOverlayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // Compute overlay geometry from displayed video area.
  const stageRect = stageRef.current?.getBoundingClientRect();
  const vAspect = videoSize.w / videoSize.h || 16 / 9;
  let dispW = 0;
  let dispH = 0;
  let dispLeftPct = 0;
  let dispTopPct = 0;
  if (stageRect) {
    const stageAspect = stageRect.width / stageRect.height;
    if (stageAspect > vAspect) {
      dispH = stageRect.height;
      dispW = dispH * vAspect;
      dispLeftPct = ((stageRect.width - dispW) / 2 / stageRect.width) * 100;
      dispTopPct = 0;
    } else {
      dispW = stageRect.width;
      dispH = dispW / vAspect;
      dispLeftPct = 0;
      dispTopPct = ((stageRect.height - dispH) / 2 / stageRect.height) * 100;
    }
  }
  const cropDispW = dispH * (9 / 16);
  const cropUsable = Math.max(0, dispW - cropDispW);
  const cropLeftPx = cropUsable * cropOffsetX;
  const cropLeftPct = stageRect
    ? ((cropLeftPx + (dispLeftPct / 100) * stageRect.width) / stageRect.width) * 100
    : 0;
  const cropWidthPct = stageRect ? (cropDispW / stageRect.width) * 100 : 0;

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row">
        {/* Video + crop overlay */}
        <div
          ref={stageRef}
          className="relative w-full overflow-hidden rounded-md border border-ds-border-hairline bg-black"
          style={{ aspectRatio: "16 / 9" }}
        >
          <video
            ref={videoRef}
            src={src}
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTime}
            onEnded={() => setPlaying(false)}
            className="h-full w-full object-contain"
            preload="metadata"
            playsInline
          />
          {mode === "letterboxed" && stageRect ? (
            // Show letterbox bars visualization: the whole displayed video is used.
            <div
              className="pointer-events-none absolute border border-yellow-400/60"
              style={{
                left: `${dispLeftPct}%`,
                top: `${dispTopPct}%`,
                width: `${(dispW / stageRect.width) * 100}%`,
                height: `${(dispH / stageRect.height) * 100}%`,
              }}
            />
          ) : null}
          {mode === "full-bleed" && stageRect ? (
            <div
              onPointerDown={onOverlayPointerDown}
              onPointerMove={onOverlayPointerMove}
              onPointerUp={onOverlayPointerUp}
              className="absolute cursor-ew-resize"
              style={{
                left: `${cropLeftPct}%`,
                top: `${dispTopPct}%`,
                width: `${cropWidthPct}%`,
                height: `${(dispH / stageRect.height) * 100}%`,
                boxShadow: "0 0 0 2px rgba(255,180,80,0.9), 0 0 0 9999px rgba(0,0,0,0.35)",
                touchAction: "none",
              }}
              title="Drag horizontally to move the 9:16 crop"
            >
              <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-1 text-[10px] uppercase tracking-widest text-yellow-300/90">
                9:16 crop
              </div>
            </div>
          ) : null}
        </div>

        {/* Live crop preview */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="text-[10px] uppercase tracking-widest text-ds-on-surface-muted">
            live crop
          </div>
          <canvas
            ref={previewCanvasRef}
            width={135}
            height={240}
            className="rounded-md border border-ds-border-hairline bg-black"
            style={{ width: 135, height: 240 }}
          />
          <div className="text-[10px] tabular-nums text-ds-on-surface-muted">
            1080×1920 · offset {(cropOffsetX * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-3 py-1.5 text-sm hover:opacity-80"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => step(-1 / 30)}
          className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-xs hover:opacity-80"
          title="Step back 1 frame"
        >
          ◀|
        </button>
        <button
          onClick={() => step(1 / 30)}
          className="rounded-md border border-ds-border-hairline bg-ds-surface-raised px-2 py-1.5 text-xs hover:opacity-80"
          title="Step forward 1 frame"
        >
          |▶
        </button>
        <span className="text-xs tabular-nums text-ds-on-surface-muted">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.05}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-ds-primary"
        />
      </div>
    </div>
  );
}
