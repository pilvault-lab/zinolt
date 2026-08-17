"use client";

import React, { useRef, useState } from "react";
import type { HypeFrame } from "@/lib/hype-edit/types";
import { Chevron, DarkPill, UI, uiFont } from "./ui";
import { FramesList } from "./FramesList";

type Props = {
  frames: HypeFrame[];
  onReorder: (n: HypeFrame[]) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onAdd: (f: HypeFrame) => void;
  onIngestFiles: (files: FileList | File[]) => void;
  onDownload: () => void;
  isRendering: boolean;
  progress: number;
  canExport: boolean | null;
  exportError: string;
  downloadDisabled: boolean;
  isMobile?: boolean;
};

export const RightPanel: React.FC<Props> = ({
  frames,
  onReorder,
  onDelete,
  onClear,
  onAdd,
  onIngestFiles,
  onDownload,
  isRendering,
  progress,
  canExport,
  exportError,
  downloadDisabled,
  isMobile,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <aside
      style={{
        width: isMobile ? "100%" : 320,
        background: UI.chromePanel,
        borderLeft: isMobile ? "none" : `1px solid ${UI.border}`,
        borderTop: isMobile ? `1px solid ${UI.border}` : "none",
        overflowY: isMobile ? "visible" : "auto",
        fontFamily: uiFont,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 14px 10px",
          borderBottom: `1px solid ${UI.divider}`,
        }}
      >
        <DarkPill
          block
          disabled={downloadDisabled || isRendering}
          onClick={onDownload}
          icon={<DownloadIcon />}
        >
          {isRendering
            ? `Rendering… ${Math.round(progress * 100)}%`
            : "Download Video"}
        </DarkPill>
        {canExport === false ? (
          <div
            style={{
              fontSize: 11,
              color: UI.muted,
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            Export requires Chrome or Edge on desktop.
          </div>
        ) : null}
        {exportError ? (
          <div
            style={{
              fontSize: 11,
              color: "#B04040",
              marginTop: 8,
              lineHeight: 1.5,
            }}
          >
            {exportError}
          </div>
        ) : null}
      </div>

      <div style={{ padding: "12px 14px 6px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              color: UI.ink,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Chevron open={open} />
            Frames{" "}
            <span
              style={{
                marginLeft: 4,
                fontSize: 11,
                fontWeight: 500,
                color: UI.muted,
              }}
            >
              ({frames.length})
            </span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {frames.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove all ${frames.length} frame${
                        frames.length === 1 ? "" : "s"
                      }? This can't be undone.`,
                    )
                  ) {
                    onClear();
                  }
                }}
                title="Clear all frames"
                style={{
                  padding: "6px 10px",
                  background: "transparent",
                  color: UI.inkSoft,
                  border: `1px solid ${UI.border}`,
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Clear all
              </button>
            ) : null}
            <AddFrameMenu onAdd={onAdd} onIngestFiles={onIngestFiles} />
          </div>
        </div>

        {open ? (
          <FramesList
            frames={frames}
            onReorder={onReorder}
            onDelete={onDelete}
          />
        ) : null}
      </div>
    </aside>
  );
};

const AddFrameMenu: React.FC<{
  onAdd: (f: HypeFrame) => void;
  onIngestFiles: (files: FileList | File[]) => void;
}> = ({ onAdd, onIngestFiles }) => {
  const [open, setOpen] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [colorInput, setColorInput] = useState("#0F0F0F");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "6px 10px",
          background: UI.ink,
          color: "#FFF",
          border: "none",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add frame
      </button>
      {open ? (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 50,
              width: 260,
              background: "#FFF",
              border: `1px solid ${UI.border}`,
              borderRadius: 10,
              padding: 10,
              boxShadow: "0 8px 30px rgba(0,0,0,0.10)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div>
              <div style={miniLabel}>Upload from computer</div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  ...addBtn,
                  width: "100%",
                  padding: "10px",
                  fontSize: 12,
                }}
              >
                Choose files
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    onIngestFiles(files);
                    setOpen(false);
                  }
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
              <div
                style={{
                  fontSize: 10,
                  color: UI.muted,
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                Or drag files onto the app, or paste (⌘/Ctrl+V) an image.
                Session-only — reloads clear them.
              </div>
            </div>

            <div>
              <div style={miniLabel}>Path in /public</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="hype-edit/frames/img.jpg"
                  style={inputMini}
                />
                <button
                  onClick={() => {
                    const p = pathInput.trim();
                    if (!p) return;
                    const isVid = /\.(mp4|webm|mov|m4v)$/i.test(p);
                    onAdd({
                      id: crypto.randomUUID(),
                      kind: isVid ? "video" : "image",
                      src: p,
                    });
                    setPathInput("");
                    setOpen(false);
                  }}
                  style={addBtn}
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <div style={miniLabel}>Solid colour</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                  style={{
                    width: 34,
                    height: 30,
                    border: `1px solid ${UI.border}`,
                    borderRadius: 6,
                    padding: 0,
                    background: "#FFF",
                    cursor: "pointer",
                  }}
                />
                <input
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                  style={inputMini}
                />
                <button
                  onClick={() => {
                    onAdd({
                      id: crypto.randomUUID(),
                      kind: "solid",
                      color: colorInput,
                    });
                    setOpen(false);
                  }}
                  style={addBtn}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

const miniLabel: React.CSSProperties = {
  fontSize: 10,
  color: UI.muted,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontWeight: 700,
  marginBottom: 4,
};

const inputMini: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  fontSize: 12,
  borderRadius: 6,
  border: `1px solid ${UI.border}`,
  color: UI.ink,
  minWidth: 0,
};

const addBtn: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  background: UI.ink,
  color: "#FFF",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const DownloadIcon: React.FC = () => (
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
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);
