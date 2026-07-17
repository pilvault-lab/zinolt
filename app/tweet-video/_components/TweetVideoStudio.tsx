"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  deleteLocalVideo,
  prepareLocalVideoSW,
  pingLocalVideoSW,
  storeLocalVideo,
} from "@/lib/local-video";
import {
  InCardComposition,
  inCardDefaultProps,
  type InCardProps,
} from "@/remotion/tweet/InCardComposition";
import {
  StackedComposition,
  stackedDefaultProps,
  type StackedProps,
} from "@/remotion/tweet/StackedComposition";
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
  const [preparedTweet, setPreparedTweet] = useState<FetchedTweet | null>(null);
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [profileId, setProfileId] = useState<string>(DEFAULT_PROFILE_ID);
  const [aspect, setAspect] = useState<Aspect>("9x16");
  const [layout, setLayout] = useState<"incard" | "stacked">("incard");
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [muted, setMuted] = useState(false);

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  const profile = useMemo(() => getProfile(profileId), [profileId]);
  const preparedSwUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    prepareLocalVideoSW();
    const id = setInterval(pingLocalVideoSW, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!tweet) {
      setPreparedTweet(null);
      return;
    }
    let cancelled = false;
    const localUrlsCreated: string[] = [];
    setPreparingMedia(true);

    (async () => {
      const newMedia = await Promise.all(
        tweet.media.map(async (m) => {
          if (m.type === "photo") return m;
          try {
            const res = await fetch(m.url);
            if (!res.ok) throw new Error(`fetch ${res.status}`);
            const blob = await res.blob();
            const file = new File([blob], `${tweet.id}.mp4`, {
              type: blob.type || "video/mp4",
            });
            const swUrl = await storeLocalVideo(file);
            localUrlsCreated.push(swUrl);
            return { ...m, url: swUrl };
          } catch (e) {
            console.warn("Media prep failed", e);
            return m;
          }
        }),
      );
      if (cancelled) {
        for (const u of localUrlsCreated) void deleteLocalVideo(u);
        return;
      }
      for (const u of preparedSwUrlsRef.current) void deleteLocalVideo(u);
      preparedSwUrlsRef.current = localUrlsCreated;
      setPreparedTweet({ ...tweet, media: newMedia });
      setPreparingMedia(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tweet]);

  useEffect(() => {
    return () => {
      for (const u of preparedSwUrlsRef.current) void deleteLocalVideo(u);
    };
  }, []);

  useEffect(() => {
    if (!preparedTweet || layoutDirty) return;
    const hasVideo = preparedTweet.media.some(
      (m) => m.type === "video" || m.type === "gif",
    );
    setLayout(hasVideo ? "stacked" : "incard");
  }, [preparedTweet, layoutDirty]);

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

  const durationFrames = useMemo(() => {
    if (!preparedTweet) return COMP_DURATION_FRAMES;
    const vid = preparedTweet.media.find(
      (m) => m.type === "video" || m.type === "gif",
    );
    if (layout === "stacked" && vid?.durationMs) {
      return Math.max(30, Math.ceil((vid.durationMs / 1000) * COMP_FPS));
    }
    if (layout === "incard" && vid?.durationMs) {
      return Math.max(
        30,
        Math.ceil(((vid.durationMs + 1000) / 1000) * COMP_FPS),
      );
    }
    return COMP_DURATION_FRAMES;
  }, [preparedTweet, layout]);

  const inCardInputProps = useMemo<InCardProps>(
    () => ({
      aspect,
      tweet: preparedTweet ?? inCardDefaultProps.tweet,
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
    [aspect, preparedTweet, profile],
  );

  const stackedInputProps = useMemo<StackedProps>(
    () => ({
      aspect,
      tweet: preparedTweet ?? stackedDefaultProps.tweet,
      identity: {
        name: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        verified: profile.verified,
      },
      theme: profile.defaultTheme,
      background: profile.defaultBackground,
      showStats: profile.defaultShowStats,
      showTimestamp: false,
      showVerifiedBadge: profile.defaultShowVerifiedBadge,
      fontScale: 1,
      muted,
      forRender: false,
    }),
    [aspect, preparedTweet, profile, muted],
  );

  const currentComponent =
    layout === "stacked" ? StackedComposition : InCardComposition;
  const currentProps =
    layout === "stacked" ? stackedInputProps : inCardInputProps;
  const currentDefaultProps =
    layout === "stacked" ? stackedDefaultProps : inCardDefaultProps;
  const currentCompId =
    layout === "stacked"
      ? `TweetStacked${aspect}`
      : `TweetInCard${aspect}`;

  const compDims = ASPECT_DIMS[aspect];
  const playerW = Math.min(PLAYER_MAX_W, compDims.w);
  const playerH = (playerW * compDims.h) / compDims.w;

  const handleDownload = useCallback(async () => {
    if (!preparedTweet) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: currentCompId,
          component: currentComponent,
          durationInFrames: durationFrames,
          fps: COMP_FPS,
          width: compDims.w,
          height: compDims.h,
          defaultProps: currentDefaultProps,
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: {
          ...currentProps,
          forRender: true,
        } as any,
        licenseKey: "free-license",
        videoBitrate: layout === "stacked" ? 16_000_000 : 12_000_000,
        hardwareAcceleration: "prefer-hardware",
        ...(layout === "stacked" && !muted
          ? { audioBitrate: "high" as const }
          : { muted: true }),
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.id}_${slugify(preparedTweet.text, 40)}_${aspect}.mp4`;
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
  }, [
    preparedTweet,
    aspect,
    compDims,
    currentProps,
    profile,
    currentComponent,
    currentDefaultProps,
    currentCompId,
    durationFrames,
    layout,
    muted,
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
          className="flex flex-col gap-6 overflow-y-auto p-6"
          style={{
            width: 320,
            backgroundColor: BRAND.colors.paper,
            borderRight: `1px solid ${BRAND.colors.grey200}`,
          }}
        >
          {preparedTweet ? (
            <>
              <div className="flex flex-col gap-2">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Layout
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={layout === "incard" ? "default" : "outline"}
                    onClick={() => {
                      setLayout("incard");
                      setLayoutDirty(true);
                    }}
                    className="flex-1"
                  >
                    In-Card
                  </Button>
                  <Button
                    variant={layout === "stacked" ? "default" : "outline"}
                    onClick={() => {
                      setLayout("stacked");
                      setLayoutDirty(true);
                    }}
                    className="flex-1"
                  >
                    Stacked
                  </Button>
                </div>
              </div>

              {preparedTweet.media.some((m) => m.type === "video") ? (
                <label
                  className="flex items-center gap-2 font-sans text-sm"
                  style={{ color: BRAND.colors.ink }}
                >
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => setMuted(e.target.checked)}
                  />
                  Mute video audio
                </label>
              ) : null}
            </>
          ) : (
            <p className="text-xs" style={{ color: BRAND.colors.grey500 }}>
              Controls appear here as the tweet loads.
            </p>
          )}
        </aside>

        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {preparedTweet ? (
            <Player
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              component={currentComponent as any}
              durationInFrames={durationFrames}
              fps={COMP_FPS}
              compositionWidth={compDims.w}
              compositionHeight={compDims.h}
              controls
              loop
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              inputProps={currentProps as any}
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
                {preparingMedia
                  ? "Preparing media…"
                  : tweet
                    ? "Preparing media…"
                    : "Paste a tweet URL to start"}
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
            disabled={!preparedTweet || isRendering || canExport === false}
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
