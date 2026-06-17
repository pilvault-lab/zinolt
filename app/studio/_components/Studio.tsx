"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
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
import { getTemplate } from "@/lib/templates";
import { useSearchParams } from "next/navigation";
import { Header } from "../../_components/Header";

const NO_AUDIO = "__none__";
const PLAYER_WIDTH = 380;
const PLAYER_HEIGHT = (PLAYER_WIDTH * 1920) / 1080;

const DEFAULTS = {
  scale: reelDefaultProps.artworkScale,
  radius: reelDefaultProps.artworkRadius,
  centerY: reelDefaultProps.artworkCenterY,
  shadow: reelDefaultProps.artworkShadow,
};

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

const COMP_W = 1080;
const COMP_H = 1920;
const COMP_DURATION = 450;
const COMP_FPS = 30;

export const Studio: React.FC = () => {
  const searchParams = useSearchParams();
  const template = getTemplate(searchParams.get("template"));

  const compositionMeta = useMemo(
    () => ({
      id: template.compositionId,
      component: Reel,
      durationInFrames: COMP_DURATION,
      fps: COMP_FPS,
      width: COMP_W,
      height: COMP_H,
      defaultProps: { ...reelDefaultProps, backgroundSrc: template.background },
    }),
    [template],
  );

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
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const audioTrack = audioSelection === NO_AUDIO ? "" : audioSelection;

  const inputProps = useMemo(
    () => ({
      artworkSrc: artworkUrl,
      artworkAspect,
      audioTrack,
      brand: BRAND,
      backgroundSrc: template.background,
      artworkScale,
      artworkRadius,
      artworkCenterY,
      artworkShadow,
    }),
    [
      artworkUrl,
      artworkAspect,
      audioTrack,
      template.background,
      artworkScale,
      artworkRadius,
      artworkCenterY,
      artworkShadow,
    ],
  );

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

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const handleDownload = useCallback(async () => {
    if (!artworkUrl) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        composition: compositionMeta,
        inputProps,
        licenseKey: "free-license",
        videoBitrate: 12_000_000,
        ...(audioTrack ? { audioBitrate: "high" as const } : {}),
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "zinolt-lightray.mp4";
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
  }, [artworkUrl, inputProps, audioTrack]);

  const canDownload =
    Boolean(artworkUrl) && !isRendering && canExport !== false;

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
            role="button"
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
                style={{ color: BRAND.colors.ink, overflowWrap: "anywhere" }}
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
                  click to browse · PNG, JPG, WebP
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Audio
            </label>
            <Select value={audioSelection} onValueChange={setAudioSelection}>
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
        </aside>

        {/* CENTER */}
        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {artworkUrl ? (
            <Player
              component={Reel}
              durationInFrames={COMP_DURATION}
              fps={COMP_FPS}
              compositionWidth={COMP_W}
              compositionHeight={COMP_H}
              controls
              loop
              inputProps={inputProps}
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
                Upload art to preview
              </p>
            </div>
          )}
        </main>

        {/* RIGHT */}
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
