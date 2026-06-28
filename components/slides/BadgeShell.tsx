"use client";

/* eslint-disable react/no-unknown-property */
import {
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { toCanvas } from "html-to-image";

export type BackgroundTone = "neutral" | "warm" | "cool";

/* Orientation presets — pixel dimensions for the rendered slide. */
export type Orientation = "9:16" | "1:1" | "4:5";
export const ORIENTATIONS: Record<
  Orientation,
  { label: string; width: number; height: number }
> = {
  "9:16": { label: "9 : 16", width: 1080, height: 1920 },
  "4:5": { label: "4 : 5", width: 1080, height: 1350 },
  "1:1": { label: "1 : 1", width: 1080, height: 1080 },
};
export const DEFAULT_ORIENTATION: Orientation = "9:16";

// Softer center → midnight charcoal vignettes. Narrower contrast range
// lets the layered ambient card shadows blend naturally instead of
// fighting a hard rim of light.
const TONE_STOPS: Record<BackgroundTone, [string, string, string]> = {
  neutral: ["#2c2c30", "#1a1a1d", "#0d0d10"],
  warm: ["#322a26", "#1d1715", "#0d0908"],
  cool: ["#262d36", "#161a20", "#080a0d"],
};

/** Default preview/export dimensions. Use ORIENTATIONS[orientation] when an
 *  orientation is selected; these constants remain the 9:16 fallback. */
export const SLIDE_W = ORIENTATIONS[DEFAULT_ORIENTATION].width;
export const SLIDE_H = ORIENTATIONS[DEFAULT_ORIENTATION].height;

const CARD_GLB = "/lanyard/card.glb";

// Visible source-of-truth for layouts that want to know how much room they
// have inside the card face. The texture is rendered into a 900×1430 div; the
// content area inside that div has 72px side padding, 180px top (clear of the
// ring) and 110px bottom (clear of the zinolt footer).
const CARD_PX_W = 900;
const CARD_PX_H = 1430;
const CONTENT_PAD_X = 72;
const CONTENT_PAD_TOP = 180;
const CONTENT_PAD_BOTTOM = 110;

export const CARD_CONTENT = {
  width: CARD_PX_W - CONTENT_PAD_X * 2,
  height: CARD_PX_H - CONTENT_PAD_TOP - CONTENT_PAD_BOTTOM,
} as const;

// Static pose tuning. Camera fov=20 at z=30 → visible height ≈10.6 units. We
// scale the imported card.glb so its body fills TARGET_CARD_H, hang it slightly
// below centre, and run the band up to BAND_TOP_Y near the top of the frame.
const TARGET_CARD_H = 6.4;
const CARD_CENTER_Y = -0.5;
// Push the whole card forward in world Z so it sits visibly proud of the
// backdrop + shadow plane — reads as a real lanyard hanging *off* the wall
// rather than printed flush against it. The band's bottom anchor is derived
// from the card's transform, so it travels with the card automatically.
const CARD_Z_OFFSET = 0.65;
// Push the ribbon top above the visible frame so the strap reads as
// running off-screen (visible half-height ≈ 5.3 at z≈0, fov=20 from z=30).
const BAND_TOP_Y = 5.22;
const BAND_WIDTH = 0.7;
// Layout texture sits just inside the card's rounded white edge.
const FRONT_INSET = 0.93;

export type BadgeShellHandle = {
  /** scale defaults to 4 → renders at 4× SLIDE_W/SLIDE_H = 4320×7680 (4K UHD vertical). */
  exportPng: (scale?: number) => Promise<string>;
};

type Props = {
  /** The layout JSX (e.g. <LayoutRender values={values} />) that gets baked
   * into the card's front-face texture. */
  children: ReactNode;
  /** Backdrop vignette tone — neutral/warm/cool. */
  backgroundTone?: BackgroundTone;
  /** Card body tint — colors the frosted-glass material. */
  cardColor?: string;
  /** Card text color. */
  cardInkColor?: string;
  /** Strap fabric color. */
  strapColor?: string;
  /** Render orientation. Defaults to 9:16 portrait. */
  orientation?: Orientation;
};

export const BadgeShell = forwardRef<BadgeShellHandle, Props>(
  function BadgeShell(
    {
      children,
      backgroundTone = "neutral",
      cardColor = "#FAFAFA",
      cardInkColor = "#0A0A0A",
      strapColor = "#0A0A0A",
      orientation = DEFAULT_ORIENTATION,
    },
    ref,
  ) {
    const dims = ORIENTATIONS[orientation];
    const slideW = dims.width;
    const slideH = dims.height;
    const textureSourceRef = useRef<HTMLDivElement>(null);
    const [cardTexture, setCardTexture] = useState<THREE.CanvasTexture | null>(
      null,
    );
    const exportApiRef = useRef<ExportBridgeApi | null>(null);

    // Re-rasterise the layout DOM into a CanvasTexture whenever children
    // change. Debounced so a stream of keystrokes doesn't thrash the GPU.
    useEffect(() => {
      const el = textureSourceRef.current;
      if (!el) return;
      let cancelled = false;
      const timer = window.setTimeout(async () => {
        try {
          const canvas = await toCanvas(el, {
            width: CARD_PX_W,
            height: CARD_PX_H,
            pixelRatio: 2,
            cacheBust: false,
            backgroundColor: cardColor,
          });
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 16;
          tex.needsUpdate = true;
          setCardTexture((prev) => {
            prev?.dispose();
            return tex;
          });
        } catch (err) {
          console.error("BadgeShell: layout→texture render failed", err);
        }
      }, 80);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
      // We deliberately don't depend on `children` identity (always changes).
      // Instead use the serialised DOM as the cache key.
    }, [children, cardColor]);

    useImperativeHandle(ref, () => ({
      exportPng: async (scale = 4) => {
        if (!exportApiRef.current) throw new Error("Canvas not ready");
        return exportApiRef.current.exportPng(scale);
      },
    }));

    return (
      <>
        {/* Off-screen layout source — rasterised into the card texture. */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: -99999,
            left: 0,
            width: CARD_PX_W,
            height: CARD_PX_H,
            pointerEvents: "none",
          }}
        >
          <div
            ref={textureSourceRef}
            style={{
              position: "relative",
              width: CARD_PX_W,
              height: CARD_PX_H,
              backgroundColor: cardColor,
              overflow: "hidden",
              fontFamily:
                "'AngelList', system-ui, -apple-system, sans-serif",
              color: cardInkColor,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: CONTENT_PAD_TOP,
                width: CARD_PX_W,
                height: CARD_PX_H - CONTENT_PAD_TOP - CONTENT_PAD_BOTTOM,
                // Editorial framing — content sits in a centered flex column
                // with at least 3rem of breathing room on each side, so every
                // layout inherits the same balanced visual weight.
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                paddingLeft: "3rem",
                paddingRight: "3rem",
                boxSizing: "border-box",
              }}
            >
              {children}
            </div>
          </div>
        </div>

        <Canvas
          dpr={1}
          gl={{
            alpha: false,
            antialias: true,
            preserveDrawingBuffer: true,
          }}
          camera={{ position: [0, 0, 30], fov: 20 }}
          // Canvas fills its CSS box; the GL backbuffer is forced to
          // SLIDE_W × SLIDE_H by <BackbufferLock /> so exports stay
          // 1080 × 1920 regardless of preview display size.
          style={{ width: "100%", height: "100%", display: "block" }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(0x09090b), 1);
          }}
        >
          <BackbufferLock width={slideW} height={slideH} />
          <ExportBridge
            width={slideW}
            height={slideH}
            register={(api) => {
              exportApiRef.current = api;
            }}
          />
          <Scene
            cardTexture={cardTexture}
            backgroundTone={backgroundTone}
            cardColor={cardColor}
          />
        </Canvas>
      </>
    );
  },
);

/** Force the GL backbuffer to stay at exactly SLIDE_W × SLIDE_H regardless of
 *  the canvas's CSS box. R3F auto-sizes the backbuffer to the container's
 *  `getBoundingClientRect`; a CSS-scaled preview wrapper would shrink that
 *  rect and we'd lose export resolution. This re-runs every time R3F's
 *  internal `size` state changes (which is also right after R3F's own
 *  `gl.setSize`), so our override wins. */
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

type ExportBridgeApi = { exportPng: (scale?: number) => Promise<string> };

const ExportBridge: React.FC<{
  width: number;
  height: number;
  register: (api: ExportBridgeApi) => void;
}> = ({ width, height, register }) => {
  const { gl, scene, camera, invalidate } = useThree();
  useEffect(() => {
    register({
      exportPng: async (scale = 4) => {
        // Two rAFs to flush any pending state. We then resize the WebGL
        // backbuffer to scale × width/height for the active orientation,
        // render at that density, read the pixels back via toDataURL, and
        // restore the preview size.
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

const Scene: React.FC<{
  cardTexture: THREE.CanvasTexture | null;
  backgroundTone: BackgroundTone;
  cardColor: string;
}> = ({ cardTexture, backgroundTone, cardColor }) => {
  // Generate a radial-gradient backdrop texture per tone.
  const backdropTexture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(512, 520, 0, 512, 520, 760);
    const stops = TONE_STOPS[backgroundTone];
    grad.addColorStop(0, stops[0]);
    grad.addColorStop(0.5, stops[1]);
    grad.addColorStop(1, stops[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [backgroundTone]);

  // Three-layer floating ambient shadow, mirroring the CSS spec:
  //   0 2px  4px rgba(0,0,0,0.15)  — sharp structural grounding
  //   0 10px 25px rgba(0,0,0,0.25) — mid soft
  //   0 30px 70px rgba(0,0,0,0.45) — ultra-wide ambient
  // Painted largest-first with default source-over so layers stack the way
  // a browser composites three independent box-shadows.
  const shadowTexture = useMemo(() => {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const cx = size / 2;
    const cy = size / 2;

    // Layer 3 — ultra-wide ambient (offset 30px → ~150 texels; blur 70px → big radius).
    const wide = ctx.createRadialGradient(cx, cy + 150, 0, cx, cy + 150, size * 0.5);
    wide.addColorStop(0, "rgba(0,0,0,0.45)");
    wide.addColorStop(0.4, "rgba(0,0,0,0.18)");
    wide.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wide;
    ctx.fillRect(0, 0, size, size);

    // Layer 2 — mid soft (offset 10px → ~50 texels; blur 25px).
    const mid = ctx.createRadialGradient(cx, cy + 50, 0, cx, cy + 50, size * 0.28);
    mid.addColorStop(0, "rgba(0,0,0,0.25)");
    mid.addColorStop(0.55, "rgba(0,0,0,0.10)");
    mid.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mid;
    ctx.fillRect(0, 0, size, size);

    // Layer 1 — sharp structural grounding (offset 2px → ~10 texels; blur 4px tight).
    const sharp = ctx.createRadialGradient(cx, cy + 10, size * 0.04, cx, cy + 10, size * 0.13);
    sharp.addColorStop(0, "rgba(0,0,0,0.15)");
    sharp.addColorStop(0.7, "rgba(0,0,0,0.05)");
    sharp.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sharp;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    return tex;
  }, []);

  return (
    <>
      <ambientLight intensity={Math.PI * 0.7} />

      {/* Backdrop plane — sits behind everything */}
      <mesh position={[0, 0, -8]}>
        <planeGeometry args={[40, 60]} />
        <meshBasicMaterial map={backdropTexture} toneMapped={false} />
      </mesh>

      {/* Floating drop shadow: layered radial gradient close to the card so
          the badge reads as physically floating above the canvas. */}
      <mesh position={[0, -1.1, -2]}>
        <planeGeometry args={[10, 12]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Suspense fallback={null}>
        <LanyardRig cardTexture={cardTexture} cardColor={cardColor} />
      </Suspense>

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
    </>
  );
};

// The imported card.glb plus a static, draped band — the look of the React Bits
// lanyard frozen in a resting pose so it composes (and exports) deterministically.
const LanyardRig: React.FC<{
  cardTexture: THREE.CanvasTexture | null;
  cardColor: string;
}> = ({ cardTexture, cardColor }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { nodes, materials } = useGLTF(CARD_GLB) as any;

  // Derive the rig transform from the card geometry's bounding box so the card
  // body fills TARGET_CARD_H and sits at CARD_CENTER_Y, then place the front
  // overlay plane and compute the band endpoints — all in one pass.
  const { groupPos, scale, front, bandTop, bandBottom } = useMemo(() => {
    const cardGeo = nodes.card.geometry as THREE.BufferGeometry;
    cardGeo.computeBoundingBox();
    const cb = cardGeo.boundingBox!;
    const cardH = cb.max.y - cb.min.y;
    const cardW = cb.max.x - cb.min.x;
    const s = TARGET_CARD_H / cardH;
    const center = new THREE.Vector3(
      (cb.max.x + cb.min.x) / 2,
      (cb.max.y + cb.min.y) / 2,
      (cb.max.z + cb.min.z) / 2,
    );
    const pos = new THREE.Vector3(
      -s * center.x,
      CARD_CENTER_Y - s * center.y,
      // Card sits well in front of the backdrop. Band, clip, and front
      // overlay plane all derive from this transform, so they travel
      // together to the new depth.
      -s * center.z + CARD_Z_OFFSET,
    );

    const frontPlane = {
      w: cardW * FRONT_INSET,
      h: cardH * FRONT_INSET,
      pos: [center.x, center.y, cb.max.z + 0.01] as [number, number, number],
    };

    // Band runs from a fixed anchor near the top of frame down to the clip ring
    // at the top of the card (local → world via the rig transform).
    const clipGeo = nodes.clip.geometry as THREE.BufferGeometry;
    clipGeo.computeBoundingBox();
    const clb = clipGeo.boundingBox!;
    const clipTopLocal = new THREE.Vector3(
      (clb.max.x + clb.min.x) / 2,
      clb.max.y,
      (clb.max.z + clb.min.z) / 2,
    );
    const clipTopWorld = clipTopLocal.clone().multiplyScalar(s).add(pos);
    // Tuck the ribbon's bottom edge slightly into the clip ring so there's
    // never a visible gap between hardware and fabric.
    const bb = new THREE.Vector3(
      0,
      clipTopWorld.y - 0.05,
      clipTopWorld.z - 0.04,
    );
    const bt = new THREE.Vector3(0, BAND_TOP_Y, bb.z);

    return {
      groupPos: pos.toArray() as [number, number, number],
      scale: s,
      front: frontPlane,
      bandTop: bt,
      bandBottom: bb,
    };
  }, [nodes]);

  // Imperatively sync map + color on the front face material — the
  // declarative `<meshBasicMaterial map={cardTexture}/>` pattern can leave
  // a stale `.map` when both texture and colour change in the same render.
  const frontMatRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    const mat = frontMatRef.current;
    if (!mat) return;
    mat.map = cardTexture;
    mat.color.set(cardTexture ? "#ffffff" : cardColor);
    mat.needsUpdate = true;
  }, [cardTexture, cardColor]);

  return (
    <>
      <group position={groupPos} scale={scale}>
        {/* Flat colored card body — basic material, no clearcoat, no
            environment glow. Just the chosen card color. */}
        <mesh geometry={nodes.card.geometry}>
          <meshBasicMaterial color={cardColor} toneMapped={false} />
        </mesh>
        <mesh
          geometry={nodes.clip.geometry}
          material={materials.metal}
          material-roughness={0.3}
        />
        <mesh geometry={nodes.clamp.geometry} material={materials.metal} />

        {/* Layout content overlaid on the card face. */}
        <mesh position={front.pos}>
          <planeGeometry args={[front.w, front.h]} />
          <meshBasicMaterial ref={frontMatRef} toneMapped={false} />
        </mesh>
      </group>

      {/* Strap inherits the same material as the hook hardware so it reads
          as a continuous metallic ribbon. */}
      <StaticBand
        bottom={bandBottom}
        top={bandTop}
        width={BAND_WIDTH}
        material={materials.metal}
      />
    </>
  );
};

// Flat vertical ribbon using the same metal material as the hook + clamp,
// so the strap/clip read as one continuous hardware piece.
const StaticBand: React.FC<{
  bottom: THREE.Vector3;
  top: THREE.Vector3;
  width: number;
  material: THREE.Material;
}> = ({ bottom, top, width, material }) => {
  const height = top.y - bottom.y;
  const centerY = (top.y + bottom.y) / 2;

  return (
    <mesh position={[bottom.x, centerY, bottom.z]}>
      <planeGeometry args={[width, height]} />
      <primitive
        object={material}
        attach="material"
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

useGLTF.preload(CARD_GLB);
