import { AbsoluteFill, Img, staticFile } from "remotion";
import { Audio, Video } from "@remotion/media";
import { BRAND, type Brand } from "../lib/brand";

export type LightRayProps = {
  artworkSrc: string;
  artworkAspect: number;
  audioTrack: string;
  brand: Brand;
  artworkScale: number;
  artworkRadius: number;
  artworkCenterY: number;
};

export const lightRayDefaultProps: LightRayProps = {
  artworkSrc: "artwork/placeholder.svg",
  artworkAspect: 1,
  audioTrack: "",
  brand: BRAND,
  artworkScale: 1,
  artworkRadius: 32,
  artworkCenterY: 0.47,
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

export const LightRay: React.FC<LightRayProps> = ({
  artworkSrc,
  artworkAspect,
  audioTrack,
  brand,
  artworkScale,
  artworkRadius,
  artworkCenterY,
}) => {
  const { w: baseW, h: baseH } = fitBox(artworkAspect);
  const boxW = baseW * artworkScale;
  const boxH = baseH * artworkScale;
  const left = (COMP_W - boxW) / 2;
  const top = artworkCenterY * COMP_H - boxH / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* Layer 1 (back): light-ray background */}
      <AbsoluteFill>
        <Video
          src={staticFile("rays/light-ray-white.mp4")}
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

      {/* Layer 3 (front): Zincad logo, fixed TOP-RIGHT, ~6% width */}
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
