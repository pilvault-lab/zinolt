import React from "react";
import { BRAND } from "@/lib/brand";
import { ImageSlot } from "@/components/slides/ImageSlot";
import type { LayoutRenderProps } from "@/lib/slide-layouts";

export const OpenCallLayout: React.FC<LayoutRenderProps> = ({ values }) => {
  const title = values.title ?? "";
  const brief = values.brief ?? "";
  const deadline = values.deadline ?? "";
  const prize = values.prize ?? "";
  const image = values.image ?? "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        height: "100%",
        width: "100%",
      }}
    >
      <span
        style={{
          fontFamily: BRAND.fonts.ui.family,
          fontSize: 18,
          letterSpacing: "0.34em",
          textTransform: "uppercase",
          color: "rgba(10,10,10,0.45)",
        }}
      >
        Open call
      </span>

      <h1
        style={{
          fontFamily: BRAND.fonts.display.family,
          fontWeight: 400,
          fontSize: 84,
          lineHeight: 0.98,
          letterSpacing: "-0.02em",
          color: BRAND.colors.ink,
          margin: 0,
          overflowWrap: "anywhere",
        }}
      >
        {title || "Title goes here"}
      </h1>

      {/* Hero supporting image */}
      <ImageSlot
        src={image}
        rounded={18}
        fit="cover"
        placeholder="Supporting image"
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
        }}
      />

      {/* Brief */}
      <p
        style={{
          fontFamily: BRAND.fonts.display.family,
          fontWeight: 400,
          fontStyle: "italic",
          fontSize: 28,
          lineHeight: 1.35,
          color: "rgba(10,10,10,0.75)",
          margin: 0,
          overflowWrap: "anywhere",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 4,
          overflow: "hidden",
        }}
      >
        {brief || "A short brief that gives context to what you're inviting."}
      </p>

      {/* Meta row: deadline + prize */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderTop: "1px solid rgba(10,10,10,0.15)",
          paddingTop: 18,
        }}
      >
        <MetaCell label="Deadline" value={deadline || "—"} />
        <div style={{ width: 1, backgroundColor: "rgba(10,10,10,0.15)" }} />
        <MetaCell label="Prize" value={prize || "—"} />
      </div>
    </div>
  );
};

const MetaCell: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: "0 18px",
    }}
  >
    <span
      style={{
        fontFamily: BRAND.fonts.ui.family,
        fontSize: 14,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        color: "rgba(10,10,10,0.45)",
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: BRAND.fonts.ui.family,
        fontSize: 26,
        color: BRAND.colors.ink,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);
