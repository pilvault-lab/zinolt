"use client";

import React, { useState } from "react";
import { Chevron, UI } from "./ui";

export type UITrack = {
  file: string;
  name: string;
  kind: "preset" | "custom";
  presetSlot?: number;
  bpm?: number;
};

type Props = {
  presets: UITrack[];
  custom: UITrack[];
  currentFile: string;
  onPick: (file: string) => void;
};

export const AudioPanel: React.FC<Props> = ({
  presets,
  custom,
  currentFile,
  onPick,
}) => {
  const [customOpen, setCustomOpen] = useState(true);
  const currentTrack =
    presets.find((p) => p.file === currentFile) ??
    custom.find((c) => c.file === currentFile);
  const currentLabel = currentTrack
    ? currentTrack.presetSlot
      ? `Audio ${currentTrack.presetSlot}`
      : currentTrack.name
    : "None";

  // Build 6-slot grid of preset buttons (missing slots render as disabled).
  const presetBySlot = new Map<number, UITrack>();
  for (const p of presets) {
    if (p.presetSlot && p.presetSlot >= 1 && p.presetSlot <= 6) {
      presetBySlot.set(p.presetSlot, p);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: UI.muted,
          letterSpacing: 0.4,
        }}
      >
        Preset audio · <strong style={{ color: UI.ink }}>{currentLabel}</strong>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((slot) => {
          const track = presetBySlot.get(slot);
          const selected = Boolean(track && track.file === currentFile);
          const disabled = !track;
          return (
            <PresetButton
              key={slot}
              label={`Audio ${slot}`}
              bpm={track?.bpm}
              selected={selected}
              disabled={disabled}
              onClick={() => track && onPick(track.file)}
            />
          );
        })}
        <PresetButton
          label="None"
          selected={!currentFile}
          onClick={() => onPick("")}
        />
      </div>

      <button
        type="button"
        onClick={() => setCustomOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: UI.ink,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Custom audio
        <Chevron open={customOpen} />
      </button>
      {customOpen ? (
        custom.length === 0 ? (
          <div
            style={{
              fontSize: 11,
              color: UI.muted,
              padding: "4px 0 0",
              lineHeight: 1.5,
            }}
          >
            Drop tracks in <code>public/hype-edit/audio/custom/</code>. Add a
            sibling <code>{"{track}"}.bpm</code> file so the timeline ticks
            align.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {custom.map((t) => (
              <button
                key={t.file}
                onClick={() => onPick(t.file)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  border: `1px solid ${
                    t.file === currentFile ? UI.ink : UI.border
                  }`,
                  borderRadius: 8,
                  background: t.file === currentFile ? "#FFF" : "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  color: UI.ink,
                }}
              >
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: UI.muted, marginTop: 2 }}>
                  {t.bpm ? `${t.bpm} BPM` : "no .bpm sidecar"}
                </div>
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
};

const PresetButton: React.FC<{
  label: string;
  bpm?: number;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ label, bpm, selected, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "10px 8px",
      border: `${selected ? "1.5px" : "1px"} solid ${
        selected ? UI.ink : UI.border
      }`,
      borderRadius: 10,
      background: selected ? "#FFF" : "transparent",
      color: disabled ? UI.muted : UI.ink,
      fontSize: 12,
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
    }}
  >
    <span>{label}</span>
    <span style={{ fontSize: 10, fontWeight: 500, color: UI.muted }}>
      {bpm ? `${bpm} BPM` : disabled ? "empty" : "—"}
    </span>
  </button>
);
