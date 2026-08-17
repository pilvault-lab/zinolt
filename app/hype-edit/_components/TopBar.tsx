"use client";

import React from "react";
import { DarkPill, IconButton, OutlinePill, UI, uiFont } from "./ui";

export const TopBar: React.FC<{
  onOpen: () => void;
  onSave: () => void;
  onDashboard?: () => void;
  onSignOut?: () => void;
}> = ({ onOpen, onSave, onDashboard, onSignOut }) => (
  <header
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 16px",
      borderBottom: `1px solid ${UI.border}`,
      background: UI.chrome,
      fontFamily: uiFont,
      minHeight: 52,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <BrandMark />
      <div style={{ display: "flex", gap: 8 }}>
        <OutlinePill onClick={onOpen} icon={<FolderIcon />}>
          Open
        </OutlinePill>
        <OutlinePill onClick={onSave} icon={<DiskIcon />}>
          Save
        </OutlinePill>
      </div>
    </div>

    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <OutlinePill onClick={onDashboard}>Dashboard</OutlinePill>
      <DarkPill onClick={onSignOut}>Sign out</DarkPill>
    </div>
  </header>
);

const BrandMark: React.FC = () => (
  <div
    style={{
      width: 28,
      height: 28,
      borderRadius: 8,
      background: UI.ink,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#FFF",
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: 0.5,
    }}
    aria-label="Zinolt"
  >
    Z
  </div>
);

const FolderIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H3z" />
  </svg>
);

const DiskIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 4v6h8V4M8 20v-5h8v5" />
  </svg>
);
