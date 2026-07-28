"use client";

import localFont from "next/font/local";

const vernavle = localFont({
  src: "../../../public/brand/vernavle-font.woff2",
  display: "swap",
});

const VERNAVLE_LOGO = "/brand/vernavle-logo.png";

export type CoverSlideData = {
  bgImageSrc: string;
  tagText: string;
  tagColor: string;
  headline: string;
};

export const CoverSurface: React.FC<{
  slide: CoverSlideData;
  width: number;
  height: number;
}> = ({ slide, width, height }) => {
  const scaleBase = Math.min(width, height);

  const pad = width * 0.055;
  const logoH = width * 0.09;
  const tagFont = width * 0.028;
  const tagPadX = width * 0.02;
  const tagPadY = width * 0.011;
  const tagRadius = width * 0.008;
  const headlineFont = width * 0.11;
  const headlineGap = width * 0.028;

  const hasImage = Boolean(slide.bgImageSrc);

  return (
    <div
      className={vernavle.className}
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#0d1218",
        backgroundImage: hasImage ? `url(${slide.bgImageSrc})` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Bottom-heavy dark scrim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.65) 28%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 75%)",
          pointerEvents: "none",
        }}
      />

      {/* Vernavle mark, top-left */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={VERNAVLE_LOGO}
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          top: pad,
          left: pad,
          height: logoH,
          width: "auto",
          opacity: 0.95,
          filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))",
          pointerEvents: "none",
        }}
      />

      {/* Bottom-anchored content */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          bottom: pad,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: headlineGap,
        }}
      >
        {slide.tagText ? (
          <span
            style={{
              display: "inline-block",
              backgroundColor: slide.tagColor,
              color: "#FFFFFF",
              fontSize: tagFont,
              lineHeight: 1,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: `${tagPadY}px ${tagPadX}px`,
              borderRadius: tagRadius,
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
            }}
          >
            {slide.tagText}
          </span>
        ) : null}

        <h1
          style={{
            margin: 0,
            color: "#FFFFFF",
            fontSize: headlineFont,
            lineHeight: 0.92,
            letterSpacing: "-0.015em",
            textTransform: "uppercase",
            fontWeight: 400,
            textShadow: "0 2px 12px rgba(0,0,0,0.55)",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            width: "100%",
          }}
        >
          {slide.headline}
        </h1>
      </div>

      {/* scaleBase referenced to appease TS if we later add scale-dependent decoration */}
      <span style={{ display: "none" }} aria-hidden data-scale={scaleBase} />
    </div>
  );
};
