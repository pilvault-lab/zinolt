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
const PREVIEW_FRAMES = BILLBOARD_FPS * 3; // 3-second preview render

type Stage = "idle" | "previewing" | "preview-ready" | "downloading";

export const BillboardStudio: React.FC = () => {
  const [quote, setQuote] = useState(billboardDefaultProps.quote);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const playerRef = useRef<PlayerRef>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Responsive player width
  const [playerW, setPlayerW] = useState(PLAYER_MAX_W);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      setPlayerW(Math.min(PLAYER_MAX_W, el.clientWidth - 32));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const playerH = Math.round((playerW * COMP_H) / COMP_W);

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({ container: "mp4", videoCodec: "h264", width: COMP_W, height: COMP_H })
      .then((r) => { if (!cancelled) setCanExport(r.canRender); })
      .catch(() => { if (!cancelled) setCanExport(false); });
    return () => { cancelled = true; };
  }, []);

  // Revoke old preview URL when quote changes so the stale preview disappears
  useEffect(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setStage("idle");
  }, [quote]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const renderProps = useCallback(
    (): BillboardProps => ({
      quote: quote.trim() || billboardDefaultProps.quote,
    }),
    [quote],
  );

  const buildComposition = useCallback(
    (durationInFrames: number) => ({
      id: "Billboard",
      component: BillboardComposition,
      durationInFrames,
      fps: BILLBOARD_FPS,
      width: COMP_W,
      height: COMP_H,
      defaultProps: billboardDefaultProps,
      calculateMetadata: () => ({
        width: COMP_W,
        height: COMP_H,
        durationInFrames,
        fps: BILLBOARD_FPS,
      }),
    }),
    [],
  );

  const handlePreview = useCallback(async () => {
    setError("");
    setStage("previewing");
    setProgress(0);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getBlob } = await renderMediaOnWeb({
        composition: buildComposition(PREVIEW_FRAMES) as any,
        inputProps: renderProps() as any,
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
      setStage("preview-ready");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }, [buildComposition, renderProps]);

  const handleDownload = useCallback(async () => {
    setError("");
    setStage("downloading");
    setProgress(0);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getBlob } = await renderMediaOnWeb({
        composition: buildComposition(BILLBOARD_DURATION_FRAMES) as any,
        inputProps: renderProps() as any,
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

      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [new File([blob], "billboard.mp4", { type: "video/mp4" })] })
      ) {
        await navigator.share({ files: [new File([blob], "billboard.mp4", { type: "video/mp4" })] });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = "billboard.mp4";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
      setStage("preview-ready"); // return to preview-ready state after download
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setStage("preview-ready");
    }
  }, [buildComposition, renderProps]);

  const busy = stage === "previewing" || stage === "downloading";
  const liveProps: BillboardProps = renderProps();

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.colors.paper }}>
      <Header />

      <main
        ref={containerRef}
        className="flex flex-1 flex-col items-center gap-6 px-4 py-8"
      >
        {/* Video area — rendered preview takes over from Player once ready */}
        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            width: playerW,
            height: playerH,
            background: "#111",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* Live Remotion Player — always mounted, hidden once preview is ready */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: previewUrl ? 0 : 1,
              transition: "opacity 0.2s",
              pointerEvents: previewUrl ? "none" : "auto",
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
              inputProps={liveProps}
              autoPlay
              loop
              controls={false}
            />
          </div>

          {/* Rendered preview video */}
          {previewUrl && (
            <video
              key={previewUrl}
              src={previewUrl}
              autoPlay
              loop
              muted
              playsInline
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}

          {/* Progress overlay while rendering */}
          {busy && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.55)",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: "60%",
                  height: 4,
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(progress * 100)}%`,
                    background: "#fff",
                    borderRadius: 2,
                    transition: "width 0.1s",
                  }}
                />
              </div>
              <span
                style={{
                  color: "#fff",
                  fontFamily: "sans-serif",
                  fontSize: 13,
                  opacity: 0.85,
                }}
              >
                {stage === "previewing" ? "Rendering preview…" : "Rendering…"}{" "}
                {Math.round(progress * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div
          className="w-full max-w-sm flex flex-col gap-3 rounded-xl border p-4"
          style={{ backgroundColor: BRAND.colors.paper, borderColor: BRAND.colors.grey200 }}
        >
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

          {/* Preview → Download two-step */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={busy || canExport === false}
              className="flex-1 font-sans"
            >
              {stage === "previewing"
                ? `${Math.round(progress * 100)}%`
                : stage === "preview-ready"
                ? "Re-preview"
                : "Preview (3s)"}
            </Button>

            <Button
              onClick={handleDownload}
              disabled={busy || stage !== "preview-ready" || canExport === false}
              className="flex-1 font-sans"
            >
              {stage === "downloading"
                ? `${Math.round(progress * 100)}%`
                : "Download"}
            </Button>
          </div>

          {stage === "idle" && (
            <p className="font-sans text-[11px]" style={{ color: BRAND.colors.grey500 }}>
              Render a 3-second preview first, then download the full clip.
            </p>
          )}

          {canExport === false && (
            <p className="font-sans text-xs" style={{ color: BRAND.colors.grey500 }}>
              Your browser doesn&apos;t support in-browser rendering. Try Chrome or Edge.
            </p>
          )}

          {error && <p className="font-sans text-xs text-red-500">{error}</p>}
        </div>
      </main>
    </div>
  );
};
