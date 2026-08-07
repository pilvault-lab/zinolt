"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
} from "@remotion/web-renderer";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import type { DailyMoversPayload } from "@/lib/daily-movers";
import {
  DailyMovers,
  dailyMoversDefaultProps,
  DM_FPS,
  DM_HEIGHT,
  DM_TOTAL_FRAMES,
  DM_WIDTH,
  type DailyMoversProps,
} from "@/remotion/daily-movers/DailyMovers";
import { Header } from "../../_components/Header";
import { stripVideoMetadata } from "@/lib/strip-video-metadata";

const PLAYER_MAX_W = 380;
const MAX_PICKS = 5;

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

async function saveOrShare(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: "video/mp4" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string }) => Promise<void>;
  };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === "function") {
    try {
      await nav.share({ files: [file], title: "Daily Movers" });
      return;
    } catch {
      /* user cancelled — fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const DailyMoversStudio: React.FC = () => {
  const [payload, setPayload] = useState<DailyMoversPayload | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [overrides, setOverrides] = useState<string[]>([]);

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: DM_WIDTH,
      height: DM_HEIGHT,
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

  const load = useCallback(async (symbols?: string[]) => {
    setFetchError("");
    setFetching(true);
    try {
      const qs = symbols && symbols.length ? `?symbols=${symbols.join(",")}` : "";
      const res = await fetch(`/api/daily-movers/data${qs}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setFetchError(
          j.error === "no_data" ? "Yahoo returned no quotes. Try again." : "Fetch failed.",
        );
        return;
      }
      const data = (await res.json()) as DailyMoversPayload;
      setPayload(data);
    } catch {
      setFetchError("Network error.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePool = useCallback((symbol: string) => {
    setOverrides((prev) => {
      if (prev.includes(symbol)) return prev.filter((s) => s !== symbol);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, symbol];
    });
  }, []);

  const apply = useCallback(() => {
    void load(overrides);
  }, [load, overrides]);

  const clearOverrides = useCallback(() => {
    setOverrides([]);
    void load();
  }, [load]);

  const inputProps = useMemo<DailyMoversProps>(
    () =>
      payload
        ? {
            dateLabel: payload.dateLabel,
            picks: payload.picks,
            forRender: false,
          }
        : dailyMoversDefaultProps,
    [payload],
  );

  const [playerDims, setPlayerDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      const maxW = window.innerWidth < 768 ? window.innerWidth - 32 : PLAYER_MAX_W;
      const w = Math.min(maxW, DM_WIDTH);
      setPlayerDims({ w, h: Math.round((w * DM_HEIGHT) / DM_WIDTH) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const playerW = playerDims.w || Math.min(PLAYER_MAX_W, DM_WIDTH);
  const playerH = playerDims.h || Math.round((playerW * DM_HEIGHT) / DM_WIDTH);

  const handleDownload = useCallback(async () => {
    if (!payload) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: "DailyMovers",
          component: DailyMovers,
          durationInFrames: DM_TOTAL_FRAMES,
          fps: DM_FPS,
          width: DM_WIDTH,
          height: DM_HEIGHT,
          defaultProps: dailyMoversDefaultProps,
          calculateMetadata: () => ({
            width: DM_WIDTH,
            height: DM_HEIGHT,
            durationInFrames: DM_TOTAL_FRAMES,
            fps: DM_FPS,
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
        audioCodec: null,
        delayRenderTimeoutInMilliseconds: 60_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await stripVideoMetadata(await getBlob());
      const filename = `daily-movers_${payload.sessionDate}.mp4`;
      await saveOrShare(blob, filename);
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
  }, [payload, inputProps]);

  const activePickSymbols = new Set(payload?.picks.map((p) => p.symbol) ?? []);

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

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <aside
          className="order-3 flex flex-col gap-6 overflow-y-auto p-6 border-t md:order-none md:border-t-0 md:border-r md:w-[380px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void load()}
              disabled={fetching}
              className="flex-1 font-sans"
            >
              {fetching ? "Loading…" : "Load today"}
            </Button>
            {payload ? (
              <span
                className="font-sans text-xs uppercase tracking-widest"
                style={{ color: BRAND.colors.grey500 }}
              >
                {payload.dateLabel}
              </span>
            ) : null}
          </div>

          {fetchError ? (
            <p role="alert" className="font-sans text-xs" style={{ color: BRAND.colors.ink }}>
              {fetchError}
            </p>
          ) : null}

          {payload ? (
            <>
              <div className="flex flex-col gap-2">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Current picks (top {MAX_PICKS})
                </label>
                <ol className="flex flex-col gap-2 font-sans text-sm">
                  {payload.picks.map((p, i) => (
                    <li
                      key={p.symbol}
                      className="flex items-baseline justify-between rounded-md border p-2"
                      style={{
                        borderColor: BRAND.colors.grey200,
                        color: BRAND.colors.ink,
                      }}
                    >
                      <span>
                        <span
                          className="mr-2 tabular-nums"
                          style={{ color: BRAND.colors.grey500 }}
                        >
                          {i + 1}.
                        </span>
                        <span style={{ fontWeight: 600 }}>{p.symbol}</span>
                        <span
                          className="ml-2 text-xs"
                          style={{ color: BRAND.colors.grey500 }}
                        >
                          {p.name.slice(0, 26)}
                        </span>
                      </span>
                      <span className="text-xs tabular-nums" style={{ fontWeight: 600 }}>
                        {fmtPct(p.changePercent)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <label
                    className="font-sans text-xs uppercase tracking-wide"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    Editorial swap ({overrides.length}/{MAX_PICKS})
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={apply}
                      disabled={fetching}
                      className="font-sans text-xs underline disabled:opacity-40"
                      style={{ color: BRAND.colors.ink }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={clearOverrides}
                      disabled={overrides.length === 0}
                      className="font-sans text-xs underline disabled:opacity-40"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 font-sans text-xs">
                  {payload.pool.map((q) => {
                    const active = overrides.includes(q.symbol);
                    const isCurrent = activePickSymbols.has(q.symbol);
                    return (
                      <label
                        key={q.symbol}
                        className="flex items-center justify-between rounded-md border px-2 py-2 cursor-pointer"
                        style={{
                          borderColor: active ? BRAND.colors.ink : BRAND.colors.grey200,
                          color: BRAND.colors.ink,
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => togglePool(q.symbol)}
                            disabled={!active && overrides.length >= MAX_PICKS}
                          />
                          <span style={{ fontWeight: 600 }}>{q.symbol}</span>
                          <span style={{ color: BRAND.colors.grey500 }}>
                            {q.shortName.slice(0, 22)}
                          </span>
                          {isCurrent ? (
                            <span
                              className="text-[9px] uppercase tracking-widest"
                              style={{ color: BRAND.colors.grey500 }}
                            >
                              in
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular-nums">
                          {fmtPct(q.regularMarketChangePercent)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </aside>

        <main
          className="order-1 flex flex-1 items-center justify-center p-4 md:order-none md:p-12"
          style={{ backgroundColor: "#1a1a1a" }}
        >
          {payload ? (
            <Player
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              component={DailyMovers as any}
              durationInFrames={DM_TOTAL_FRAMES}
              fps={DM_FPS}
              compositionWidth={DM_WIDTH}
              compositionHeight={DM_HEIGHT}
              controls
              loop
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputProps={inputProps as any}
              style={{ width: playerW, height: playerH }}
            />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{ width: playerW, height: playerH, backgroundColor: "#000" }}
            >
              <p className="font-sans text-sm" style={{ color: BRAND.colors.grey500 }}>
                {fetching ? "Loading market data…" : "Click Load today"}
              </p>
            </div>
          )}
        </main>

        <aside
          className="order-2 flex flex-col p-4 border-t md:order-none md:border-t-0 md:border-l md:w-[260px] md:p-6"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
          }}
        >
          <Button
            onClick={handleDownload}
            disabled={!payload || isRendering || canExport === false}
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
              Exporting needs Chrome or Edge on desktop, or Safari 15+ on mobile.
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
