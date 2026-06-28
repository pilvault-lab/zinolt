/* eslint-disable react/no-unknown-property, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, extend, useThree } from "@react-three/fiber";
import {
  useGLTF,
  useTexture,
  Environment,
  Lightformer,
} from "@react-three/drei";
import { MeshLineGeometry, MeshLineMaterial } from "meshline";
import * as THREE from "three";

extend({ MeshLineGeometry, MeshLineMaterial });

/* Assets ship under /public/lanyard/ + /public/brand/ already. */
const CARD_GLB = "/lanyard/card.glb";
const ZINOLT_LOGO_WHITE = "/brand/zinolt-logo-white.png";

/* 1×1 transparent pixel — lets useTexture be called unconditionally when no
 * frontImage is supplied. */
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/* The card model's front face is UV-mapped to the LEFT half of the texture
 * atlas (the back face owns the RIGHT half but we don't customise it). */
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };

/* Static pose tuning — matches the BadgeShell template so the card sits at
 * the same screen position whether you use /slides or /dangle. */
const TARGET_CARD_H = 6.4;
const CARD_CENTER_Y = -0.5;
const CARD_Z_OFFSET = 0.6;
const BAND_TOP_Y = 5.22;

export type ImageFit = "cover" | "contain";

export type LanyardHandle = {
  /** Renders the scene at scale × slideWidth/Height and returns a data URL.
   *  scale defaults to 4 (→ 4K). The preview backbuffer is restored after. */
  exportPng: (scale?: number) => Promise<string>;
};

export type StaticLanyardProps = {
  /** Locked backbuffer width. Drives camera aspect + export resolution. */
  slideWidth?: number;
  slideHeight?: number;
  /** Camera position. Default z=22 → larger lanyard than the React Bits 30. */
  position?: [number, number, number];
  fov?: number;
  transparent?: boolean;
  /** URL or data URL for the card's front face. */
  frontImage?: string | null;
  imageFit?: ImageFit;
  /** URL or data URL for the band's repeating texture. */
  lanyardImage?: string | null;
  /** meshline line width. */
  lanyardWidth?: number;
  /** Imperative export handle exposed via a ref-like prop. Using this
   *  instead of forwardRef keeps things working when the component is loaded
   *  via next/dynamic({ ssr: false }), which strips ref forwarding. */
  apiRef?: { current: LanyardHandle | null };
  className?: string;
  style?: React.CSSProperties;
};

export default function InteractiveLanyard({
  slideWidth = 1080,
  slideHeight = 1920,
  position = [0, 0, 22],
  fov = 20,
  transparent = true,
  frontImage = null,
  imageFit = "cover",
  lanyardImage = null,
  lanyardWidth = 1,
  apiRef,
  className,
  style,
}: StaticLanyardProps) {
    const [isMobile, setIsMobile] = useState<boolean>(
      () => typeof window !== "undefined" && window.innerWidth < 768,
    );
    const exportApiRef = useRef<{
      exportPng: (s?: number) => Promise<string>;
    } | null>(null);

    useEffect(() => {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

    return (
      <div
        className={className}
        style={{
          position: "relative",
          zIndex: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          ...style,
        }}
      >
        <Canvas
          camera={{ position, fov }}
          dpr={1}
          gl={{ alpha: transparent, preserveDrawingBuffer: true, antialias: true }}
          style={{ width: "100%", height: "100%", display: "block" }}
          onCreated={({ gl }) =>
            gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)
          }
        >
          <BackbufferLock width={slideWidth} height={slideHeight} />
          <ExportBridge
            width={slideWidth}
            height={slideHeight}
            register={(api) => {
              exportApiRef.current = api;
              if (apiRef) {
                apiRef.current = {
                  exportPng: async (scale = 4) => {
                    if (!exportApiRef.current)
                      throw new Error("Canvas not ready");
                    return exportApiRef.current.exportPng(scale);
                  },
                };
              }
            }}
          />
          <ambientLight intensity={Math.PI} />
          <StaticBadge
            isMobile={isMobile}
            frontImage={frontImage}
            imageFit={imageFit}
            lanyardImage={lanyardImage}
            lanyardWidth={lanyardWidth}
          />
          <Environment blur={0.75}>
            <Lightformer
              intensity={2}
              color="white"
              position={[0, -1, 5]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={3}
              color="white"
              position={[-1, -1, 1]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={3}
              color="white"
              position={[1, 1, 1]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={10}
              color="white"
              position={[-10, 0, 14]}
              rotation={[0, Math.PI / 2, Math.PI / 3]}
              scale={[100, 10, 1]}
            />
          </Environment>
        </Canvas>
      </div>
    );
}

/* Hold the GL backbuffer at fixed slide dimensions regardless of the canvas
 * CSS box — preview shows whatever size the studio gives it, render stays
 * at the chosen aspect/resolution. Camera aspect locked to width/height. */
const BackbufferLock: React.FC<{ width: number; height: number }> = ({
  width,
  height,
}) => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    gl.setSize(width, height, false);
    gl.setPixelRatio(1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }, [gl, camera, size.width, size.height, width, height]);
  return null;
};

type ExportBridgeApi = { exportPng: (s?: number) => Promise<string> };
const ExportBridge: React.FC<{
  width: number;
  height: number;
  register: (api: ExportBridgeApi) => void;
}> = ({ width, height, register }) => {
  const { gl, scene, camera, invalidate } = useThree();
  useEffect(() => {
    register({
      exportPng: async (scale = 4) => {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const targetW = width * scale;
        const targetH = height * scale;
        const previousW = gl.domElement.width;
        const previousH = gl.domElement.height;
        try {
          gl.setSize(targetW, targetH, false);
          invalidate();
          gl.render(scene, camera);
          return gl.domElement.toDataURL("image/png");
        } finally {
          gl.setSize(previousW || width, previousH || height, false);
          invalidate();
        }
      },
    });
  }, [gl, scene, camera, invalidate, register, width, height]);
  return null;
};

/* Static card + band, composites frontImage into the GLB atlas. */
type StaticBadgeProps = {
  isMobile: boolean;
  frontImage: string | null;
  imageFit: ImageFit;
  lanyardImage: string | null;
  lanyardWidth: number;
};

const StaticBadge: React.FC<StaticBadgeProps> = ({
  isMobile,
  frontImage,
  imageFit,
  lanyardImage,
  lanyardWidth,
}) => {
  const { nodes, materials } = useGLTF(CARD_GLB) as any;
  /* useTexture must run unconditionally — feed the blank pixel when no
   * lanyardImage / frontImage is set. */
  const customBandTex = useTexture(lanyardImage || BLANK_PIXEL);
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const bandRef = useRef<any>(null);

  /* Default band texture — black fabric with the white zinolt mark drawn
   * at its natural aspect ratio (object-fit: contain with padding) so it
   * never looks squeezed when meshline repeats the texture along the
   * strap. Loaded once at mount via plain Image() so React's useTexture
   * cache doesn't conflict with the canvas-derived texture. */
  const [defaultBandTex, setDefaultBandTex] =
    useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    const W = 256;
    const H = 256;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const paint = (img?: HTMLImageElement) => {
      ctx.fillStyle = "#0A0A0A";
      ctx.fillRect(0, 0, W, H);
      if (img) {
        // contain-fit with ~22% padding on each side so successive tiles
        // along the strap leave a clear black gap between marks.
        const pad = W * 0.22;
        const boxW = W - pad * 2;
        const boxH = H - pad * 2;
        const aspect = img.naturalWidth / img.naturalHeight;
        let dw = boxW;
        let dh = dw / aspect;
        if (dh > boxH) {
          dh = boxH;
          dw = dh * aspect;
        }
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 16;
      tex.needsUpdate = true;
      setDefaultBandTex((prev) => {
        prev?.dispose();
        return tex;
      });
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => paint(img);
    img.onerror = () => paint();
    img.src = ZINOLT_LOGO_WHITE;

    return () => {
      setDefaultBandTex((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, []);

  const bandTex: THREE.Texture =
    lanyardImage && (customBandTex as any).image
      ? (customBandTex as THREE.Texture)
      : defaultBandTex ?? (customBandTex as THREE.Texture);

  /* Composite the front image into the LEFT half of the atlas. The back face
   * (and all card edges) keep the GLB's baked colours. */
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map as THREE.Texture;
    if (!frontImage) return baseMap;

    const baseImg = baseMap.image as HTMLImageElement;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return baseMap;
    ctx.drawImage(baseImg, 0, 0, W, H);

    const img = (frontTex as any).image as HTMLImageElement | undefined;
    if (img) {
      const rect = FRONT_UV_RECT;
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === "contain" ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    }

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [frontImage, imageFit, frontTex, materials.base.map]);

  /* Static pose derived from the GLB bounding box — same recipe as
   * BadgeShell so the card lands at the same screen y / depth. */
  const { groupPos, scale, bandTop, bandBottom } = useMemo(() => {
    const cardGeo = nodes.card.geometry as THREE.BufferGeometry;
    cardGeo.computeBoundingBox();
    const cb = cardGeo.boundingBox!;
    const cardH = cb.max.y - cb.min.y;
    const s = TARGET_CARD_H / cardH;
    const center = new THREE.Vector3(
      (cb.max.x + cb.min.x) / 2,
      (cb.max.y + cb.min.y) / 2,
      (cb.max.z + cb.min.z) / 2,
    );
    const pos = new THREE.Vector3(
      -s * center.x,
      CARD_CENTER_Y - s * center.y,
      -s * center.z + CARD_Z_OFFSET,
    );

    const clipGeo = nodes.clip.geometry as THREE.BufferGeometry;
    clipGeo.computeBoundingBox();
    const clb = clipGeo.boundingBox!;
    const clipTopLocal = new THREE.Vector3(
      (clb.max.x + clb.min.x) / 2,
      clb.max.y,
      (clb.max.z + clb.min.z) / 2,
    );
    const clipTopWorld = clipTopLocal.clone().multiplyScalar(s).add(pos);
    const bb = new THREE.Vector3(
      0,
      clipTopWorld.y - 0.05,
      clipTopWorld.z - 0.04,
    );
    const bt = new THREE.Vector3(0, BAND_TOP_Y, bb.z);

    return {
      groupPos: pos.toArray() as [number, number, number],
      scale: s,
      bandTop: bt,
      bandBottom: bb,
    };
  }, [nodes]);

  /* Static curve points — single chordal sweep from top anchor to clip top.
   * Mid-point is just the linear interpolation so the band reads as straight
   * without the physics swing. */
  const bandPoints = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      bandTop,
      new THREE.Vector3(
        bandTop.x,
        (bandTop.y + bandBottom.y) / 2,
        bandBottom.z,
      ),
      bandBottom,
    ]);
    curve.curveType = "chordal";
    return curve.getPoints(isMobile ? 16 : 32);
  }, [bandTop, bandBottom, isMobile]);

  useEffect(() => {
    if (bandRef.current && bandPoints.length > 0) {
      bandRef.current.geometry.setPoints(bandPoints);
    }
  }, [bandPoints]);

  bandTex.wrapS = bandTex.wrapT = THREE.RepeatWrapping;

  /* meshLineMaterial's `lineWidth` and `map` are shader uniforms, not plain
   * properties — R3F's reconciler doesn't reliably set them after the
   * initial mount. Mutate the uniform values imperatively so width / texture
   * changes reflect without a page reload. */
  const bandMaterialRef = useRef<any>(null);
  useEffect(() => {
    const mat = bandMaterialRef.current;
    if (!mat) return;
    if (mat.uniforms?.lineWidth) {
      mat.uniforms.lineWidth.value = lanyardWidth;
    } else {
      mat.lineWidth = lanyardWidth;
    }
  }, [lanyardWidth]);
  useEffect(() => {
    const mat = bandMaterialRef.current;
    if (!mat || !bandTex) return;
    if (mat.uniforms?.map) {
      mat.uniforms.map.value = bandTex;
    } else {
      mat.map = bandTex;
    }
    mat.needsUpdate = true;
  }, [bandTex]);

  return (
    <>
      <group position={groupPos} scale={scale}>
        <mesh geometry={nodes.card.geometry}>
          <meshPhysicalMaterial
            map={cardMap}
            map-anisotropy={16}
            clearcoat={isMobile ? 0 : 1}
            clearcoatRoughness={0.15}
            roughness={0.9}
            metalness={0.8}
          />
        </mesh>
        <mesh
          geometry={nodes.clip.geometry}
          material={materials.metal}
          material-roughness={0.3}
        />
        <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
      </group>
      <mesh ref={bandRef}>
        <meshLineGeometry />
        <meshLineMaterial
          ref={bandMaterialRef}
          color="white"
          depthTest={false}
          resolution={[1000, 1000]}
          useMap
          map={bandTex}
          repeat={[-4, 1]}
          lineWidth={lanyardWidth}
        />
      </mesh>
    </>
  );
};

useGLTF.preload(CARD_GLB);
