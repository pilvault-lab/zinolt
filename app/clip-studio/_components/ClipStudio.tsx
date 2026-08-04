"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";

type CaptionSegment = { start: number; end: number; text: string };
type HeatmapBucket = { start: number; end: number; value: number };

type FetchResponse = {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  transcript: CaptionSegment[];
  heatmap: HeatmapBucket[];
  captionsAvailable: boolean;
};

type CutResult = {
  start: number;
  end: number;
  label?: string;
  filename: string;
  url: string;
};

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

type ParsedClip = { start: number; end: number; label?: string; caption?: string };

/**
 * Parse the "paste from Claude" text into clip requests. Accepts several
 * shapes; whichever comes back is fine:
 *   0:12-0:45
 *   0:12-0:45 | opening hook
 *   0:12-0:45 | opening hook | NVIDIA CEO on why the next decade belongs to inference
 *   [{"start":12.5,"end":45.2,"label":"...","caption":"..."}]
 */
function parseTimestampInput(raw: string): ParsedClip[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // JSON path
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Array<{
        start?: number;
        end?: number;
        label?: string;
        caption?: string;
      }>;
      const arr = Array.isArray(j) ? j : [j];
      return arr
        .filter((c) => typeof c.start === "number" && typeof c.end === "number")
        .map((c) => ({ start: c.start!, end: c.end!, label: c.label, caption: c.caption }));
    } catch {
      /* fall through to line parser */
    }
  }
  // Line-based path — 3 pipe-separated columns: range | label | caption
  const out: ParsedClip[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned || cleaned.startsWith("#") || cleaned.startsWith("//")) continue;
    const parts = cleaned.split("|").map((s) => s.trim());
    const range = parts[0];
    const label = parts[1] || undefined;
    const caption = parts.slice(2).join(" | ").trim() || undefined;
    const m = range.match(/^([\d:.]+)\s*[-–]\s*([\d:.]+)$/);
    if (!m) continue;
    const start = toSeconds(m[1]);
    const end = toSeconds(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ start, end, label, caption });
  }
  return out;
}

function toSeconds(s: string): number {
  if (s.includes(":")) {
    const parts = s.split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return NaN;
    // hh:mm:ss or mm:ss
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  return Number(s);
}

/** Overlay heatmap peaks onto transcript so hot segments visually pop. */
function useSegmentIntensities(
  transcript: CaptionSegment[],
  heatmap: HeatmapBucket[],
): number[] {
  return useMemo(() => {
    if (heatmap.length === 0) return transcript.map(() => 0);
    const maxV = Math.max(...heatmap.map((h) => h.value), 1e-9);
    return transcript.map((seg) => {
      const midpoint = (seg.start + seg.end) / 2;
      const bucket = heatmap.find((h) => midpoint >= h.start && midpoint <= h.end);
      return bucket ? bucket.value / maxV : 0;
    });
  }, [transcript, heatmap]);
}

/** A copy-friendly plain-text transcript. */
function buildTranscriptText(transcript: CaptionSegment[]): string {
  return transcript.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join("\n");
}

const CLAUDE_PROMPT_TEMPLATE = `I have a transcript from a YouTube video with timestamps.
Find the 10 most clip-worthy 25-45 second segments (compelling stories,
hot takes, quotable one-liners, actionable insights). Prefer stretches
where multiple ideas land in sequence.

Return ONLY a plain list, one per line, in this exact format:
mm:ss-mm:ss | short-label | social-post-caption

Where:
- short-label is 2-4 words for internal reference (e.g. "the pivot moment")
- social-post-caption is a 6-12 word headline suitable for the video overlay
  and Instagram/TikTok caption (e.g. "NVIDIA CEO on why the next decade
  belongs to inference"). Punchy, no hashtags, no quotes.

Transcript:
`;

export const ClipStudio: React.FC = () => {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [data, setData] = useState<FetchResponse | null>(null);
  const [error, setError] = useState("");

  const [tsInput, setTsInput] = useState("");
  const [cutting, setCutting] = useState(false);
  const [cuts, setCuts] = useState<CutResult[]>([]);
  const [cutErrors, setCutErrors] = useState<Array<{ index: number; error: string }>>([]);

  const [copied, setCopied] = useState<"" | "prompt" | "transcript">("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Treatment options
  const [orientation, setOrientation] = useState<"full-bleed" | "letterboxed">("full-bleed");
  const [burnCaptions, setBurnCaptions] = useState(false);

  // Per-clip headline overrides — keyed by clip index in the current parse.
  // Reset when the paste text changes.
  const [headlines, setHeadlines] = useState<Record<number, string>>({});

  const intensities = useSegmentIntensities(data?.transcript ?? [], data?.heatmap ?? []);
  const parsedClips = useMemo(() => parseTimestampInput(tsInput), [tsInput]);

  // When the paste changes, reset headline overrides — the caption-derived
  // defaults recompute automatically from parsedClips[i].caption below.
  useMemo(() => setHeadlines({}), [tsInput]);
  const headlineFor = useCallback(
    (i: number): string => headlines[i] ?? parsedClips[i]?.caption ?? "",
    [headlines, parsedClips],
  );

  const doFetch = useCallback(async () => {
    setError("");
    setCuts([]);
    setCutErrors([]);
    setFetching(true);
    try {
      const res = await fetch("/api/clip-studio/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(String(j.error ?? "fetch_failed"));
        setData(null);
      } else {
        setData(j as FetchResponse);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(false);
    }
  }, [url]);

  const doCut = useCallback(async () => {
    if (!data || parsedClips.length === 0) return;
    setCutting(true);
    setCutErrors([]);
    try {
      // Attach the effective headline per clip (only used in letterbox mode
      // server-side, but always sent so re-cuts can flip modes freely).
      const clipsWithHeadlines = parsedClips.map((c, i) => ({
        ...c,
        headline: headlineFor(i),
      }));
      const res = await fetch("/api/clip-studio/cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoId: data.videoId,
          clips: clipsWithHeadlines,
          orientation,
          burnCaptions,
        }),
      });
      const j = (await res.json()) as { results?: CutResult[]; errors?: typeof cutErrors };
      if (!res.ok) {
        setCutErrors([{ index: -1, error: "cut_failed" }]);
      } else {
        setCuts(j.results ?? []);
        setCutErrors(j.errors ?? []);
      }
    } catch (e) {
      setCutErrors([{ index: -1, error: (e as Error).message }]);
    } finally {
      setCutting(false);
    }
  }, [data, parsedClips, orientation, burnCaptions, headlineFor]);

  const copyToClipboard = useCallback(async (text: string, marker: "prompt" | "transcript") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(marker);
      setTimeout(() => setCopied(""), 1400);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!previewUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewUrl]);

  const transcriptText = useMemo(
    () => (data ? buildTranscriptText(data.transcript) : ""),
    [data],
  );
  const claudePayload = useMemo(
    () => CLAUDE_PROMPT_TEMPLATE + transcriptText,
    [transcriptText],
  );

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.colors.paper }}>
      <Header
        right={
          <Button asChild variant="outline" className="rounded-full font-sans">
            <Link href="/">Change style</Link>
          </Button>
        }
      />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* LEFT: URL + transcript */}
        <aside
          className="flex flex-col gap-4 overflow-y-auto p-6 md:w-[520px] md:border-r"
          style={{ borderColor: BRAND.colors.grey200 }}
        >
          <div className="flex flex-col gap-2">
            <label className="font-sans text-xs uppercase tracking-wide"
                   style={{ color: BRAND.colors.grey500 }}>
              YouTube URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void doFetch(); }}
                placeholder="https://youtube.com/watch?v=..."
                className="min-w-0 flex-1 rounded-md border px-3 py-2 font-sans text-sm"
                style={{
                  borderColor: BRAND.colors.grey200,
                  backgroundColor: "#fff",
                  color: BRAND.colors.ink,
                }}
              />
              <Button onClick={doFetch} disabled={fetching || !url.trim()}>
                {fetching ? "Fetching…" : "Fetch"}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="font-sans text-xs" style={{ color: BRAND.colors.ink }}>
                {error}
              </p>
            ) : null}
          </div>

          {data ? (
            <>
              <div className="flex flex-col gap-1 rounded-md border p-3 font-sans text-xs"
                   style={{ borderColor: BRAND.colors.grey200, color: BRAND.colors.grey500 }}>
                <div style={{ color: BRAND.colors.ink, fontWeight: 600 }}>{data.title}</div>
                <div>{data.channel} · {fmtTime(data.durationSec)} · {data.transcript.length} caption segments · {data.heatmap.length} heatmap points</div>
                {!data.captionsAvailable ? (
                  <div style={{ color: BRAND.colors.ink }}>
                    No auto-captions found. Falling back to whisper isn&apos;t wired yet.
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => copyToClipboard(claudePayload, "prompt")}
                  variant="outline"
                  className="flex-1 font-sans text-xs"
                >
                  {copied === "prompt" ? "Copied ✓" : "Copy prompt + transcript"}
                </Button>
                <Button
                  onClick={() => copyToClipboard(transcriptText, "transcript")}
                  variant="outline"
                  className="flex-1 font-sans text-xs"
                >
                  {copied === "transcript" ? "Copied ✓" : "Copy transcript only"}
                </Button>
              </div>

              {/* Treatment controls — apply to every cut. */}
              <div
                className="flex flex-col gap-2 rounded-md border p-3"
                style={{ borderColor: BRAND.colors.grey200 }}
              >
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Orientation
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={orientation === "full-bleed" ? "default" : "outline"}
                    onClick={() => setOrientation("full-bleed")}
                    className="flex-1 font-sans text-xs"
                  >
                    Full-bleed
                  </Button>
                  <Button
                    variant={orientation === "letterboxed" ? "default" : "outline"}
                    onClick={() => setOrientation("letterboxed")}
                    className="flex-1 font-sans text-xs"
                  >
                    Letterboxed
                  </Button>
                </div>
                <label
                  className="mt-1 flex items-center gap-2 font-sans text-xs"
                  style={{ color: BRAND.colors.ink }}
                >
                  <input
                    type="checkbox"
                    checked={burnCaptions}
                    onChange={(e) => setBurnCaptions(e.target.checked)}
                  />
                  Burn captions (lower third)
                </label>
                <p
                  className="font-sans text-[11px] leading-snug"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Output is always 1080×1920 with the Vernavle watermark. In
                  letterboxed mode, each clip gets a headline pulled from
                  the Claude caption — edit any of them below before cutting.
                </p>
              </div>

              <div className="flex flex-col gap-1 max-h-[65vh] overflow-y-auto rounded-md border p-2 font-sans text-xs"
                   style={{ borderColor: BRAND.colors.grey200 }}>
                {data.transcript.map((seg, i) => {
                  const heat = intensities[i] ?? 0;
                  const bg =
                    heat > 0.7 ? "rgba(255,80,80,0.18)"
                    : heat > 0.45 ? "rgba(255,150,50,0.14)"
                    : heat > 0.2 ? "rgba(255,220,80,0.10)"
                    : "transparent";
                  return (
                    <div
                      key={i}
                      className="flex gap-2 py-0.5 px-1 rounded"
                      style={{ backgroundColor: bg }}
                    >
                      <span className="tabular-nums shrink-0"
                            style={{ color: BRAND.colors.grey500, minWidth: 44 }}>
                        {fmtTime(seg.start)}
                      </span>
                      <span style={{ color: BRAND.colors.ink }}>{seg.text}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </aside>

        {/* RIGHT: paste timestamps + cuts */}
        <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
              style={{ backgroundColor: BRAND.colors.paper }}>
          <div className="flex flex-col gap-2">
            <label className="font-sans text-xs uppercase tracking-wide"
                   style={{ color: BRAND.colors.grey500 }}>
              Paste timestamps from Claude
            </label>
            <p className="font-sans text-[11px] leading-snug" style={{ color: BRAND.colors.grey500 }}>
              One per line: <code>mm:ss-mm:ss | short-label</code>. Also accepts JSON, seconds, or hh:mm:ss.
            </p>
            <textarea
              value={tsInput}
              onChange={(e) => setTsInput(e.target.value)}
              rows={10}
              placeholder={"12:34-13:05 | opening story\n45:10-45:52 | the punchline"}
              className="rounded-md border p-3 font-mono text-xs"
              style={{
                borderColor: BRAND.colors.grey200,
                backgroundColor: "#fff",
                color: BRAND.colors.ink,
                minHeight: 200,
              }}
            />
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs" style={{ color: BRAND.colors.grey500 }}>
                Parsed: {parsedClips.length} clip{parsedClips.length === 1 ? "" : "s"}
              </span>
              <Button
                onClick={doCut}
                disabled={!data || cutting || parsedClips.length === 0 || parsedClips.length > 30}
                className="font-sans"
              >
                {cutting ? "Cutting…" : `Cut ${parsedClips.length} clip${parsedClips.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>

          {parsedClips.length > 0 ? (
            <div
              className="flex flex-col gap-3 rounded-md border p-3 font-sans text-xs"
              style={{ borderColor: BRAND.colors.grey200 }}
            >
              <div
                className="uppercase tracking-wide"
                style={{ fontSize: 10, color: BRAND.colors.grey500 }}
              >
                Preview ({parsedClips.length})
              </div>
              {parsedClips.map((c, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div
                    className="tabular-nums"
                    style={{ color: BRAND.colors.ink }}
                  >
                    {i + 1}. {fmtTime(c.start)} – {fmtTime(c.end)}{" "}
                    <span style={{ color: BRAND.colors.grey500 }}>
                      ({(c.end - c.start).toFixed(1)}s)
                    </span>
                    {c.label ? (
                      <span style={{ color: BRAND.colors.grey500 }}>
                        {" "}
                        · {c.label}
                      </span>
                    ) : null}
                  </div>
                  {orientation === "letterboxed" ? (
                    <input
                      type="text"
                      value={headlineFor(i)}
                      onChange={(e) =>
                        setHeadlines((prev) => ({ ...prev, [i]: e.target.value }))
                      }
                      placeholder="Headline for the video overlay"
                      className="w-full rounded border px-2 py-1 text-[11px]"
                      style={{
                        borderColor: BRAND.colors.grey200,
                        backgroundColor: "#fff",
                        color: BRAND.colors.ink,
                      }}
                      maxLength={100}
                    />
                  ) : c.caption ? (
                    <div
                      className="text-[11px] leading-snug"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      Caption: {c.caption}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {cuts.length > 0 ? (
            <div className="flex flex-col gap-2">
              <label className="font-sans text-xs uppercase tracking-wide"
                     style={{ color: BRAND.colors.grey500 }}>
                Cuts ({cuts.length})
              </label>
              <ol className="flex flex-col gap-2 font-sans text-xs">
                {cuts.map((c, i) => (
                  <li key={c.filename} className="flex items-center justify-between gap-2 rounded-md border p-2"
                      style={{ borderColor: BRAND.colors.grey200, color: BRAND.colors.ink }}>
                    <span className="tabular-nums">
                      {i + 1}. {fmtTime(c.start)}–{fmtTime(c.end)}
                      {c.label ? <span style={{ color: BRAND.colors.grey500 }}>&nbsp;· {c.label}</span> : null}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => setPreviewUrl(c.url)}
                        className="underline font-sans text-xs"
                        style={{ color: BRAND.colors.grey500 }}
                      >
                        Preview
                      </button>
                      <a
                        href={c.url}
                        download
                        className="underline font-sans text-xs"
                        style={{ color: BRAND.colors.ink }}
                      >
                        Download
                      </a>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {cutErrors.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border p-3 font-sans text-xs"
                 style={{ borderColor: BRAND.colors.grey200, color: BRAND.colors.ink }}>
              <div className="uppercase tracking-wide" style={{ fontSize: 10, color: BRAND.colors.grey500 }}>
                Cut errors
              </div>
              {cutErrors.map((e, i) => (
                <div key={i}>#{e.index >= 0 ? e.index + 1 : "-"}: {e.error}</div>
              ))}
            </div>
          ) : null}
        </main>
      </div>

      {/* Video preview modal */}
      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={() => setPreviewUrl(null)}
        >
          <video
            ref={videoRef}
            src={previewUrl}
            autoPlay
            controls
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: "90vh",
              maxWidth: "90vw",
              borderRadius: 8,
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
