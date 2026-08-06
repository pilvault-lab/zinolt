"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "../../_components/Header";
import {
  StoryCardComposition,
  storyCardDefaultProps,
  STORY_CARD_FPS,
  STORY_CARD_DURATION_FRAMES,
  STORY_CARD_CONFIG,
  type StoryCardProps,
} from "@/remotion/story-card/StoryCardComposition";

const COMP_W = 1080;
const COMP_H = 1920;
const PLAYER_WIDTH = 380;
const PLAYER_HEIGHT = Math.round((PLAYER_WIDTH * COMP_H) / COMP_W);

export const StoryCardStudio: React.FC = () => {
  const [text, setText] = useState(storyCardDefaultProps.text);
  const [selectedBg, setSelectedBg] = useState(
    STORY_CARD_CONFIG.backgrounds[0].src,
  );

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  // Responsive player dims
  const [playerDims, setPlayerDims] = useState({
    w: PLAYER_WIDTH,
    h: PLAYER_HEIGHT,
  });
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

  const currentProps: StoryCardProps = {
    text: text.trim() || storyCardDefaultProps.text,
    backgroundSrc: selectedBg,
  };

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "StoryCard",
          component: StoryCardComposition,
          durationInFrames: STORY_CARD_DURATION_FRAMES,
          fps: STORY_CARD_FPS,
          width: COMP_W,
          height: COMP_H,
          defaultProps: storyCardDefaultProps,
          calculateMetadata: () => ({
            width: COMP_W,
            height: COMP_H,
            durationInFrames: STORY_CARD_DURATION_FRAMES,
            fps: STORY_CARD_FPS,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: currentProps as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: 12_000_000,
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
      a.download = "story-card.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object")
          ? msg
          : "Export failed. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, selectedBg]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">

        {/* LEFT — text + background picker */}
        <aside
          className="flex flex-col gap-6 p-6 overflow-y-auto border-b md:overflow-y-auto md:w-[300px] md:border-b-0 md:border-r"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          {/* Text input */}
          <div className="flex flex-col gap-3">
            <label
              htmlFor="sc-text"
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Story text
            </label>
            <p
              className="font-sans text-[11px] leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Blank line between paragraphs — each becomes a separate beat.
            </p>
            <textarea
              id="sc-text"
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"First thought.\n\nSecond beat.\n\nThird beat."}
              className="w-full resize-none rounded-md border px-3 py-2 font-sans text-sm leading-relaxed"
              style={{
                borderColor: BRAND.colors.grey200,
                color: BRAND.colors.ink,
                backgroundColor: "#FFFFFF",
                outline: "none",
              }}
            />
          </div>

          {/* Background picker */}
          <div className="flex flex-col gap-3">
            <span
              className="font-sans text-xs uppercase tracking-wide"
              style={{ color: BRAND.colors.grey500 }}
            >
              Background
            </span>
            <div className="flex flex-col gap-2">
              {STORY_CARD_CONFIG.backgrounds.map((bg) => {
                const active = selectedBg === bg.src;
                return (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() => setSelectedBg(bg.src)}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5 font-sans text-sm text-left transition-colors"
                    style={{
                      borderColor: active
                        ? BRAND.colors.ink
                        : BRAND.colors.grey200,
                      backgroundColor: active ? BRAND.colors.ink : "#FFFFFF",
                      color: active ? BRAND.colors.paper : BRAND.colors.ink,
                    }}
                  >
                    {/* Swatch preview */}
                    <span
                      className="shrink-0 rounded"
                      style={{
                        width: 28,
                        height: 28,
                        display: "block",
                        backgroundColor:
                          bg.id === "night-city"
                            ? "#060810"
                            : bg.id === "dark-smoke"
                            ? "#0c0b0a"
                            : "#0e1018",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                    {bg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* CENTER — live player */}
        <main
          className="flex flex-1 items-center justify-center p-4 md:p-12"
          style={{ backgroundColor: "#5A5A60" }}
        >
          <Player
            component={StoryCardComposition}
            compositionWidth={COMP_W}
            compositionHeight={COMP_H}
            durationInFrames={STORY_CARD_DURATION_FRAMES}
            fps={STORY_CARD_FPS}
            controls
            loop
            inputProps={currentProps}
            style={{ width: playerDims.w, height: playerDims.h }}
          />
        </main>

        {/* RIGHT — download */}
        <aside
          className="flex flex-col gap-3 p-6 border-t md:border-t-0 md:border-l md:w-[260px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
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
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.grey500 }}
            >
              Exporting needs Chrome or Edge on desktop.
            </p>
          )}

          {exportError && (
            <p
              role="alert"
              className="font-sans text-xs leading-snug"
              style={{ color: BRAND.colors.ink }}
            >
              {exportError}
            </p>
          )}

          <p
            className="font-sans text-xs leading-snug"
            style={{ color: BRAND.colors.grey500 }}
          >
            12-second MP4, 1080×1920, muted. Replace the background loops in{" "}
            <code className="font-mono">public/story-card/backgrounds/</code>{" "}
            with any licensed dark ambient MP4.
          </p>
        </aside>
      </div>
    </div>
  );
};
