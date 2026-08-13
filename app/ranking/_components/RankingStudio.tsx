"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
} from "@remotion/web-renderer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RANKINGS, DEFAULT_RANKING_SLUG, getRankingBySlug } from "@/lib/ranking";
import {
  RankingComposition,
  rankingDefaultProps,
  RK_FPS,
  RK_HEIGHT,
  RK_TOTAL_FRAMES,
  RK_WIDTH,
  computeRankingTiming,
  type RankingProps,
} from "@/remotion/ranking/Ranking";
import { Header } from "../../_components/Header";
import { stripVideoMetadata } from "@/lib/strip-video-metadata";

const PLAYER_MAX_W = 420;

function makeVideoUrl(blob: Blob): { url: string; videoBlob: Blob } {
  const videoBlob =
    blob.type === "video/mp4" ? blob : new Blob([blob], { type: "video/mp4" });
  return { url: URL.createObjectURL(videoBlob), videoBlob };
}

async function trySaveOrShare(
  videoBlob: Blob,
  url: string,
  filename: string,
): Promise<{ shared: boolean }> {
  const file = new File([videoBlob], filename, { type: "video/mp4" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (typeof nav.share === "function") {
    try {
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: "Ranking" });
        return { shared: true };
      }
    } catch {
      /* user cancelled or share failed — fall through */
    }
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return { shared: false };
}

export const RankingStudio: React.FC = () => {
  const [slug, setSlug] = useState<string>(DEFAULT_RANKING_SLUG);
  const ranking = useMemo(() => getRankingBySlug(slug), [slug]);

  const [titleOverride, setTitleOverride] = useState("");
  const [topN, setTopN] = useState<number>(5);
  const [useInitials, setUseInitials] = useState<boolean>(false);

  // Reset overrides whenever the base ranking changes.
  useEffect(() => {
    setTitleOverride("");
  }, [slug]);

  const inputProps: RankingProps = useMemo(
    () => ({
      ranking,
      titleOverride: titleOverride || undefined,
      topN,
      useInitials,
    }),
    [ranking, titleOverride, topN, useInitials],
  );

  // Duration depends on topN — recompute per render.
  const timing = useMemo(() => computeRankingTiming(topN), [topN]);
  const totalFrames = Math.max(RK_TOTAL_FRAMES, timing.totalFrames);
  const durationSec = totalFrames / RK_FPS;

  // Player sizing.
  const [playerDims, setPlayerDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      const maxW = window.innerWidth < 768 ? window.innerWidth - 32 : PLAYER_MAX_W;
      const w = Math.min(maxW, RK_WIDTH);
      setPlayerDims({ w, h: Math.round((w * RK_HEIGHT) / RK_WIDTH) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const playerW = playerDims.w || Math.min(PLAYER_MAX_W, RK_WIDTH);
  const playerH = playerDims.h || Math.round((playerW * RK_HEIGHT) / RK_WIDTH);

  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState("");
  const [renderedVideo, setRenderedVideo] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    return () => {
      if (renderedVideo?.url) URL.revokeObjectURL(renderedVideo.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedVideo]);

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: RK_WIDTH,
      height: RK_HEIGHT,
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

  const handleDownload = useCallback(async () => {
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: "Ranking",
          component: RankingComposition,
          durationInFrames: totalFrames,
          fps: RK_FPS,
          width: RK_WIDTH,
          height: RK_HEIGHT,
          defaultProps: rankingDefaultProps,
          calculateMetadata: () => ({
            width: RK_WIDTH,
            height: RK_HEIGHT,
            durationInFrames: totalFrames,
            fps: RK_FPS,
          }),
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: { ...inputProps, forRender: true } as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: "very-high",
        hardwareAcceleration: "prefer-hardware",
        keyframeIntervalInSeconds: 4,
        muted: true,
        delayRenderTimeoutInMilliseconds: 180_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await stripVideoMetadata(await getBlob());
      const filename = `ranking_${ranking.slug}_top${topN}.mp4`;
      const { url, videoBlob } = makeVideoUrl(blob);
      setRenderedVideo((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url, name: filename };
      });
      await trySaveOrShare(videoBlob, url, filename);
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
  }, [inputProps, ranking.slug, topN, totalFrames]);

  return (
    <div className="flex min-h-dvh flex-col bg-ds-surface">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h1 className="type-display-lg text-ds-on-surface">Ranking</h1>
          <span className="type-label-sm text-ds-on-surface-muted">
            9:16 · {durationSec.toFixed(0)}s · {RK_FPS}fps
          </span>
        </div>

        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* LEFT: controls */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="type-label-sm text-ds-on-surface-muted">
                Ranking
              </label>
              <Select value={slug} onValueChange={setSlug}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANKINGS.map((r) => (
                    <SelectItem key={r.slug} value={r.slug}>
                      {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="type-label-sm text-ds-on-surface-muted">
                {ranking.entries.length} available · ranked by {ranking.metricLabel}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="type-label-sm text-ds-on-surface-muted">
                Title override
              </label>
              <Input
                placeholder={ranking.title}
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="type-label-sm text-ds-on-surface-muted">
                Show top N
              </label>
              <Select
                value={String(topN)}
                onValueChange={(v) => setTopN(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[3, 5, 7, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Top {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="use-initials"
                type="checkbox"
                checked={useInitials}
                onChange={(e) => setUseInitials(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="use-initials" className="type-label-sm text-ds-on-surface">
                Use initials instead of photos
              </label>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button
                onClick={handleDownload}
                disabled={isRendering || canExport === false}
                className="w-full"
              >
                {isRendering
                  ? `Rendering… ${Math.round(progress * 100)}%`
                  : "Download video"}
              </Button>
              {canExport === false && (
                <div className="type-label-sm text-red-500">
                  This browser can&apos;t render mp4/h264. Try Chrome or Edge on desktop.
                </div>
              )}
              {exportError && (
                <div className="type-label-sm text-red-500">{exportError}</div>
              )}
              {renderedVideo && (
                <div className="flex flex-col gap-2">
                  <video
                    src={renderedVideo.url}
                    controls
                    playsInline
                    className="w-full rounded-md border border-ds-border-hairline"
                  />
                  <a
                    href={renderedVideo.url}
                    download={renderedVideo.name}
                    className="type-label-sm text-ds-on-surface-muted underline"
                  >
                    Or download again ({renderedVideo.name})
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: preview */}
          <div className="flex flex-col items-center">
            <div
              className="overflow-hidden rounded-lg border border-ds-border-hairline bg-black"
              style={{ width: playerW, height: playerH }}
            >
              <Player
                component={RankingComposition}
                inputProps={inputProps}
                durationInFrames={totalFrames}
                fps={RK_FPS}
                compositionWidth={RK_WIDTH}
                compositionHeight={RK_HEIGHT}
                style={{ width: "100%", height: "100%" }}
                controls
                loop
                autoPlay
              />
            </div>
            <div className="mt-2 type-label-sm text-ds-on-surface-muted">
              Preview — {durationSec.toFixed(0)}s
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
