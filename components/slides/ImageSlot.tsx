import React from "react";
import { BRAND } from "@/lib/brand";

type Props = {
  src: string;
  alt?: string;
  rounded?: number | "full";
  fit?: "cover" | "contain";
  placeholder?: string;
  style?: React.CSSProperties;
};

export const ImageSlot: React.FC<Props> = ({
  src,
  alt = "",
  rounded = 12,
  fit = "cover",
  placeholder = "Drop image",
  style,
}) => {
  const radius = rounded === "full" ? "50%" : rounded;
  if (!src) {
    return (
      <div
        style={{
          ...style,
          borderRadius: radius,
          backgroundColor: "rgba(10,10,10,0.04)",
          border: "1.5px dashed rgba(10,10,10,0.18)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: BRAND.fonts.ui.family,
          fontSize: 16,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(10,10,10,0.32)",
        }}
      >
        {placeholder}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={{
        ...style,
        objectFit: fit,
        borderRadius: radius,
        display: "block",
      }}
    />
  );
};
