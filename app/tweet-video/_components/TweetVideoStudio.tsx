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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchTweet, type FetchedTweet } from "@/lib/tweet-fetch";
import {
  DEFAULT_PROFILE_ID,
  PAGE_PROFILES,
  getProfile,
} from "@/lib/page-profiles";
import {
  InCardComposition,
  inCardDefaultProps,
  type InCardProps,
} from "@/remotion/tweet/InCardComposition";
import type { Aspect } from "@/remotion/tweet/types";
import { Header } from "../../_components/Header";

const COMP_FPS = 30;
const COMP_DURATION_FRAMES = COMP_FPS * 7;

const ASPECT_DIMS: Record<Aspect, { w: number; h: number }> = {
  "9x16": { w: 1080, h: 1920 },
  "1x1": { w: 1080, h: 1080 },
  "16x9": { w: 1920, h: 1080 },
};

const PLAYER_MAX_W = 380;

function slugify(s: string, max: number): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || "tweet";
}

export const TweetVideoStudio: React.FC = () => {
  const [urlInput, setUrlInput] = useState("");
  const [tweet, setTweet] = useState<FetchedTweet | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [profileId, setProfileId] = useState<string>(DEFAULT_PROFILE_ID);
  const [aspect, setAspect] = useState<Aspect>("9x16");

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  const profile = useMemo(() => getProfile(profileId), [profileId]);

  useEffect(() => {
    let cancelled = false;
    const dims = ASPECT_DIMS[aspect];
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: dims.w,
      height: dims.h,
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
  }, [aspect]);

  const doFetch = useCallback(
    async (force?: "syndication") => {
      if (!urlInput.trim()) return;
      setFetching(true);
      setFetchError("");
      try {
        const t = await fetchTweet(urlInput.trim(), force);
        setTweet(t);
      } catch (e) {
        setFetchError((e as Error).message || "both_sources_failed");
        setTweet(null);
      } finally {
        setFetching(false);
      }
    },
    [urlInput],
  );

  const inputProps = useMemo<InCardProps>(
    () => ({
      aspect,
      tweet: tweet ?? inCardDefaultProps.tweet,
      identity: {
        name: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        verified: profile.verified,
      },
      theme: profile.defaultTheme,
      background: profile.defaultBackground,
      showStats: profile.defaultShowStats,
      showTimestamp: profile.defaultShowTimestamp,
      showVerifiedBadge: profile.defaultShowVerifiedBadge,
      fontScale: 1,
      centerY: 0.5,
      forRender: false,
    }),
    [aspect, tweet, profile],
  );

  const compDims = ASPECT_DIMS[aspect];
  const playerW = Math.min(PLAYER_MAX_W, compDims.w);
  const playerH = (playerW * compDims.h) / compDims.w;

  const handleDownload = useCallback(async () => {
    if (!tweet) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: `TweetInCard${aspect}`,
          component: InCardComposition,
          durationInFrames: COMP_DURATION_FRAMES,
          fps: COMP_FPS,
          width: compDims.w,
          height: compDims.h,
          defaultProps: inCardDefaultProps,
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: {
          ...inputProps,
          forRender: true,
        } as any,
        licenseKey: "free-license",
        videoBitrate: 12_000_000,
        hardwareAcceleration: "prefer-hardware",
        muted: true,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.id}_${slugify(tweet.text, 40)}_${aspect}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setExportError(
        "Couldn't export in this browser. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [tweet, aspect, compDims, inputProps, profile]);

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

      <div
        className="flex shrink-0 items-center gap-3 px-6 py-4"
        style={{ borderBottom: `1px solid ${BRAND.colors.grey200}` }}
      >
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void doFetch();
          }}
          placeholder="Paste a tweet URL (x.com/user/status/…)"
          className="flex-1 rounded-md border px-3 py-2 font-sans text-sm"
          style={{
            borderColor: BRAND.colors.grey200,
            backgroundColor: "#FFFFFF",
            color: BRAND.colors.ink,
          }}
        />
        <Button onClick={() => doFetch()} disabled={fetching || !urlInput}>
          {fetching ? "Fetching…" : "Fetch"}
        </Button>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="w-40 font-sans">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_PROFILES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={aspect}
          onValueChange={(v) => setAspect(v as Aspect)}
        >
          <SelectTrigger className="w-24 font-sans">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="9x16">9:16</SelectItem>
            <SelectItem value="1x1">1:1</SelectItem>
            <SelectItem value="16x9">16:9</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {fetchError ? (
        <div
          className="flex items-center gap-3 px-6 py-2 text-sm"
          style={{ color: BRAND.colors.ink, backgroundColor: "#FFECEC" }}
        >
          <span>
            {fetchError === "invalid_url"
              ? "That doesn't look like a tweet URL."
              : fetchError === "not_found" || fetchError === "protected"
                ? "Tweet not found or protected."
                : "Both sources failed."}
          </span>
          <button
            onClick={() => doFetch("syndication")}
            className="underline"
            type="button"
          >
            Try syndication fallback
          </button>
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0">
        <aside
          className="flex flex-col gap-6 p-6"
          style={{
            width: 320,
            backgroundColor: BRAND.colors.paper,
            borderRight: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          <p className="text-xs" style={{ color: BRAND.colors.grey500 }}>
            Controls appear here as the tweet loads.
          </p>
        </aside>

        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {tweet ? (
            <Player
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              component={InCardComposition as any}
              durationInFrames={COMP_DURATION_FRAMES}
              fps={COMP_FPS}
              compositionWidth={compDims.w}
              compositionHeight={compDims.h}
              controls
              loop
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputProps={inputProps as any}
              style={{ width: playerW, height: playerH }}
            />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                width: playerW,
                height: playerH,
                backgroundColor: "#000",
              }}
            >
              <p
                className="font-sans text-sm"
                style={{ color: BRAND.colors.grey500 }}
              >
                Paste a tweet URL to start
              </p>
            </div>
          )}
        </main>

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
            disabled={!tweet || isRendering || canExport === false}
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
              Exporting needs Chrome or Edge on desktop.
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
