import { AbsoluteFill, continueRender, delayRender, Img, staticFile } from "remotion";
import { Audio, Video } from "@remotion/media";
import { BRAND, type Brand } from "../lib/brand";

if (typeof window !== "undefined") {
  const _fontHandle = delayRender("Cosmos Oracle font");
  const _face = new FontFace(
    "Cosmos Oracle",
    `url(${staticFile("brand/Cosmos-Oracle.woff2")}) format('woff2')`,
  );
  _face
    .load()
    .then(() => {
      document.fonts.add(_face);
      continueRender(_fontHandle);
    })
    .catch(() => continueRender(_fontHandle));
}

export type ReelProps = {
  artworkSrc: string;
  artworkAspect: number;
  audioTrack: string;
  brand: Brand;
  backgroundSrc: string;
  artworkScale: number;
  artworkRadius: number;
  artworkCenterY: number;
  artworkShadow: number;
  showCaption: boolean;
};

export const reelDefaultProps: ReelProps = {
  artworkSrc: "artwork/placeholder.svg",
  artworkAspect: 1,
  audioTrack: "",
  brand: BRAND,
  backgroundSrc: "/rays/light-ray-white.mp4",
  artworkScale: 1,
  artworkRadius: 32,
  artworkCenterY: 0.47,
  artworkShadow: 0.5,
  showCaption: false,
};

// Composition canvas
const COMP_W = 1080;
const COMP_H = 1920;

// Artwork bounding box at scale=1 (fit-contain math against these — see fitBox)
const MAX_W = 0.6 * COMP_W; // 648
const MAX_H = 0.55 * COMP_H; // 1056
const REF_ASPECT = MAX_W / MAX_H;

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:)/i.test(s);
const stripLeadingSlash = (p: string) => p.replace(/^\//, "");
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(stripLeadingSlash(p));

const fitBox = (aspect: number): { w: number; h: number } => {
  const a = aspect > 0 ? aspect : 1;
  if (a >= REF_ASPECT) {
    return { w: MAX_W, h: MAX_W / a };
  }
  return { w: MAX_H * a, h: MAX_H };
};

export const Reel: React.FC<ReelProps> = ({
  artworkSrc,
  artworkAspect,
  audioTrack,
  brand,
  backgroundSrc,
  artworkScale,
  artworkRadius,
  artworkCenterY,
  artworkShadow,
  showCaption,
}) => {
  const { w: baseW, h: baseH } = fitBox(artworkAspect);
  const boxW = baseW * artworkScale;
  const boxH = baseH * artworkScale;
  const left = (COMP_W - boxW) / 2;
  const top = artworkCenterY * COMP_H - boxH / 2;

  const shadow =
    artworkShadow > 0
      ? `0 ${24 * artworkShadow}px ${64 * artworkShadow}px rgba(0,0,0,${0.6 * artworkShadow})`
      : "none";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1 (back): pre-baked background video (light-ray, ferrofluid, …) */}
      <AbsoluteFill>
        <Video
          src={resolveSrc(backgroundSrc)}
          muted
          objectFit="cover"
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </AbsoluteFill>

      {/* Layer 2 (middle): artwork — explicit pixel box, soft-rounded, floated */}
      <AbsoluteFill>
        {artworkSrc ? (
          <div
            style={{
              position: "absolute",
              left,
              top,
              width: boxW,
              height: boxH,
              borderRadius: artworkRadius,
              overflow: "hidden",
              boxShadow: shadow,
            }}
          >
            <Img
              src={resolveSrc(artworkSrc)}
              style={{
                width: boxW,
                height: boxH,
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        ) : null}
      </AbsoluteFill>

      {/* Layer 3: "Art of the day" caption — just above artwork, Cosmos Oracle, subtle */}
      {showCaption && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: top - 68,
              textAlign: "center",
              fontFamily: "'Cosmos Oracle', serif",
              fontSize: 34,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.55)",
            }}
          >
            Art of the day
          </div>
        </AbsoluteFill>
      )}

      {/* Layer 4 (front): brand logo, fixed TOP-RIGHT, ~6% width */}
      <AbsoluteFill>
        <Img
          src={resolveSrc(brand.logoSrc)}
          style={{
            position: "absolute",
            top: "3.5%",
            right: "5%",
            width: "6%",
            height: "auto",
          }}
        />
      </AbsoluteFill>

      {audioTrack ? <Audio src={resolveSrc(audioTrack)} /> : null}
    </AbsoluteFill>
  );
};
