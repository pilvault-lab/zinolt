"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { UI, uiFont } from "./ui";

type Props = {
  playing: boolean;
  currentSec: number;
  durationSec: number;
  bpm: number;
  onPlayPause: () => void;
  onSeek: (sec: number) => void;
  isMobile?: boolean;
};

export const Transport: React.FC<Props> = ({
  playing,
  currentSec,
  durationSec,
  bpm,
  onPlayPause,
  onSeek,
  isMobile,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [barW, setBarW] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarW(el.getBoundingClientRect().width));
    ro.observe(el);
    setBarW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const beats = useMemo(() => {
    if (!bpm || bpm <= 0 || durationSec <= 0) return [] as number[];
    const step = 60 / bpm;
    const out: number[] = [];
    for (let i = 0; i * step < durationSec && i < 4096; i++) {
      out.push(i * step);
    }
    return out;
  }, [bpm, durationSec]);

  const progressPct = durationSec > 0 ? (currentSec / durationSec) * 100 : 0;

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el || durationSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    onSeek((x / rect.width) * durationSec);
  };

  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 8 : 14,
        padding: isMobile ? "10px 12px" : "12px 18px",
        borderTop: `1px solid ${UI.border}`,
        borderBottom: isMobile ? `1px solid ${UI.border}` : "none",
        background: UI.chrome,
        fontFamily: uiFont,
        minHeight: isMobile ? 54 : 62,
      }}
    >
      <button
        type="button"
        onClick={onPlayPause}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: UI.ink,
          color: "#FFF",
          border: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        style={{
          fontSize: 12,
          color: UI.inkSoft,
          fontVariantNumeric: "tabular-nums",
          minWidth: 44,
        }}
      >
        {fmt(currentSec)}
      </div>

      <div
        ref={barRef}
        onClick={(e) => seekFromEvent(e.clientX)}
        onMouseDown={(e) => {
          seekFromEvent(e.clientX);
          const move = (ev: MouseEvent) => seekFromEvent(ev.clientX);
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) seekFromEvent(t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) seekFromEvent(t.clientX);
        }}
        style={{
          flex: 1,
          height: 36,
          position: "relative",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        {/* Beat ticks */}
        <svg
          width={barW || "100%"}
          height="36"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {beats.map((t, i) => {
            const x = (t / durationSec) * (barW || 0);
            // Emphasise every 4th beat (bar line).
            const isBar = i % 4 === 0;
            return (
              <line
                key={i}
                x1={x}
                x2={x}
                y1={isBar ? 4 : 10}
                y2={isBar ? 32 : 26}
                stroke={isBar ? UI.ink : UI.muted}
                strokeOpacity={isBar ? 0.55 : 0.4}
                strokeWidth={isBar ? 1.2 : 1}
              />
            );
          })}
        </svg>

        {/* Base line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: 3,
            background: UI.divider,
            borderRadius: 999,
          }}
        />
        {/* Progress fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${progressPct}%`,
            top: "50%",
            transform: "translateY(-50%)",
            height: 3,
            background: UI.ink,
            borderRadius: 999,
          }}
        />
        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            left: `${progressPct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: 999,
            background: UI.ink,
            border: "2px solid #FFF",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        style={{
          fontSize: 12,
          color: UI.inkSoft,
          fontVariantNumeric: "tabular-nums",
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {fmt(durationSec)}
      </div>

      {isMobile ? null : (
        <div
          style={{
            fontSize: 11,
            color: UI.muted,
            fontFamily: uiFont,
            minWidth: 56,
            textAlign: "right",
          }}
          title="BPM drives tick density and cut cadence"
        >
          {bpm ? `${bpm} BPM` : "— BPM"}
        </div>
      )}
    </footer>
  );
};

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const PlayIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4v16l14-8z" />
  </svg>
);
const PauseIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);
