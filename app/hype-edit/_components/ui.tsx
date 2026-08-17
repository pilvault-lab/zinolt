"use client";

import React, { useState, type CSSProperties, type ReactNode } from "react";

/** Shared colours + type — clean off-white chrome, dark accents. */
export const UI = {
  chrome: "#F5F4F0",
  chromePanel: "#FBFAF7",
  border: "#E4E1DA",
  divider: "#EDE9E1",
  ink: "#131316",
  inkSoft: "#5D5A55",
  muted: "#8C8880",
  accentDark: "#131316",
  accentDarkHover: "#000",
  stageBg: "#5A5E68",
  radius: 12,
} as const;

export const uiFont =
  '"Inter", "Helvetica Neue", Helvetica, Arial, ui-sans-serif, system-ui, -apple-system, sans-serif';

/** Small icon-button shell (square, subtle border). */
export const IconButton: React.FC<{
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}> = ({ children, onClick, title, active }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{
      width: 30,
      height: 30,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: active ? UI.ink : "transparent",
      color: active ? "#FFF" : UI.ink,
      border: `1px solid ${UI.border}`,
      borderRadius: 8,
      cursor: "pointer",
      transition: "background 120ms",
    }}
  >
    {children}
  </button>
);

/** Outlined pill button ("Open", "Save"). */
export const OutlinePill: React.FC<{
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
}> = ({ children, onClick, icon, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      background: "transparent",
      color: UI.ink,
      border: `1px solid ${UI.border}`,
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 500,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {icon}
    {children}
  </button>
);

/** Dark solid pill ("Sign out", "Download Video"). */
export const DarkPill: React.FC<{
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  block?: boolean;
  icon?: ReactNode;
}> = ({ children, onClick, disabled, block, icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "10px 18px",
      width: block ? "100%" : undefined,
      background: UI.ink,
      color: "#FFF",
      border: "none",
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 0.1,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    {icon}
    {children}
  </button>
);

/** Accordion panel matching the reference styling (chevron header). */
export const Panel: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  compact?: boolean;
}> = ({ title, defaultOpen, children, compact }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div
      style={{
        borderBottom: `1px solid ${UI.divider}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: compact ? "10px 14px" : "14px 16px",
          background: "transparent",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: UI.ink,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.1,
        }}
      >
        <span>{title}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div style={{ padding: "4px 16px 16px" }}>{children}</div>
      ) : null}
    </div>
  );
};

export const Chevron: React.FC<{ open: boolean; size?: number }> = ({
  open,
  size = 14,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    style={{
      transition: "transform 160ms",
      transform: open ? "rotate(180deg)" : "rotate(0)",
      color: UI.inkSoft,
    }}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 8l5 5 5-5" />
  </svg>
);

/** Small labelled block used inside panels. */
export const Field: React.FC<{
  label: string;
  children: ReactNode;
  hint?: string;
  style?: CSSProperties;
}> = ({ label, children, hint, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
    <span
      style={{
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: UI.muted,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
    {children}
    {hint ? (
      <span style={{ fontSize: 11, color: UI.muted }}>{hint}</span>
    ) : null}
  </div>
);
