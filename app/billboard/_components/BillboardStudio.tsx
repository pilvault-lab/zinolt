"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
} from "@remotion/web-renderer";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
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
const PLAYER_MAX_W = 320;

export const BillboardStudio: React.FC = () => {
  const [quote, setQuote] = useState(billboardDefaultProps.quote);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");
  const playerRef = useRef<PlayerRef>(null);

  // Player dimensions — scale to fit container
  const [playerW, setPlayerW] = useState(PLAYER_MAX_W);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = Math.min(PLAYER_MAX_W, el.clientWidth - 32);
      setPlayerW(w);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const playerH = Math.round((playerW * COMP_H) / COMP_W);

  const inputProps: BillboardProps = {
    quote: quote.trim() || billboardDefaultProps.quote,
    forRender: false,
  };

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({ container: "mp4", videoCodec: "h264", width: COMP_W, height: COMP_H })
      .then((r) => { if (!cancelled) setCanExport(r.canRender); })
      .catch(() => { if (!cancelled) setCanExport(false); });
    return () => { cancelled = true; };
  }, []);

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const renderProps: BillboardProps = {
        quote: quote.trim() || billboardDefaultProps.quote,
        forRender: true,
      };
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: "Billboard",
          component: BillboardComposition,
          durationInFrames: BILLBOARD_DURATION_FRAMES,
          fps: BILLBOARD_FPS,
          width: COMP_W,
          height: COMP_H,
          defaultProps: billboardDefaultProps,
          calculateMetadata: () => ({
            width: COMP_W,
            height: COMP_H,
            durationInFrames: BILLBOARD_DURATION_FRAMES,
            fps: BILLBOARD_FPS,
          }),
        } as any,
        inputProps: renderProps as any,
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

      // Try native share sheet on mobile, fall back to anchor download
      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [new File([blob], "billboard.mp4", { type: "video/mp4" })] })
      ) {
        await navigator.share({
          files: [new File([blob], "billboard.mp4", { type: "video/mp4" })],
        });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = "billboard.mp4";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRendering(false);
      setProgress(0);
    }
  }, [quote]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      <main
        ref={containerRef}
        className="flex flex-1 flex-col items-center gap-6 px-4 py-8"
      >
        {/* Live preview */}
        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            width: playerW,
            height: playerH,
            background: "#111",
            flexShrink: 0,
          }}
        >
          <Player
            ref={playerRef}
            component={BillboardComposition}
            compositionWidth={COMP_W}
            compositionHeight={COMP_H}
            durationInFrames={BILLBOARD_DURATION_FRAMES}
            fps={BILLBOARD_FPS}
            style={{ width: playerW, height: playerH }}
            inputProps={inputProps}
            autoPlay
            loop
            controls={false}
          />
        </div>

        {/* Controls */}
        <div
          className="w-full max-w-sm flex flex-col gap-4 rounded-xl border p-4"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          {/* Quote input */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="bb-quote"
              className="font-sans text-xs font-medium"
              style={{ color: BRAND.colors.ink }}
            >
              Billboard text
            </label>
            <textarea
              id="bb-quote"
              rows={4}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="Type your quote…"
              className="w-full resize-none rounded-lg border px-3 py-2 font-sans text-sm outline-none focus:ring-1"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: BRAND.colors.paper,
              }}
            />
          </div>

          {/* Download */}
          <Button
            onClick={handleDownload}
            disabled={isRendering || canExport === false}
            className="w-full font-sans"
          >
            {isRendering
              ? `Rendering… ${Math.round(progress * 100)}%`
              : "Download video"}
          </Button>

          {canExport === false && (
            <p
              className="font-sans text-xs"
              style={{ color: BRAND.colors.grey500 }}
            >
              Your browser doesn&apos;t support in-browser rendering. Try Chrome
              or Edge.
            </p>
          )}

          {exportError && (
            <p className="font-sans text-xs text-red-500">{exportError}</p>
          )}
        </div>
      </main>
    </div>
  );
};
