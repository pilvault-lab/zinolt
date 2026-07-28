"use client";

import localFont from "next/font/local";
import {
  ArrowRight,
  ChevronRight,
  MoveRight,
  type LucideIcon,
} from "lucide-react";

/* Vernavle-branded variant of the frosted glass content slide. Same layout
 * and prop shape as FrostedSurface so it slots into the same export path,
 * but with the vernavle wordmark corner mark and the vernavle typeface. */

const vernavle = localFont({
  src: "../../../public/brand/vernavle-font.woff2",
  display: "swap",
});

const VERNAVLE_LOGO = "/brand/vernavle-logo.png";

const BOTTOM_ICONS: Record<string, LucideIcon> = {
  chevronRight: ChevronRight,
  arrowRight: ArrowRight,
  moveRight: MoveRight,
};

export type ContentSlideData = {
  bgType: "image" | "color";
  bgImageSrc: string;
  bgColorHex: string;
  glassOpacity: number;
  cardWidthPct: number;
  cardHeightPct: number;
  centerText: string;
  bottomLeft: string;
  bottomRight: string;
  bottomIconKey: string;
};

export const ContentSurface: React.FC<{
  slide: ContentSlideData;
  width: number;
  height: number;
}> = ({ slide, width, height }) => {
  const isImage = slide.bgType === "image" && Boolean(slide.bgImageSrc);

  const cardW = width * slide.cardWidthPct;
  const cardH = height * slide.cardHeightPct;
  const scaleBase = Math.min(cardW, cardH);

  const radius = scaleBase * 0.034;
  const padX = scaleBase * 0.075;
  const padY = scaleBase * 0.08;

  const logoHeight = scaleBase * 0.09;
  const bottomFontSize = scaleBase * 0.018;
  const bottomIconSize = scaleBase * 0.03;

  const centerFontSize = cardW * 0.085;

  const BottomIcon = BOTTOM_ICONS[slide.bottomIconKey] ?? ChevronRight;
  const glassRgba = `rgba(255, 255, 255, ${slide.glassOpacity.toFixed(3)})`;

  return (
    <div
      className={vernavle.className}
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        backgroundColor: isImage ? "#000" : slide.bgColorHex,
        backgroundImage: isImage ? `url(${slide.bgImageSrc})` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: cardW,
          height: cardH,
          backgroundColor: glassRgba,
          backdropFilter: "blur(25px)",
          WebkitBackdropFilter: "blur(25px)",
          borderRadius: radius,
          border: "1px solid rgba(255, 255, 255, 0.2)",
          padding: `${padY}px ${padX}px`,
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        {/* Vernavle wordmark — top-right corner. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={VERNAVLE_LOGO}
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            top: padY,
            right: padX,
            height: logoHeight,
            width: "auto",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />

        <div style={{ height: logoHeight }} aria-hidden />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            textAlign: "left",
            paddingTop: scaleBase * 0.02,
            paddingBottom: scaleBase * 0.02,
          }}
        >
          <div
            style={{
              fontSize: centerFontSize,
              fontWeight: 700,
              lineHeight: 0.95,
              letterSpacing: "-0.025em",
              textTransform: "uppercase",
              color: "#FFFFFF",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              width: "100%",
            }}
          >
            {slide.centerText}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: padX * 0.5,
          }}
        >
          <span
            style={{
              fontSize: bottomFontSize,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.75)",
              fontWeight: 500,
              flex: 1,
              textAlign: "left",
            }}
          >
            {slide.bottomLeft}
          </span>
          <BottomIcon
            size={bottomIconSize}
            color="rgba(255, 255, 255, 0.85)"
            strokeWidth={1.5}
            aria-hidden
          />
          <span
            style={{
              fontSize: bottomFontSize,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.75)",
              fontWeight: 500,
              flex: 1,
              textAlign: "right",
            }}
          >
            {slide.bottomRight}
          </span>
        </div>
      </div>
    </div>
  );
};
