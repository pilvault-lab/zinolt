import React from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio as MediaAudio } from "@remotion/media";
import { Explainer } from "./Explainer";
import { getConcept } from "@/lib/explainer/concepts";

export const CR_FPS = 60;
export const CR_WIDTH = 1080;
export const CR_HEIGHT = 1920;

/** Fallback duration when no narration has been generated yet (preview). */
export const CR_DEFAULT_DURATION_FRAMES = CR_FPS * 6;

/** Padding tacked onto the narration for the CTA outro. */
export const CR_TAIL_PADDING_SEC = 2.0;

export type ConceptReelWord = { text: string; start: number; end: number };
export type ConceptReelMode = "text" | "diagram";

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
};

export const conceptReelDefaultProps: ConceptReelProps = {
  text: "Compound interest is when your money makes money, and then that money makes money too.",
  words: [],
  audioSrc: "",
  mode: "text",
  diagramId: "",
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

/* ─── Word grouping ───────────────────────────────────────────────────────
 * Group spoken words into readable phrase chunks — ~6-8 words or ~2.6s each,
 * broken on nearby punctuation for natural phrasing.
 * -------------------------------------------------------------------------- */
const MAX_WORDS_PER_GROUP = 8;
const MAX_GROUP_SEC = 2.6;

type PhraseGroup = {
  words: ConceptReelWord[];
  start: number;
  end: number;
};

function groupWords(words: ConceptReelWord[]): PhraseGroup[] {
  if (words.length === 0) return [];
  const groups: PhraseGroup[] = [];
  let current: ConceptReelWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
  };
  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const spanSec = current[current.length - 1].end - current[0].start;
    const last = words[i].text.trim();
    const endsSentence = /[.!?]$/.test(last);
    const endsClause = /[,;:—]$/.test(last);
    const atCap = current.length >= MAX_WORDS_PER_GROUP || spanSec >= MAX_GROUP_SEC;
    if (endsSentence || (endsClause && current.length >= 4) || atCap) {
      flush();
    }
  }
  flush();
  return groups;
}

/* ─── Composition ────────────────────────────────────────────────────────── */
export const ConceptReelComposition: React.FC<ConceptReelProps> = ({
  text,
  words,
  audioSrc,
  mode,
  diagramId,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const tSec = frame / fps;

  const groups = React.useMemo(() => groupWords(words), [words]);
  const activeGroupIdx = React.useMemo(() => {
    if (groups.length === 0) return -1;
    // Find the last group whose start <= tSec.
    let idx = -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].start <= tSec) idx = i;
      else break;
    }
    return idx;
  }, [groups, tSec]);
  const activeGroup = activeGroupIdx >= 0 ? groups[activeGroupIdx] : null;
  const totalDurSec = durationInFrames / fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0A" }}>
      {audioSrc ? (
        <MediaAudio src={audioSrc.startsWith("data:") || audioSrc.startsWith("http") ? audioSrc : staticFile(audioSrc)} />
      ) : null}

      {/* Faint moving glow — subtle life, no distraction */}
      <AmbientGlow tSec={tSec} totalDurSec={totalDurSec} />

      {mode === "text" ? (
        <TextModeBody
          groups={groups}
          activeGroupIdx={activeGroupIdx}
          activeGroup={activeGroup}
          tSec={tSec}
          fallbackText={text}
          hasWords={words.length > 0}
        />
      ) : (
        <DiagramBody diagramId={diagramId ?? ""} words={words} tSec={tSec} />
      )}
    </AbsoluteFill>
  );
};

/* ─── Text Mode ──────────────────────────────────────────────────────────── */
const TextModeBody: React.FC<{
  groups: PhraseGroup[];
  activeGroupIdx: number;
  activeGroup: PhraseGroup | null;
  tSec: number;
  fallbackText: string;
  hasWords: boolean;
}> = ({ groups, activeGroupIdx, activeGroup, tSec, fallbackText, hasWords }) => {
  const centerY = Math.round(CR_HEIGHT * 0.5);
  const blockW = Math.round(CR_WIDTH * 0.86);
  const blockX = Math.round((CR_WIDTH - blockW) / 2);

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
      {!hasWords ? (
        <p
          style={{
            margin: 0,
            fontSize: 62,
            lineHeight: 1.32,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {fallbackText}
        </p>
      ) : activeGroup == null ? null : (
        <GroupText
          key={activeGroupIdx}
          group={activeGroup}
          tSec={tSec}
        />
      )}
    </div>
  );
};

const GroupText: React.FC<{ group: PhraseGroup; tSec: number }> = ({
  group,
  tSec,
}) => {
  // Fade the group in over 180ms from its start.
  const groupOpacity = interpolate(
    tSec,
    [group.start, group.start + 0.18],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const rise = interpolate(
    tSec,
    [group.start, group.start + 0.32],
    [12, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <p
      style={{
        margin: 0,
        fontSize: 78,
        lineHeight: 1.24,
        letterSpacing: -0.5,
        opacity: groupOpacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      {group.words.map((w, i) => {
        const isSpoken = tSec >= w.start;
        const isActive = tSec >= w.start && tSec < w.end + 0.05;
        return (
          <React.Fragment key={i}>
            <span
              style={{
                color: isSpoken ? "#FFFFFF" : "rgba(255,255,255,0.30)",
                transition: "none",
                textShadow: isActive
                  ? "0 0 24px rgba(255,255,255,0.35)"
                  : "none",
              }}
            >
              {w.text}
            </span>
            {i < group.words.length - 1 ? " " : ""}
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
  if (!words || words.length === 0) return CR_DEFAULT_DURATION_FRAMES;
  const last = words[words.length - 1];
  const totalSec = last.end + CR_TAIL_PADDING_SEC;
  return Math.max(CR_FPS, Math.ceil(totalSec * fps));
}
