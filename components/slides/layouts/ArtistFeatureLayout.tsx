import React from "react";
import { BRAND } from "@/lib/brand";
import { ImageSlot } from "@/components/slides/ImageSlot";
import type { LayoutRenderProps } from "@/lib/slide-layouts";

export const ArtistFeatureLayout: React.FC<LayoutRenderProps> = ({
  values,
}) => {
  const portrait = values.portrait ?? "";
  const artwork = values.artwork ?? "";
  const name = values.name ?? "";
  const descriptor = values.descriptor ?? "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 36,
        height: "100%",
        width: "100%",
      }}
    >
      {/* Top row: portrait + meta */}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <ImageSlot
          src={portrait}
          rounded="full"
          placeholder="Portrait"
          style={{ width: 130, height: 130, flexShrink: 0 }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontFamily: BRAND.fonts.ui.family,
              fontSize: 18,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "rgba(10,10,10,0.45)",
            }}
          >
            Featured artist
          </span>
          <span
            style={{
              fontFamily: BRAND.fonts.ui.family,
              fontSize: 22,
              color: "rgba(10,10,10,0.55)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            №&nbsp;041 · Spring 2026
          </span>
        </div>
      </div>

      {/* Hero artwork — flex-grows to fill */}
      <ImageSlot
        src={artwork}
        rounded={20}
        fit="cover"
        placeholder="Hero artwork"
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
        }}
      />

      {/* Name + descriptor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          {name || "Name"}
        </h1>
        <p
          style={{
            fontFamily: BRAND.fonts.ui.family,
            fontSize: 26,
            lineHeight: 1.3,
            color: "rgba(10,10,10,0.62)",
            margin: 0,
            overflowWrap: "anywhere",
          }}
        >
          {descriptor || "Discipline · Place"}
        </p>
      </div>
    </div>
  );
};
