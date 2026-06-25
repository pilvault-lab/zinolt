"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player, type PlayerRef } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { Slider } from "radix-ui";
import {
  deleteLocalVideo,
  pingLocalVideoSW,
  prepareLocalVideoSW,
  storeLocalVideo,
} from "@/lib/local-video";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { AUDIO_TRACKS } from "@/lib/audio-tracks";
import { Reel, reelDefaultProps } from "@/remotion/Reel";
import {
  LetterboxReel,
  letterboxDefaultProps,
  type CaptionPosition,
  type LetterboxReelProps,
} from "@/remotion/LetterboxReel";

const LETTERBOX_DEFAULTS = {
  videoScale: letterboxDefaultProps.videoScale,
  videoRadius: letterboxDefaultProps.videoRadius,
  captionPosition: letterboxDefaultProps.captionPosition,
  captionSize: letterboxDefaultProps.captionSize,
};

const CAPTION_POSITION_LABELS: Record<CaptionPosition, string> = {
  above: "Above video",
  below: "Below video",
  overTop: "Over top",
  overBottom: "Over bottom",
};
import { getTemplate } from "@/lib/templates";
import { useSearchParams } from "next/navigation";
import { Header } from "../../_components/Header";

const NO_AUDIO = "__none__";

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

const fmtMMSS = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const PLAYER_WIDTH = 380;
const PLAYER_HEIGHT = (PLAYER_WIDTH * 1920) / 1080;

const DEFAULTS = {
  scale: reelDefaultProps.artworkScale,
  radius: reelDefaultProps.artworkRadius,
  centerY: reelDefaultProps.artworkCenterY,
  shadow: reelDefaultProps.artworkShadow,
};

const COMP_W = 1080;
const COMP_H = 1920;
const COMP_DURATION = 450; // 15 s at 30 fps
const COMP_FPS = 30;

const SliderRow: React.FC<{
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  valueNumber: number;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, valueNumber, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-baseline justify-between">
      <span
        className="font-sans text-xs"
        style={{ color: BRAND.colors.ink }}
      >
        {label}
      </span>
      <span
        className="font-sans text-[11px] tabular-nums"
        style={{ color: BRAND.colors.grey500 }}
      >
        {value}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={valueNumber}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full"
      style={{ accentColor: BRAND.colors.ink }}
    />
  </div>
);

export const Studio: React.FC = () => {
  const searchParams = useSearchParams();
  const template = getTemplate(searchParams.get("template"));
  const isLetterbox = template.id === "letterbox";

  // ── Shared state ──────────────────────────────────────────────────────────
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState<string>("");

  // ── Image-art state (non-letterbox templates) ─────────────────────────────
  const [artworkUrl, setArtworkUrl] = useState<string>("");
  const [artworkAspect, setArtworkAspect] = useState<number>(1);
  const [artworkName, setArtworkName] = useState<string>("");
  const [audioSelection, setAudioSelection] = useState<string>(NO_AUDIO);
  const [artworkScale, setArtworkScale] = useState<number>(DEFAULTS.scale);
  const [artworkRadius, setArtworkRadius] = useState<number>(DEFAULTS.radius);
  const [artworkCenterY, setArtworkCenterY] = useState<number>(
    DEFAULTS.centerY,
  );
  const [artworkShadow, setArtworkShadow] = useState<number>(DEFAULTS.shadow);
  const [showCaption, setShowCaption] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Clip state (letterbox template) ──────────────────────────────────────
  // clipUrl is a virtual HTTP URL (/__local-video/<id>) served by the
  // local-video service worker — same URL works for both the Player and
  // renderMediaOnWeb's worker, with full Range support and zero base64
  // decoding overhead.
  const [clipUrl, setClipUrl] = useState<string>("");
  const [clipName, setClipName] = useState<string>("");
  const [clipRawSecs, setClipRawSecs] = useState<number>(0);
  const [startAt, setStartAt] = useState<number>(0);
  const [endAt, setEndAt] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(2);
  const [videoScale, setVideoScale] = useState<number>(
    LETTERBOX_DEFAULTS.videoScale,
  );
  const [videoRadius, setVideoRadius] = useState<number>(
    LETTERBOX_DEFAULTS.videoRadius,
  );
  const [caption, setCaption] = useState<string>("");
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(
    LETTERBOX_DEFAULTS.captionPosition,
  );
  const [captionSize, setCaptionSize] = useState<number>(
    LETTERBOX_DEFAULTS.captionSize,
  );
  const [clipFormatError, setClipFormatError] = useState<string>("");
  const [activeThumb, setActiveThumb] = useState<0 | 1 | null>(null);
  const clipInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerRef>(null);

  // Eagerly register the local-video service worker so it's ready before the
  // first upload. (Letterbox only — the reel templates don't need it.)
  useEffect(() => {
    if (isLetterbox) prepareLocalVideoSW();
  }, [isLetterbox]);

  // Keep the SW alive while a clip is loaded. Chrome aggressively GCs idle
  // SWs, which would drop our in-memory clip Map and trigger an FFmpeg
  // "data source error" on the next range fetch.
  useEffect(() => {
    if (!isLetterbox) return;
    pingLocalVideoSW();
    const id = setInterval(pingLocalVideoSW, 15_000);
    return () => clearInterval(id);
  }, [isLetterbox]);

  // ── Derived ───────────────────────────────────────────────────────────────
  // Output covers the cropped window [startAt, endAt] at the chosen speed:
  //   output seconds = (endAt - startAt) / speed
  const outputDurationFrames = useMemo(() => {
    if (!isLetterbox || clipRawSecs <= 0 || endAt <= startAt) {
      return COMP_DURATION;
    }
    const windowSecs = endAt - startAt;
    return Math.max(1, Math.ceil((windowSecs / speed) * COMP_FPS));
  }, [isLetterbox, clipRawSecs, startAt, endAt, speed]);

  const compDuration = outputDurationFrames;
  const audioTrack = audioSelection === NO_AUDIO ? "" : audioSelection;
  const hasContent = isLetterbox ? Boolean(clipUrl) : Boolean(artworkUrl);

  // ── canRenderMediaOnWeb probe ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: COMP_W,
      height: COMP_H,
    })
      .then((r) => {
        if (!cancelled) setCanExport(r.canRender);
      })
      .catch(() => {
        if (!cancelled) setCanExport(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── compositionMeta ───────────────────────────────────────────────────────
  const compositionMeta = useMemo((): {
    id: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: React.ComponentType<any>;
    durationInFrames: number;
    fps: number;
    width: number;
    height: number;
    defaultProps: Record<string, unknown>;
  } => {
    if (isLetterbox) {
      return {
        id: template.compositionId,
        component: LetterboxReel,
        durationInFrames: outputDurationFrames,
        fps: COMP_FPS,
        width: COMP_W,
        height: COMP_H,
        defaultProps: letterboxDefaultProps as unknown as Record<string, unknown>,
      };
    }
    return {
      id: template.compositionId,
      component: Reel,
      durationInFrames: COMP_DURATION,
      fps: COMP_FPS,
      width: COMP_W,
      height: COMP_H,
      defaultProps: {
        ...reelDefaultProps,
        backgroundSrc: template.background,
      } as Record<string, unknown>,
    };
  }, [template, isLetterbox, outputDurationFrames]);

  // ── inputProps ────────────────────────────────────────────────────────────
  const inputProps = useMemo(() => {
    if (isLetterbox) {
      return {
        clipSrc: clipUrl,
        brand: BRAND,
        startAt,
        speed,
        forRender: false,
        videoScale,
        videoRadius,
        caption,
        captionPosition,
        captionSize,
      } satisfies LetterboxReelProps;
    }
    return {
      artworkSrc: artworkUrl,
      artworkAspect,
      audioTrack,
      brand: BRAND,
      backgroundSrc: template.background,
      artworkScale,
      artworkRadius,
      artworkCenterY,
      artworkShadow,
      showCaption: template.id === "light-ray" && showCaption,
    };
  }, [
    isLetterbox,
    clipUrl,
    startAt,
    speed,
    videoScale,
    videoRadius,
    caption,
    captionPosition,
    captionSize,
    artworkUrl,
    artworkAspect,
    audioTrack,
    template,
    artworkScale,
    artworkRadius,
    artworkCenterY,
    artworkShadow,
    showCaption,
  ]);

  // ── Image-art handlers ────────────────────────────────────────────────────
  const onFile = useCallback((file: File) => {
    setArtworkName(file.name);
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const aspect =
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? img.naturalWidth / img.naturalHeight
          : 1;
      setArtworkAspect(aspect);
      setArtworkUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = "";
  };

  useEffect(() => {
    if (isLetterbox) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) onFile(file);
          break;
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile, isLetterbox]);

  useEffect(() => {
    return () => {
      if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    };
  }, [artworkUrl]);

  const resetArtwork = () => {
    setArtworkScale(DEFAULTS.scale);
    setArtworkRadius(DEFAULTS.radius);
    setArtworkCenterY(DEFAULTS.centerY);
    setArtworkShadow(DEFAULTS.shadow);
  };

  const isAtDefaults =
    artworkScale === DEFAULTS.scale &&
    artworkRadius === DEFAULTS.radius &&
    artworkCenterY === DEFAULTS.centerY &&
    artworkShadow === DEFAULTS.shadow;

  // ── Clip handlers (letterbox) ─────────────────────────────────────────────
  // Track the latest in-flight upload so a fast re-upload doesn't race the
  // previous one's metadata callback.
  const clipUploadIdRef = useRef(0);

  const onVideoFile = useCallback((file: File) => {
    setClipFormatError("");
    const uploadId = ++clipUploadIdRef.current;
    // Probe metadata via a transient blob URL — instant and doesn't need the
    // service worker to be ready. Once metadata loads we hand the File to the
    // SW and use the virtual /__local-video/<id> URL everywhere else.
    const probeUrl = URL.createObjectURL(file);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    let metadataOk = false;
    vid.onloadedmetadata = () => {
      if (isNaN(vid.duration) || vid.duration <= 0) {
        URL.revokeObjectURL(probeUrl);
        setClipFormatError(
          "Use an MP4 (H.264) clip — couldn't read this file.",
        );
        return;
      }
      metadataOk = true;
      const dur = vid.duration;
      vid.removeAttribute("src");
      vid.load();
      URL.revokeObjectURL(probeUrl);
      void (async () => {
        try {
          const url = await storeLocalVideo(file);
          if (clipUploadIdRef.current !== uploadId) {
            // Superseded by another upload — drop this one.
            await deleteLocalVideo(url);
            return;
          }
          setClipRawSecs(dur);
          setStartAt(0);
          setEndAt(dur);
          setClipName(file.name);
          setClipUrl((prev) => {
            if (prev) void deleteLocalVideo(prev);
            return url;
          });
        } catch (err) {
          console.error("Failed to hand clip to local-video SW", err);
          setClipFormatError(
            "Couldn't prepare this clip — try reloading the page.",
          );
        }
      })();
    };
    vid.onerror = () => {
      if (metadataOk) return;
      URL.revokeObjectURL(probeUrl);
      setClipFormatError(
        "Use an MP4 (H.264) clip — HEVC / ProRes files aren't supported.",
      );
    };
    vid.src = probeUrl;
  }, []);

  const onClipInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onVideoFile(f);
    e.target.value = "";
  };

  // Release the SW-stored clip when the component unmounts.
  useEffect(() => {
    return () => {
      if (clipUrl) void deleteLocalVideo(clipUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shared drop handler ───────────────────────────────────────────────────
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (isLetterbox) {
      onVideoFile(f);
    } else {
      onFile(f);
    }
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const canDownload = hasContent && !isRendering && canExport !== false;

  const handleDownload = useCallback(async () => {
    if (!hasContent) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      // Override forRender so LetterboxReel picks @remotion/media's <Video>
      // (required by the renderer) instead of the Player-only <OffthreadVideo>.
      const renderInputProps = isLetterbox
        ? { ...inputProps, forRender: true }
        : inputProps;
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: compositionMeta as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: renderInputProps as any,
        licenseKey: "free-license",
        // Letterbox showcases the user's clip — bias toward higher quality.
        // Reel templates are mostly graphics + photo art; 12 Mbps is plenty.
        videoBitrate: isLetterbox ? 16_000_000 : 12_000_000,
        hardwareAcceleration: "prefer-hardware",
        // Letterbox clips render muted (audio sped up 12× breaks mediabunny's
        // resampler), so attach audio only for reel templates with a track.
        ...(audioTrack
          ? { audioBitrate: "high" as const }
          : { muted: true }),
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zinolt-${template.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed", err);
      setExportError(
        "Couldn't export in this browser. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [
    hasContent,
    compositionMeta,
    inputProps,
    isLetterbox,
    audioTrack,
    template.id,
  ]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header
        right={
          <Button asChild variant="outline" className="rounded-full font-sans">
            <Link href="/">Change style</Link>
          </Button>
        }
      />

      {/* Three panes */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT */}
        <aside
          className="flex flex-col gap-6 p-6"
          style={{
            width: 300,
            backgroundColor: BRAND.colors.paper,
            borderRight: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          {/* ── Upload zone ── */}
          {isLetterbox ? (
            // Video clip upload (letterbox)
            <div
              onClick={() => clipInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="cursor-pointer rounded-md text-center transition-colors"
              style={{
                border: `2px dashed ${BRAND.colors.grey500}`,
                padding: 24,
                backgroundColor: "#FFFFFF",
              }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  clipInputRef.current?.click();
                }
              }}
            >
              <input
                ref={clipInputRef}
                type="file"
                accept="video/*"
                onChange={onClipInput}
                style={{ display: "none" }}
              />
              {clipName ? (
                <p
                  className="font-sans text-sm"
                  style={{
                    color: BRAND.colors.ink,
                    overflowWrap: "anywhere",
                  }}
                >
                  {clipName}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p
                    className="font-sans text-sm font-medium"
                    style={{ color: BRAND.colors.ink }}
                  >
                    Drop your clip
                  </p>
                  <p
                    className="font-sans text-xs"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    click to browse · MP4 (H.264) or WebM
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Image artwork upload (existing templates)
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="cursor-pointer rounded-md text-center transition-colors"
              style={{
                border: `2px dashed ${BRAND.colors.grey500}`,
                padding: 24,
                backgroundColor: "#FFFFFF",
              }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFileInput}
                style={{ display: "none" }}
              />
              {artworkName ? (
                <p
                  className="font-sans text-sm"
                  style={{
                    color: BRAND.colors.ink,
                    overflowWrap: "anywhere",
                  }}
                >
                  {artworkName}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p
                    className="font-sans text-sm font-medium"
                    style={{ color: BRAND.colors.ink }}
                  >
                    Drop your art
                  </p>
                  <p
                    className="font-sans text-xs"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    click to browse · paste · PNG, JPG, WebP
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Clip format error */}
          {isLetterbox && clipFormatError && (
            <p
              role="alert"
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {clipFormatError}
            </p>
          )}

          {/* ── Crop window + Speed — letterbox only ── */}
          {isLetterbox && (
            <>
              {clipRawSecs > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <label
                      className="font-sans text-xs uppercase tracking-wide"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      Crop
                    </label>
                    <span
                      className="font-sans text-[11px] tabular-nums"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      {fmtTime(startAt)} – {fmtTime(endAt)} / {fmtTime(clipRawSecs)}
                    </span>
                  </div>
                  <Slider.Root
                    className="relative flex h-5 w-full touch-none select-none items-center"
                    min={0}
                    max={clipRawSecs}
                    step={0.1}
                    minStepsBetweenThumbs={1}
                    value={[startAt, endAt]}
                    onValueChange={(vals) => {
                      const [s, e] = vals;
                      // Which thumb moved? Compare against the previous values.
                      const which: 0 | 1 | null =
                        s !== startAt ? 0 : e !== endAt ? 1 : null;
                      if (which !== null) setActiveThumb(which);
                      setStartAt(s);
                      setEndAt(e);
                      // Stop the auto-playing loop while the user scrubs, then
                      // jump the Player to the moment the active handle points
                      // at. seekTo runs after the Player commits the new
                      // inputProps + durationInFrames, so we defer with rAF.
                      playerRef.current?.pause();
                      const newDuration = Math.max(
                        1,
                        Math.ceil(((e - s) / speed) * COMP_FPS),
                      );
                      const targetFrame = which === 1 ? newDuration - 1 : 0;
                      requestAnimationFrame(() => {
                        playerRef.current?.seekTo(targetFrame);
                      });
                    }}
                    onValueCommit={() => setActiveThumb(null)}
                  >
                    <Slider.Track
                      className="relative h-1.5 grow rounded-full"
                      style={{ backgroundColor: BRAND.colors.grey200 }}
                    >
                      <Slider.Range
                        className="absolute h-full rounded-full"
                        style={{ backgroundColor: BRAND.colors.ink }}
                      />
                    </Slider.Track>
                    <Slider.Thumb
                      aria-label="Start"
                      className="group relative block h-4 w-4 rounded-full border-2 bg-white focus:outline-none"
                      style={{ borderColor: BRAND.colors.ink }}
                    >
                      <span
                        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap rounded px-1.5 py-0.5 font-sans text-[10px] tabular-nums transition-opacity ${
                          activeThumb === 0
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        }`}
                        style={{
                          backgroundColor: BRAND.colors.ink,
                          color: BRAND.colors.paper,
                        }}
                      >
                        {fmtMMSS(startAt)}
                      </span>
                    </Slider.Thumb>
                    <Slider.Thumb
                      aria-label="End"
                      className="group relative block h-4 w-4 rounded-full border-2 bg-white focus:outline-none"
                      style={{ borderColor: BRAND.colors.ink }}
                    >
                      <span
                        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap rounded px-1.5 py-0.5 font-sans text-[10px] tabular-nums transition-opacity ${
                          activeThumb === 1
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                        }`}
                        style={{
                          backgroundColor: BRAND.colors.ink,
                          color: BRAND.colors.paper,
                        }}
                      >
                        {fmtMMSS(endAt)}
                      </span>
                    </Slider.Thumb>
                  </Slider.Root>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Speed
                </label>
                <Select
                  value={String(speed)}
                  onValueChange={(v) => setSpeed(Number(v))}
                >
                  <SelectTrigger className="w-full font-sans">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 8, 12].map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}×
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* ── Video size + corner ── */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <label
                    className="font-sans text-xs uppercase tracking-wide"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    Video
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoScale(LETTERBOX_DEFAULTS.videoScale);
                      setVideoRadius(LETTERBOX_DEFAULTS.videoRadius);
                    }}
                    disabled={
                      videoScale === LETTERBOX_DEFAULTS.videoScale &&
                      videoRadius === LETTERBOX_DEFAULTS.videoRadius
                    }
                    className="font-sans text-[11px] underline-offset-2 transition-colors hover:underline disabled:cursor-default disabled:no-underline"
                    style={{
                      color:
                        videoScale === LETTERBOX_DEFAULTS.videoScale &&
                        videoRadius === LETTERBOX_DEFAULTS.videoRadius
                          ? BRAND.colors.grey200
                          : BRAND.colors.grey500,
                      background: "none",
                      padding: 0,
                    }}
                  >
                    Reset
                  </button>
                </div>
                <SliderRow
                  label="Size"
                  value={`${Math.round(videoScale * 100)}%`}
                  min={0.5}
                  max={1}
                  step={0.01}
                  valueNumber={videoScale}
                  onChange={setVideoScale}
                />
                <SliderRow
                  label="Corner"
                  value={`${videoRadius}px`}
                  min={0}
                  max={80}
                  step={1}
                  valueNumber={videoRadius}
                  onChange={setVideoRadius}
                />
              </div>

              {/* ── Caption ── */}
              <div className="flex flex-col gap-3">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                  htmlFor="letterbox-caption"
                >
                  Caption
                </label>
                <input
                  id="letterbox-caption"
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a line around the clip"
                  maxLength={120}
                  className="w-full rounded-md border px-3 py-2 font-sans text-sm"
                  style={{
                    borderColor: BRAND.colors.grey200,
                    color: BRAND.colors.ink,
                    backgroundColor: "#FFFFFF",
                    outline: "none",
                  }}
                />
                {caption.trim() ? (
                  <>
                    <Select
                      value={captionPosition}
                      onValueChange={(v) =>
                        setCaptionPosition(v as CaptionPosition)
                      }
                    >
                      <SelectTrigger className="w-full font-sans">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.keys(CAPTION_POSITION_LABELS) as CaptionPosition[]
                        ).map((p) => (
                          <SelectItem key={p} value={p}>
                            {CAPTION_POSITION_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SliderRow
                      label="Size"
                      value={`${captionSize}px`}
                      min={20}
                      max={80}
                      step={1}
                      valueNumber={captionSize}
                      onChange={setCaptionSize}
                    />
                  </>
                ) : null}
              </div>
            </>
          )}

          {/* ── Audio — non-letterbox only ── */}
          {!isLetterbox && (
            <div className="flex flex-col gap-2">
              <label
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Audio
              </label>
              <Select
                value={audioSelection}
                onValueChange={setAudioSelection}
              >
                <SelectTrigger className="w-full font-sans">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_TRACKS.map((t) => (
                    <SelectItem
                      key={t.file || NO_AUDIO}
                      value={t.file || NO_AUDIO}
                    >
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ── Artwork sliders — non-letterbox only ── */}
          {!isLetterbox && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Artwork
                </label>
                <button
                  type="button"
                  onClick={resetArtwork}
                  disabled={isAtDefaults}
                  className="font-sans text-[11px] underline-offset-2 transition-colors hover:underline disabled:cursor-default disabled:no-underline"
                  style={{
                    color: isAtDefaults
                      ? BRAND.colors.grey200
                      : BRAND.colors.grey500,
                    background: "none",
                    padding: 0,
                  }}
                >
                  Reset
                </button>
              </div>

              <SliderRow
                label="Size"
                value={`${Math.round(artworkScale * 100)}%`}
                min={0.5}
                max={1.2}
                step={0.01}
                valueNumber={artworkScale}
                onChange={setArtworkScale}
              />
              <SliderRow
                label="Corner"
                value={`${artworkRadius}px`}
                min={0}
                max={80}
                step={1}
                valueNumber={artworkRadius}
                onChange={setArtworkRadius}
              />
              <SliderRow
                label="Position"
                value={`${Math.round(artworkCenterY * 100)}%`}
                min={0.25}
                max={0.7}
                step={0.01}
                valueNumber={artworkCenterY}
                onChange={setArtworkCenterY}
              />
              <SliderRow
                label="Shadow"
                value={`${Math.round(artworkShadow * 100)}%`}
                min={0}
                max={1}
                step={0.01}
                valueNumber={artworkShadow}
                onChange={setArtworkShadow}
              />
            </div>
          )}

          {/* ── Caption toggle — light-ray only ── */}
          {template.id === "light-ray" && (
            <div className="flex flex-col gap-2">
              <label
                className="font-sans text-xs uppercase tracking-wide"
                style={{ color: BRAND.colors.grey500 }}
              >
                Caption
              </label>
              <button
                type="button"
                onClick={() => setShowCaption((v) => !v)}
                className="flex items-center justify-between font-sans text-sm"
                style={{ background: "none", padding: 0 }}
              >
                <span style={{ color: BRAND.colors.ink }}>Art of the day</span>
                <span
                  style={{
                    display: "inline-flex",
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: showCaption
                      ? BRAND.colors.ink
                      : BRAND.colors.grey200,
                    position: "relative",
                    flexShrink: 0,
                    transition: "background-color 0.15s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: showCaption ? 19 : 3,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      backgroundColor: "#fff",
                      transition: "left 0.15s",
                    }}
                  />
                </span>
              </button>
            </div>
          )}
        </aside>

        {/* CENTER — Player */}
        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {hasContent ? (
            <Player
              ref={playerRef}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              component={compositionMeta.component as React.ComponentType<any>}
              durationInFrames={compDuration}
              fps={COMP_FPS}
              compositionWidth={COMP_W}
              compositionHeight={COMP_H}
              controls
              loop
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputProps={inputProps as any}
              style={{
                width: PLAYER_WIDTH,
                height: PLAYER_HEIGHT,
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                width: PLAYER_WIDTH,
                height: PLAYER_HEIGHT,
                backgroundColor: "#000",
              }}
            >
              <p
                className="font-sans text-sm"
                style={{ color: BRAND.colors.grey500 }}
              >
                {isLetterbox ? "Upload a clip to preview" : "Upload art to preview"}
              </p>
            </div>
          )}
        </main>

        {/* RIGHT — download */}
        <aside
          className="flex flex-col p-6"
          style={{
            width: 260,
            backgroundColor: BRAND.colors.paper,
            borderLeft: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          <Button
            onClick={handleDownload}
            disabled={!canDownload}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>
          {canExport === false ? (
            <p
              className="mt-3 font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Exporting needs Chrome or Edge on desktop. You can preview here,
              but download won&rsquo;t work in this browser.
            </p>
          ) : null}
          {exportError ? (
            <p
              role="alert"
              className="mt-3 font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {exportError}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
