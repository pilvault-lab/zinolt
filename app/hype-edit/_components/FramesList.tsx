"use client";

import React, { useEffect, useRef, useState } from "react";
import type { HypeFrame } from "@/lib/hype-edit/types";
import { UI } from "./ui";

type Props = {
  frames: HypeFrame[];
  onReorder: (nextOrder: HypeFrame[]) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, patch: Partial<HypeFrame>) => void;
};

type Dims = { w: number; h: number };

/** Composition is 1080×1920. Hard bar per source kind:
 *   image → long side ≥ 1920 AND short side ≥ 1080 (1920×1080 minimum)
 *   video → long side ≥ 1280 AND short side ≥ 720  (720p minimum)
 *  Anything below → red LOW RES flag. */
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const IMG_MIN_LONG = 1920;
const IMG_MIN_SHORT = 1080;
const VID_MIN_LONG = 1280;
const VID_MIN_SHORT = 720;

function minsFor(kind: "image" | "video" | "solid"): { long: number; short: number } {
  return kind === "video"
    ? { long: VID_MIN_LONG, short: VID_MIN_SHORT }
    : { long: IMG_MIN_LONG, short: IMG_MIN_SHORT };
}

function isLowRes(d: Dims, kind: "image" | "video" | "solid"): boolean {
  const { long, short } = minsFor(kind);
  const l = Math.max(d.w, d.h);
  const s = Math.min(d.w, d.h);
  return l < long || s < short;
}

function upscaleFactor(d: Dims): number {
  return Math.max(CANVAS_W / d.w, CANVAS_H / d.h);
}

function minLabel(kind: "image" | "video" | "solid"): string {
  return kind === "video" ? "1280×720" : "1920×1080";
}

function resolveSrc(src: string): string {
  return src.startsWith("blob:") ||
    src.startsWith("http") ||
    src.startsWith("data:")
    ? src
    : `/${src}`;
}

export const FramesList: React.FC<Props> = ({
  frames,
  onReorder,
  onDelete,
}) => {
  const dragIdRef = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dims, setDims] = useState<Record<string, Dims>>({});
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    const from = dragIdRef.current;
    dragIdRef.current = null;
    setOverId(null);
    if (!from || from === targetId) return;
    const src = frames.findIndex((f) => f.id === from);
    const dst = frames.findIndex((f) => f.id === targetId);
    if (src < 0 || dst < 0) return;
    const next = [...frames];
    const [moved] = next.splice(src, 1);
    next.splice(dst, 0, moved);
    onReorder(next);
  };

  const setDim = (id: string, d: Dims) =>
    setDims((prev) => (prev[id] ? prev : { ...prev, [id]: d }));

  const lightboxFrame = lightboxId
    ? frames.find((f) => f.id === lightboxId) ?? null
    : null;

  // Escape to close lightbox.
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxId]);

  if (frames.length === 0) {
    return (
      <div
        style={{
          padding: "18px 12px",
          textAlign: "center",
          color: UI.muted,
          fontSize: 12,
          border: `1px dashed ${UI.border}`,
          borderRadius: 10,
          lineHeight: 1.5,
        }}
      >
        No frames yet.
        <br />
        Hit <b>+ Add frame</b> to start.
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {frames.map((f, i) => {
          const d = dims[f.id];
          const scale = d ? upscaleFactor(d) : 0;
          const lowRes = d ? isLowRes(d, f.kind) : false;
          const minStr = minLabel(f.kind);
          return (
            <div
              key={f.id}
              draggable
              onDragStart={() => {
                dragIdRef.current = f.id;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overId !== f.id) setOverId(f.id);
              }}
              onDragLeave={() => setOverId(null)}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(f.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                border: `1px solid ${overId === f.id ? UI.ink : UI.border}`,
                borderRadius: 10,
                background: "#FFF",
              }}
            >
              <GripIcon />
              <button
                type="button"
                onClick={() =>
                  f.kind !== "solid" ? setLightboxId(f.id) : null
                }
                title={
                  f.kind === "solid" ? "Solid colour" : "Click to preview"
                }
                style={{
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: f.kind === "solid" ? "default" : "zoom-in",
                  flexShrink: 0,
                }}
              >
                <FrameThumb
                  frame={f}
                  onDims={(dd) => setDim(f.id, dd)}
                />
              </button>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: UI.ink,
                  }}
                >
                  <span>#{i + 1} · {typeLabel(f)}</span>
                  {lowRes ? (
                    <span
                      title={`Below ${minStr} minimum · needs ${scale.toFixed(2)}× upscale to fill 1080×1920`}
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        color: "#B04040",
                        background: "rgba(176,64,64,0.10)",
                        border: "1px solid rgba(176,64,64,0.30)",
                        padding: "1px 5px",
                        borderRadius: 4,
                      }}
                    >
                      LOW RES
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: UI.muted,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={
                    f.kind === "solid"
                      ? f.color
                      : d
                      ? `${d.w} × ${d.h}${
                          lowRes
                            ? ` · below ${minStr} · needs ${scale.toFixed(
                                2,
                              )}× upscale`
                            : ""
                        }`
                      : f.src ?? ""
                  }
                >
                  {f.kind === "solid"
                    ? f.color
                    : d
                    ? `${d.w} × ${d.h}`
                    : "measuring…"}
                </div>
              </div>
              <button
                onClick={() => onDelete(f.id)}
                title="Delete frame"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 4,
                  cursor: "pointer",
                  color: UI.muted,
                }}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
      </div>

      {lightboxFrame ? (
        <Lightbox
          frame={lightboxFrame}
          dims={dims[lightboxFrame.id]}
          onClose={() => setLightboxId(null)}
        />
      ) : null}
    </>
  );
};

const FrameThumb: React.FC<{
  frame: HypeFrame;
  onDims?: (d: Dims) => void;
}> = ({ frame, onDims }) => {
  const style: React.CSSProperties = {
    width: 44,
    height: 26, // 16:9 mini
    borderRadius: 4,
    overflow: "hidden",
    background: "#000",
    flexShrink: 0,
    display: "block",
  };
  if (frame.kind === "solid") {
    return <div style={{ ...style, background: frame.color ?? "#111" }} />;
  }
  if (!frame.src) return <div style={style} />;
  const src = resolveSrc(frame.src);
  if (frame.kind === "video") {
    return (
      <div style={style}>
        <video
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              onDims?.({ w: v.videoWidth, h: v.videoHeight });
            }
          }}
        />
      </div>
    );
  }
  return (
    <div style={style}>
      <img
        src={src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onLoad={(e) => {
          const im = e.currentTarget;
          if (im.naturalWidth && im.naturalHeight) {
            onDims?.({ w: im.naturalWidth, h: im.naturalHeight });
          }
        }}
      />
    </div>
  );
};

const Lightbox: React.FC<{
  frame: HypeFrame;
  dims: Dims | undefined;
  onClose: () => void;
}> = ({ frame, dims, onClose }) => {
  if (!frame.src) return null;
  const src = resolveSrc(frame.src);
  const scale = dims ? upscaleFactor(dims) : 0;
  const lowRes = dims ? isLowRes(dims, frame.kind) : false;
  const minStr = minLabel(frame.kind);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out",
        padding: 24,
      }}
    >
      {frame.kind === "video" ? (
        <video
          src={src}
          controls
          autoPlay
          loop
          playsInline
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            background: "#000",
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            cursor: "default",
          }}
        />
      )}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 20,
          textAlign: "center",
          color: "rgba(255,255,255,0.85)",
          fontSize: 12,
          fontFamily:
            '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
          letterSpacing: 0.3,
          pointerEvents: "none",
        }}
      >
        {dims ? (
          <>
            {dims.w} × {dims.h}
            {lowRes ? (
              <span
                style={{
                  marginLeft: 10,
                  color: "#FF8B8B",
                  fontWeight: 700,
                }}
              >
                LOW RES · below {minStr} (needs {scale.toFixed(2)}× upscale)
              </span>
            ) : null}
          </>
        ) : (
          "measuring…"
        )}
        <div style={{ opacity: 0.55, marginTop: 4, fontSize: 10 }}>
          Click anywhere / press Esc to close
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          width: 34,
          height: 34,
          borderRadius: 999,
          background: "rgba(255,255,255,0.12)",
          border: "1px solid rgba(255,255,255,0.25)",
          color: "#FFF",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>
    </div>
  );
};

function typeLabel(f: HypeFrame): string {
  if (f.kind === "solid") return `Solid · ${f.color ?? "#000"}`;
  if (f.kind === "video") return "Video";
  return "Image";
}

const GripIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    style={{ color: UI.muted, cursor: "grab" }}
    fill="currentColor"
  >
    <circle cx="7" cy="5" r="1.4" />
    <circle cx="7" cy="10" r="1.4" />
    <circle cx="7" cy="15" r="1.4" />
    <circle cx="13" cy="5" r="1.4" />
    <circle cx="13" cy="10" r="1.4" />
    <circle cx="13" cy="15" r="1.4" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
  </svg>
);
