"use client";

import React, { useRef, useState } from "react";
import type { HypeFrame } from "@/lib/hype-edit/types";
import { UI } from "./ui";

type Props = {
  frames: HypeFrame[];
  onReorder: (nextOrder: HypeFrame[]) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, patch: Partial<HypeFrame>) => void;
};

export const FramesList: React.FC<Props> = ({
  frames,
  onReorder,
  onDelete,
}) => {
  const dragIdRef = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {frames.map((f, i) => (
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
          <FrameThumb frame={f} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: UI.ink }}>
              #{i + 1} · {typeLabel(f)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: UI.muted,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={f.src ?? f.color}
            >
              {f.session ? "(session-only) " : ""}
              {f.src ?? f.color ?? ""}
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
      ))}
    </div>
  );
};

const FrameThumb: React.FC<{ frame: HypeFrame }> = ({ frame }) => {
  const style: React.CSSProperties = {
    width: 44,
    height: 26, // 16:9 mini
    borderRadius: 4,
    overflow: "hidden",
    background: "#000",
    flexShrink: 0,
  };
  if (frame.kind === "solid") {
    return <div style={{ ...style, background: frame.color ?? "#111" }} />;
  }
  if (frame.src) {
    if (frame.kind === "video") {
      return (
        <div style={style}>
          {/* Autoplaying preview would be noisy — show frame-1 poster only. */}
          <video
            src={
              frame.src.startsWith("blob:") ||
              frame.src.startsWith("http") ||
              frame.src.startsWith("data:")
                ? frame.src
                : `/${frame.src}`
            }
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
            playsInline
            preload="metadata"
          />
        </div>
      );
    }
    return (
      <div style={style}>
        <img
          src={
            frame.src.startsWith("blob:") ||
            frame.src.startsWith("http") ||
            frame.src.startsWith("data:")
              ? frame.src
              : `/${frame.src}`
          }
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }
  return <div style={style} />;
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
