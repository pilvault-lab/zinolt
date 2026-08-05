"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import {
  BillboardComposition,
  billboardDefaultProps,
  BILLBOARD_FPS,
  BILLBOARD_DURATION_FRAMES,
  type BillboardProps,
} from "@/remotion/billboard/BillboardComposition";

const COMP_W = 1080;
const COMP_H = 1920;
const PLAYER_WIDTH = 380;
const PLAYER_HEIGHT = Math.round((PLAYER_WIDTH * COMP_H) / COMP_W);
const PREVIEW_FRAMES = BILLBOARD_FPS * 3;

export const BillboardStudio: React.FC = () => {
  const [quote, setQuote] = useState(billboardDefaultProps.quote);

  const [isRendering, setIsRendering] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const playerRef = useRef<PlayerRef>(null);

  // Responsive player size
  const [playerDims, setPlayerDims] = useState({ w: PLAYER_WIDTH, h: PLAYER_HEIGHT });
  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 768) {
        const w = Math.min(PLAYER_WIDTH, window.innerWidth - 32);
        setPlayerDims({ w, h: Math.round((w * COMP_H) / COMP_W) });
      } else {
        setPlayerDims({ w: PLAYER_WIDTH, h: PLAYER_HEIGHT });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({ container: "mp4", videoCodec: "h264", width: COMP_W, height: COMP_H })
      .then((r) => { if (!cancelled) setCanExport(r.canRender); })
      .catch(() => { if (!cancelled) setCanExport(false); });
    return () => { cancelled = true; };
  }, []);

  // Clear rendered preview when quote changes
  useEffect(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, [quote]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const currentProps: BillboardProps = {
    quote: quote.trim() || billboardDefaultProps.quote,
  };

  const buildComposition = (durationInFrames: number) => ({
    id: "Billboard",
    component: BillboardComposition,
    durationInFrames,
    fps: BILLBOARD_FPS,
    width: COMP_W,
    height: COMP_H,
    defaultProps: billboardDefaultProps,
    calculateMetadata: () => ({ width: COMP_W, height: COMP_H, durationInFrames, fps: BILLBOARD_FPS }),
  });

  const handlePreview = useCallback(async () => {
    setExportError("");
    setIsPreviewing(true);
    setProgress(0);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getBlob } = await renderMediaOnWeb({
        composition: buildComposition(PREVIEW_FRAMES) as any,
        inputProps: currentProps as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: 6_000_000,
        hardwareAcceleration: "prefer-hardware",
        muted: true,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      console.error(err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPreviewing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getBlob } = await renderMediaOnWeb({
        composition: buildComposition(BILLBOARD_DURATION_FRAMES) as any,
        inputProps: currentProps as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: 14_000_000,
        hardwareAcceleration: "prefer-hardware",
        keyframeIntervalInSeconds: 2,
        delayRenderTimeoutInMilliseconds: 60_000,
        muted: true,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "billboard.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(msg && !msg.includes("[object") ? msg : "Export failed. Try Chrome or Edge on desktop.");
    } finally {
      setIsRendering(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  const busy = isRendering || isPreviewing;
  const hasPreview = Boolean(previewUrl);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.colors.paper }}>
      <Header />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">

        {/* LEFT — text input */}
        <aside
          className="flex flex-col gap-6 p-6 overflow-y-auto border-b md:overflow-visible md:w-[300px] md:border-b-0 md:border-r"
          style={{ backgroundColor: BRAND.colors.paper, borderColor: BRAND.colors.grey200 }}
        >
          <div className="flex flex-col gap-3">
            <label
              htmlFor="bb-quote"
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Billboard text
            </label>
            <textarea
              id="bb-quote"
              rows={6}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="Type your quote…"
              className="w-full resize-none rounded-md border px-3 py-2 font-sans text-sm"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: "#FFFFFF",
                outline: "none",
              }}
            />
          </div>
        </aside>

        {/* CENTER — player */}
        <main
          className="flex flex-1 items-center justify-center p-4 md:p-12"
          style={{ backgroundColor: "#5A5A60" }}
        >
          {previewUrl ? (
            <video
              key={previewUrl}
              src={previewUrl}
              autoPlay
              loop
              muted
              playsInline
              style={{ width: playerDims.w, height: playerDims.h, display: "block" }}
            />
          ) : (
            <Player
              ref={playerRef}
              component={BillboardComposition}
              compositionWidth={COMP_W}
              compositionHeight={COMP_H}
              durationInFrames={BILLBOARD_DURATION_FRAMES}
              fps={BILLBOARD_FPS}
              controls
              loop
              inputProps={currentProps}
              style={{ width: playerDims.w, height: playerDims.h }}
            />
          )}
        </main>

        {/* RIGHT — preview + download */}
        <aside
          className="flex flex-col gap-3 p-6 border-t md:border-t-0 md:border-l md:w-[260px]"
          style={{ backgroundColor: BRAND.colors.paper, borderColor: BRAND.colors.grey200 }}
        >
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={busy || canExport === false}
            className="w-full font-sans"
          >
            {isPreviewing
              ? `Rendering… ${Math.round(progress * 100)}%`
              : hasPreview
              ? "Re-preview (3s)"
              : "Preview (3s)"}
          </Button>

          <Button
            onClick={handleDownload}
            disabled={busy || !hasPreview || canExport === false}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>

          {!hasPreview && !busy && (
            <p className="font-sans text-xs leading-snug" style={{ color: BRAND.colors.grey500 }}>
              Preview first to verify corner placement, then download the full clip.
            </p>
          )}

          {canExport === false && (
            <p className="font-sans text-xs leading-snug" style={{ color: BRAND.colors.grey500 }}>
              Exporting needs Chrome or Edge on desktop.
            </p>
          )}

          {exportError && (
            <p role="alert" className="font-sans text-xs leading-snug" style={{ color: BRAND.colors.ink }}>
              {exportError}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
};
