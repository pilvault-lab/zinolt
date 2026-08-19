import React from "react";
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio as MediaAudio, Video as MediaVideo } from "@remotion/media";
import { Explainer } from "./Explainer";
import { getConcept } from "@/lib/explainer/concepts";

// Composition runs at 60fps — buttery for the in-studio preview. Exports
// default to CR_EXPORT_FPS_FAST (30fps) because the browser-side renderer
// has to encode every frame; a "Full 60fps" toggle lets you double the
// export cost when you want max smoothness in the mp4.
export const CR_FPS = 60;
export const CR_EXPORT_FPS_FAST = 30;
export const CR_EXPORT_FPS_FULL = 60;
export const CR_WIDTH = 1080;
export const CR_HEIGHT = 1920;

/** Fallback duration when no narration has been generated yet (preview). */
export const CR_DEFAULT_DURATION_FRAMES = CR_FPS * 6;

/** Padding tacked onto the narration for the CTA outro. */
export const CR_TAIL_PADDING_SEC = 2.0;

export type ConceptReelWord = { text: string; start: number; end: number };
export type ConceptReelMode = "text" | "diagram";
export type ConceptReelBgKey = "none" | "bg-1" | "bg-2" | "bg-3" | "bg-4" | "bg-5" | "bg-6";

export const CR_BG_OPTIONS: {
  id: ConceptReelBgKey;
  label: string;
  file: string | null;
}[] = [
  { id: "none", label: "None (black)", file: null },
  { id: "bg-1", label: "BG 1", file: "concept-reel/bg/bg-1.mp4" },
  { id: "bg-2", label: "BG 2", file: "concept-reel/bg/bg-2.mp4" },
  { id: "bg-3", label: "BG 3", file: "concept-reel/bg/bg-3.mp4" },
  { id: "bg-4", label: "BG 4", file: "concept-reel/bg/bg-4.mp4" },
  { id: "bg-5", label: "BG 5", file: "concept-reel/bg/bg-5.mp4" },
  { id: "bg-6", label: "BG 6", file: "concept-reel/bg/bg-6.mp4" },
];

export const CR_BG_FILE: Record<ConceptReelBgKey, string | null> = {
  "none": null,
  "bg-1": "concept-reel/bg/bg-1.mp4",
  "bg-2": "concept-reel/bg/bg-2.mp4",
  "bg-3": "concept-reel/bg/bg-3.mp4",
  "bg-4": "concept-reel/bg/bg-4.mp4",
  "bg-5": "concept-reel/bg/bg-5.mp4",
  "bg-6": "concept-reel/bg/bg-6.mp4",
};

export type ConceptReelProps = {
  /** Full concept text (used for fallback display and grouping). */
  text: string;
  /** Word-level timings from TTS. Empty → static preview. */
  words: ConceptReelWord[];
  /**
   * Audio source. Data URL (data:audio/mpeg;base64,...) works for in-browser
   * render. Empty string → silent preview.
   */
  audioSrc: string;
  mode: ConceptReelMode;
  /** Optional diagram script id for diagram mode (stub for now). */
  diagramId?: string;
  /** Optional fps override — CLI passes this to render at a different rate than CR_FPS. */
  fpsOverride?: number;
  /** Background: "none" = flat black, or one of the bg-N loops from public/concept-reel/bg/. */
  bgKey?: ConceptReelBgKey;
  /** true when we're doing a browser MP4 render — swap OffthreadVideo for @remotion/media <Video>. */
  forRender?: boolean;
};

export const conceptReelDefaultProps: ConceptReelProps = {
  text: "Compound interest is when your money makes money, and then that money makes money too.",
  words: [],
  audioSrc: "",
  mode: "text",
  diagramId: "",
  bgKey: "bg-1",
  forRender: false,
};

/* ─── Font loading ───────────────────────────────────────────────────────── */
// Preload but don't block the render — under puppeteer the FontFace promise
// can hang, and Messina isn't essential (the CSS stack falls back to
// Helvetica). Add the font when it lands, whenever that is.
let _messinaLoaded = false;
if (typeof window !== "undefined" && !_messinaLoaded) {
  _messinaLoaded = true;
  try {
    const face = new FontFace(
      "Messina Sans",
      `url(${staticFile("brand/MessinaSansWeb-VF-Upright.woff2")}) format('woff2')`,
    );
    face.load().then((f) => document.fonts.add(f)).catch(() => {});
  } catch {
    // FontFace unavailable in this environment — CSS fallbacks apply.
  }
}

/* ─── Paragraph → scene grouping ──────────────────────────────────────────
 * Every blank-line-separated paragraph is one scene. Within a scene, karaoke
 * word-highlighting reveals words as they're spoken. Scenes cross-fade at
 * paragraph boundaries.
 *
 * Word indices align 1:1 because both the narration text and the TTS word
 * list tokenize on whitespace.
 * -------------------------------------------------------------------------- */

type Scene = {
  words: ConceptReelWord[];
  start: number;
  end: number;
};

function buildScenes(text: string, words: ConceptReelWord[]): Scene[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0 || words.length === 0) return [];
  const scenes: Scene[] = [];
  let cursor = 0;
  for (const para of paragraphs) {
    const tokens = para.split(/\s+/).filter(Boolean);
    if (cursor >= words.length) break;
    const slice = words.slice(cursor, cursor + tokens.length);
    if (slice.length === 0) break;
    scenes.push({
      words: slice,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
    });
    cursor += tokens.length;
  }
  return scenes;
}

/* ─── Composition ────────────────────────────────────────────────────────── */
export const ConceptReelComposition: React.FC<ConceptReelProps> = ({
  text,
  words,
  audioSrc,
  mode,
  diagramId,
  bgKey = "bg-1",
  forRender = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const tSec = frame / fps;

  const totalDurSec = durationInFrames / fps;
  const bgFile = CR_BG_FILE[bgKey];

  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0A" }}>
      {audioSrc ? (
        <MediaAudio
          src={
            // Absolute (http/https), data URL, or same-origin path (/api/...):
            // use as-is. Anything else is a bundled static asset name.
            audioSrc.startsWith("data:") ||
            audioSrc.startsWith("http") ||
            audioSrc.startsWith("/")
              ? audioSrc
              : staticFile(audioSrc)
          }
        />
      ) : null}

      {/* Background loop — object-fit: cover, muted, plus a dark scrim so text stays legible. */}
      {bgFile ? (
        <BackgroundVideo file={bgFile} forRender={forRender} />
      ) : null}

      {/* Faint moving glow — subtle life, no distraction */}
      <AmbientGlow tSec={tSec} totalDurSec={totalDurSec} />

      {mode === "text" ? (
        <TextModeBody text={text} words={words} tSec={tSec} />
      ) : (
        <DiagramBody diagramId={diagramId ?? ""} words={words} tSec={tSec} />
      )}
    </AbsoluteFill>
  );
};

/* ─── Background loop ────────────────────────────────────────────────────── */
const BackgroundVideo: React.FC<{ file: string; forRender: boolean }> = ({
  file,
  forRender,
}) => {
  const src = staticFile(file);
  const style: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  };
  return (
    <>
      {forRender ? (
        <MediaVideo src={src} muted volume={0} style={style} />
      ) : (
        <OffthreadVideo src={src} muted volume={0} style={style} />
      )}
      {/* Dark scrim keeps karaoke text high-contrast on top of any bg. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
    </>
  );
};

/* ─── Text Mode — paragraph scenes with karaoke word-reveal inside ──────── */

const SCENE_FADE_SEC = 0.22;

const TextModeBody: React.FC<{
  text: string;
  words: ConceptReelWord[];
  tSec: number;
}> = ({ text, words, tSec }) => {
  const scenes = React.useMemo(() => buildScenes(text, words), [text, words]);
  const blockW = Math.round(CR_WIDTH * 0.86);
  const blockX = Math.round((CR_WIDTH - blockW) / 2);
  const centerY = Math.round(CR_HEIGHT * 0.5);

  // No narration yet — show the first paragraph as a static preview.
  if (words.length === 0 || scenes.length === 0) {
    const firstPara = text.split(/\n\n+/)[0] || text;
    return (
      <div
        style={{
          position: "absolute",
          left: blockX,
          width: blockW,
          top: centerY,
          transform: "translateY(-50%)",
          textAlign: "center",
          fontFamily: "'Messina Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
          color: "rgba(255,255,255,0.55)",
          fontSize: 62,
          fontWeight: 500,
          lineHeight: 1.32,
        }}
      >
        {firstPara}
      </div>
    );
  }

  // Active scene: last scene whose start (minus fade lead-in) has arrived.
  let activeIdx = -1;
  for (let i = 0; i < scenes.length; i++) {
    if (tSec >= scenes[i].start - SCENE_FADE_SEC) activeIdx = i;
    else break;
  }
  if (activeIdx < 0) return null;
  const scene = scenes[activeIdx];
  const nextStart = scenes[activeIdx + 1]?.start ?? Infinity;

  return (
    <div
      style={{
        position: "absolute",
        left: blockX,
        width: blockW,
        top: centerY,
        transform: "translateY(-50%)",
        textAlign: "center",
        fontFamily:
          "'Messina Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontWeight: 500,
        color: "#FFFFFF",
      }}
    >
      <SceneText
        key={activeIdx}
        scene={scene}
        nextStart={nextStart}
        tSec={tSec}
      />
    </div>
  );
};

const SceneText: React.FC<{
  scene: Scene;
  nextStart: number;
  tSec: number;
}> = ({ scene, nextStart, tSec }) => {
  // Cross-fade: opacity ramps up around `scene.start`, ramps down around `nextStart`.
  const fadeIn = interpolate(
    tSec,
    [scene.start - SCENE_FADE_SEC, scene.start + SCENE_FADE_SEC * 0.5],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const fadeOut = Number.isFinite(nextStart)
    ? interpolate(
        tSec,
        [nextStart - SCENE_FADE_SEC, nextStart],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : 1;
  const opacity = Math.min(fadeIn, fadeOut);
  const rise = interpolate(
    tSec,
    [scene.start - SCENE_FADE_SEC, scene.start + SCENE_FADE_SEC],
    [12, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Auto-size the type down for longer paragraphs so they still fit the block.
  const charCount = scene.words.reduce((n, w) => n + w.text.length + 1, 0);
  const fontSize =
    charCount < 40 ? 92 : charCount < 90 ? 78 : charCount < 160 ? 64 : 54;

  return (
    <p
      style={{
        margin: 0,
        fontSize,
        lineHeight: 1.24,
        letterSpacing: -0.5,
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      {scene.words.map((w, i) => {
        const isSpoken = tSec >= w.start;
        const isActive = tSec >= w.start && tSec < w.end + 0.05;
        return (
          <React.Fragment key={i}>
            <span
              style={{
                color: isSpoken ? "#FFFFFF" : "rgba(255,255,255,0.30)",
                textShadow: isActive
                  ? "0 0 24px rgba(255,255,255,0.35)"
                  : "none",
              }}
            >
              {w.text}
            </span>
            {i < scene.words.length - 1 ? " " : ""}
          </React.Fragment>
        );
      })}
    </p>
  );
};

/* ─── Diagram Mode ───────────────────────────────────────────────────────── */
const DiagramBody: React.FC<{
  diagramId: string;
  words: ConceptReelWord[];
  tSec: number;
}> = ({ diagramId, words, tSec }) => {
  const script = getConcept(diagramId);
  if (!script) {
    return (
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.55)",
          fontFamily: "'Messina Sans', sans-serif",
          fontSize: 30,
          textAlign: "center",
          padding: 80,
        }}
      >
        <div>
          <div style={{ fontSize: 22, letterSpacing: 4, marginBottom: 24 }}>
            DIAGRAM MODE
          </div>
          <div>Pick a concept from the sidebar.</div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <>
      {/* Title band above chart */}
      <div
        style={{
          position: "absolute",
          top: 200,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "'Messina Sans', sans-serif",
          color: "rgba(255,255,255,0.85)",
          fontSize: 62,
          fontWeight: 600,
          letterSpacing: -0.5,
        }}
      >
        {script.label}
      </div>
      <Explainer script={script} words={words} tSec={tSec} />
    </>
  );
};

/* ─── Ambient background glow ────────────────────────────────────────────── */
const AmbientGlow: React.FC<{ tSec: number; totalDurSec: number }> = ({
  tSec,
}) => {
  const cx = 50 + Math.sin(tSec * 0.35) * 12;
  const cy = 50 + Math.cos(tSec * 0.28) * 10;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 60% 45% at ${cx}% ${cy}%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0) 60%)`,
        pointerEvents: "none",
      }}
    />
  );
};

/** Compute the composition length in frames from an optional word list. */
export function computeConceptReelDurationFrames(
  words: ConceptReelWord[] | undefined,
  fps: number = CR_FPS,
): number {
  if (!words || words.length === 0) return Math.max(fps, CR_FPS * 6);
  const last = words[words.length - 1];
  const totalSec = last.end + CR_TAIL_PADDING_SEC;
  return Math.max(fps, Math.ceil(totalSec * fps));
}
