"use client";

import React from "react";
import { Field, Panel, UI, uiFont } from "./ui";
import { AudioPanel, type UITrack } from "./AudioPanel";
import type { HypeSettings } from "@/lib/hype-edit/types";

type Props = {
  presets: UITrack[];
  custom: UITrack[];
  audioFile: string;
  onAudioPick: (file: string) => void;
  bpmEffective: number;
  bpmOverride: number | undefined;
  onBpmOverride: (n: number | undefined) => void;
  settings: HypeSettings;
  onSettings: (patch: Partial<HypeSettings>) => void;
  isMobile?: boolean;
};

export const LeftSidebar: React.FC<Props> = ({
  presets,
  custom,
  audioFile,
  onAudioPick,
  bpmEffective,
  bpmOverride,
  onBpmOverride,
  settings,
  onSettings,
  isMobile,
}) => (
  <aside
    style={{
      width: isMobile ? "100%" : 300,
      background: UI.chromePanel,
      borderRight: isMobile ? "none" : `1px solid ${UI.border}`,
      borderTop: isMobile ? `1px solid ${UI.border}` : "none",
      overflowY: isMobile ? "visible" : "auto",
      fontFamily: uiFont,
      display: "flex",
      flexDirection: "column",
    }}
  >
    <Panel title="Brand settings">
      <div style={{ fontSize: 12, color: UI.inkSoft, lineHeight: 1.5 }}>
        Vernavle branding is fixed for this template — the mark appears as an
        intro flash and persistent watermark. Toggle either in Advanced.
      </div>
    </Panel>

    <Panel title="Frame layout">
      <Field
        label="Stage mode"
        hint={
          settings.stageMode === "letterboxed"
            ? "16:9 stage centered, black bars top/bottom."
            : "Full-bleed 9:16 crop — fills the canvas."
        }
      >
        <select
          value={settings.stageMode}
          onChange={(e) =>
            onSettings({
              stageMode: e.target.value as HypeSettings["stageMode"],
            })
          }
          style={selectStyle}
        >
          <option value="full-bleed">Full-bleed 9:16 (default)</option>
          <option value="letterboxed">Letterboxed 16:9</option>
        </select>
      </Field>
    </Panel>

    <Panel title="Brand colours">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Swatch color="#131316" label="Ink" />
        <Swatch color="#F5F4F0" label="Chrome" bordered />
        <Swatch color="#FFFFFF" label="Paper" bordered />
      </div>
    </Panel>

    <Panel title="Audio" defaultOpen>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <AudioPanel
          presets={presets}
          custom={custom}
          currentFile={audioFile}
          onPick={onAudioPick}
        />
        <Field
          label="BPM override"
          hint={`Effective: ${bpmEffective} BPM (cuts / tick grid)`}
        >
          <input
            type="number"
            min={30}
            max={300}
            step={1}
            value={bpmOverride ?? ""}
            placeholder={
              audioFile ? "use track BPM" : "no track selected"
            }
            onChange={(e) => {
              const v = e.target.value;
              onBpmOverride(v === "" ? undefined : Number(v));
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${UI.border}`,
              fontFamily: uiFont,
              fontSize: 13,
              color: UI.ink,
              background: "#FFF",
            }}
          />
        </Field>
      </div>
    </Panel>

    <Panel title="Advanced settings">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Export fps">
          <select
            value={settings.fps}
            onChange={(e) =>
              onSettings({ fps: Number(e.target.value) as 30 | 60 })
            }
            style={selectStyle}
          >
            <option value={60}>60 fps (buttery)</option>
            <option value={30}>30 fps (half render time)</option>
          </select>
        </Field>
        <Field label="Bitrate (Mbps)">
          <input
            type="number"
            min={4}
            max={40}
            step={1}
            value={Math.round(settings.bitrate / 1_000_000)}
            onChange={(e) =>
              onSettings({
                bitrate: Math.max(1, Number(e.target.value)) * 1_000_000,
              })
            }
            style={selectStyle}
          />
        </Field>
        <Field label="Transitions">
          <select
            value={settings.transitionMode}
            onChange={(e) =>
              onSettings({
                transitionMode: e.target.value as HypeSettings["transitionMode"],
              })
            }
            style={selectStyle}
          >
            <option value="auto">Auto (varies with BPM)</option>
            <option value="hard">Hard (cut / punch / glitch / flash)</option>
            <option value="smooth">Smooth (whip-pan / cut / punch)</option>
          </select>
        </Field>
        <Toggle
          label="Intro flash (Vernavle)"
          value={settings.introFlash}
          onChange={(v) => onSettings({ introFlash: v })}
        />
        <Toggle
          label="Watermark"
          value={settings.watermark}
          onChange={(v) => onSettings({ watermark: v })}
        />
      </div>
    </Panel>
  </aside>
);

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${UI.border}`,
  fontFamily: uiFont,
  fontSize: 13,
  color: UI.ink,
  background: "#FFF",
};

const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, value, onChange }) => (
  <label
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 12,
      color: UI.ink,
      cursor: "pointer",
    }}
  >
    <span>{label}</span>
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);

const Swatch: React.FC<{ color: string; label: string; bordered?: boolean }> = ({
  color,
  label,
  bordered,
}) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
    <div
      style={{
        width: 28,
        height: 28,
        background: color,
        borderRadius: 6,
        border: bordered ? `1px solid ${UI.border}` : "none",
      }}
    />
    <span style={{ fontSize: 10, color: UI.muted }}>{label}</span>
  </div>
);
