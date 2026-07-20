"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import type {
  Aspect,
  BackgroundConfig,
  CardTheme,
} from "@/remotion/tweet/types";
import { Header } from "../../_components/Header";

const LOOP_LIBRARY: Array<{ id: string; label: string; src: string }> = [
  { id: "light-ray-white", label: "Light Ray", src: "/rays/light-ray-white.mp4" },
  {
    id: "ferrofluid-white",
    label: "Ferrofluid",
    src: "/rays/ferrofluid-white.mp4",
  },
  {
    id: "light-pillar",
    label: "Light Pillar",
    src: "/rays/light-pillar-white-v3.mp4",
  },
];

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
  const [blurredBg, setBlurredBg] = useState(true);
  const [bg, setBg] = useState<BackgroundConfig>(
    getProfile(DEFAULT_PROFILE_ID).defaultBackground,
  );
  const [bgDirty, setBgDirty] = useState(false);
  const bgUploadUrlRef = useRef<string | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [cardScale, setCardScale] = useState(1);
  const [verticalOffsetPct, setVerticalOffsetPct] = useState(50);
  const [durationSec, setDurationSec] = useState(7);

  const initialProfile = getProfile(DEFAULT_PROFILE_ID);
  const [theme, setTheme] = useState<CardTheme>(initialProfile.defaultTheme);
  const [themeDirty, setThemeDirty] = useState(false);
  const [showStats, setShowStats] = useState(
    initialProfile.defaultShowStats,
  );
  const [showStatsDirty, setShowStatsDirty] = useState(false);
  const [showTimestamp, setShowTimestamp] = useState(
    initialProfile.defaultShowTimestamp,
  );
  const [showTimestampDirty, setShowTimestampDirty] = useState(false);
  const [showVerifiedBadge, setShowVerifiedBadge] = useState(
    initialProfile.defaultShowVerifiedBadge,
  );
  const [showVerifiedBadgeDirty, setShowVerifiedBadgeDirty] = useState(false);

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState("");

  // Sourcing dashboard handoff. When /sourcing approves a row it redirects
  // here with ?url=&profile=&queue_id= — auto-fetch, pre-select the profile,
  // and hold the queue_id so we can mark it 'rendered' after export succeeds.
  const searchParams = useSearchParams();
  const [queueId, setQueueId] = useState<string | null>(null);

  const profile = useMemo(() => getProfile(profileId), [profileId]);
  const preparedSwUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    prepareLocalVideoSW();
    const id = setInterval(pingLocalVideoSW, 15_000);
    return () => clearInterval(id);
  }, []);

  // Apply /sourcing handoff params once on mount.
  useEffect(() => {
    if (!searchParams) return;
    const urlParam = searchParams.get("url");
    const profileParam = searchParams.get("profile");
    const queueIdParam = searchParams.get("queue_id");

    if (profileParam && PAGE_PROFILES.some((p) => p.id === profileParam)) {
      setProfileId(profileParam);
    }
    if (queueIdParam) setQueueId(queueIdParam);
    if (urlParam) {
      setUrlInput(urlParam);
      (async () => {
        setFetching(true);
        setFetchError("");
        try {
          const t = await fetchTweet(urlParam);
          setTweet(t);
        } catch (e) {
          setFetchError((e as Error).message || "both_sources_failed");
          setTweet(null);
        } finally {
          setFetching(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!bgDirty) setBg(profile.defaultBackground);
    if (!themeDirty) setTheme(profile.defaultTheme);
    if (!showStatsDirty) setShowStats(profile.defaultShowStats);
    if (!showTimestampDirty) setShowTimestamp(profile.defaultShowTimestamp);
    if (!showVerifiedBadgeDirty)
      setShowVerifiedBadge(profile.defaultShowVerifiedBadge);
  }, [
    profile,
    bgDirty,
    themeDirty,
    showStatsDirty,
    showTimestampDirty,
    showVerifiedBadgeDirty,
  ]);

  const onBgKindChange = useCallback(
    (kind: BackgroundConfig["kind"]) => {
      setBgDirty(true);
      if (kind === "solid") setBg({ kind: "solid", color: "#0f172a" });
      else if (kind === "gradient")
        setBg({
          kind: "gradient",
          angle: 135,
          from: "#0f172a",
          to: "#1e293b",
        });
      else if (kind === "loop")
        setBg({ kind: "loop", src: LOOP_LIBRARY[0].src });
      else setBg({ kind: "upload", src: "" });
    },
    [],
  );

  const onBgUpload = useCallback(async (file: File) => {
    if (bgUploadUrlRef.current) {
      if (bgUploadUrlRef.current.startsWith("/__local-video/")) {
        await deleteLocalVideo(bgUploadUrlRef.current);
      } else {
        URL.revokeObjectURL(bgUploadUrlRef.current);
      }
    }
    let src: string;
    if (file.type.startsWith("video/")) {
      src = await storeLocalVideo(file);
    } else {
      src = URL.createObjectURL(file);
    }
    bgUploadUrlRef.current = src;
    setBg({ kind: "upload", src });
    setBgDirty(true);
  }, []);

  useEffect(() => {
    return () => {
      if (bgUploadUrlRef.current?.startsWith("/__local-video/")) {
        void deleteLocalVideo(bgUploadUrlRef.current);
      } else if (bgUploadUrlRef.current) {
        URL.revokeObjectURL(bgUploadUrlRef.current);
      }
    };
  }, []);

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
    return Math.round(durationSec * COMP_FPS);
  }, [preparedTweet, layout, durationSec]);

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
      theme,
      background: bg,
      showStats,
      showTimestamp,
      showVerifiedBadge,
      fontScale,
      cardScale,
      centerY: verticalOffsetPct / 100,
      forRender: false,
    }),
    [
      aspect,
      preparedTweet,
      profile,
      bg,
      fontScale,
      cardScale,
      verticalOffsetPct,
      theme,
      showStats,
      showTimestamp,
      showVerifiedBadge,
    ],
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
      theme,
      background: bg,
      showStats,
      showTimestamp: false,
      showVerifiedBadge,
      fontScale,
      cardScale,
      verticalOffsetPct,
      muted,
      forRender: false,
      blurredBg,
    }),
    [
      aspect,
      preparedTweet,
      profile,
      muted,
      blurredBg,
      bg,
      fontScale,
      cardScale,
      verticalOffsetPct,
      theme,
      showStats,
      showVerifiedBadge,
    ],
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

  const [playerDims, setPlayerDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      const maxW = window.innerWidth < 768 ? window.innerWidth - 32 : PLAYER_MAX_W;
      const w = Math.min(maxW, compDims.w);
      setPlayerDims({ w, h: Math.round((w * compDims.h) / compDims.w) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [compDims]);

  const playerW = playerDims.w || Math.min(PLAYER_MAX_W, compDims.w);
  const playerH = playerDims.h || Math.round((playerW * compDims.h) / compDims.w);

  const handleDownload = useCallback(async () => {
    if (!preparedTweet) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      // Force Remotion's dimension resolver to take the calculated-metadata
      // branch, which has explicit priority over the composition object's
      // width/height. This closes off any path where the composition size
      // could be inferred from source video dimensions or fall back to a
      // 16:9 default. Preview <Player> and export MUST share dimensions.
      const outW = compDims.w;
      const outH = compDims.h;
      console.info(
        `[tweet-video export] aspect=${aspect} layout=${layout} dims=${outW}x${outH} comp=${currentCompId}`,
      );
      const { getBlob } = await renderMediaOnWeb({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        composition: {
          id: currentCompId,
          component: currentComponent,
          durationInFrames: durationFrames,
          fps: COMP_FPS,
          width: outW,
          height: outH,
          defaultProps: currentDefaultProps,
          calculateMetadata: () => ({
            width: outW,
            height: outH,
            durationInFrames: durationFrames,
            fps: COMP_FPS,
          }),
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

      // Sourcing handoff: mark the queue row 'rendered'. Failure here does
      // not affect the user — the MP4 already downloaded.
      if (queueId) {
        fetch("/api/tweet-queue/mark-rendered", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queue_id: queueId }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object") ? msg : "Export failed. Try Chrome or Edge on desktop.",
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
        className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 md:px-6 md:py-4"
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
          className="min-w-0 flex-1 rounded-md border px-3 py-2 font-sans text-sm"
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
          <SelectTrigger className="flex-1 font-sans md:w-40 md:flex-none">
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

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <aside
          className="flex flex-col gap-6 overflow-y-auto p-6 border-b md:border-b-0 md:border-r md:w-[320px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
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
                <div className="flex flex-col gap-2">
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
                  {layout === "stacked" ? (
                    <label
                      className="flex items-center gap-2 font-sans text-sm"
                      style={{ color: BRAND.colors.ink }}
                    >
                      <input
                        type="checkbox"
                        checked={blurredBg}
                        onChange={(e) => setBlurredBg(e.target.checked)}
                      />
                      Blurred video background
                    </label>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Theme
                </label>
                <div className="flex gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    onClick={() => {
                      setTheme("light");
                      setThemeDirty(true);
                    }}
                    className="flex-1"
                  >
                    Light
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    onClick={() => {
                      setTheme("dark");
                      setThemeDirty(true);
                    }}
                    className="flex-1"
                  >
                    Dark
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Card rows
                </label>
                <label
                  className="flex items-center gap-2 font-sans text-sm"
                  style={{ color: BRAND.colors.ink }}
                >
                  <input
                    type="checkbox"
                    checked={showStats}
                    onChange={(e) => {
                      setShowStats(e.target.checked);
                      setShowStatsDirty(true);
                    }}
                  />
                  Show stats
                </label>
                <label
                  className="flex items-center gap-2 font-sans text-sm"
                  style={{ color: BRAND.colors.ink }}
                >
                  <input
                    type="checkbox"
                    checked={showTimestamp}
                    onChange={(e) => {
                      setShowTimestamp(e.target.checked);
                      setShowTimestampDirty(true);
                    }}
                  />
                  Show timestamp
                </label>
                <label
                  className="flex items-center gap-2 font-sans text-sm"
                  style={{ color: BRAND.colors.ink }}
                >
                  <input
                    type="checkbox"
                    checked={showVerifiedBadge}
                    onChange={(e) => {
                      setShowVerifiedBadge(e.target.checked);
                      setShowVerifiedBadgeDirty(true);
                    }}
                  />
                  Show verified badge
                </label>
              </div>

              <div className="flex flex-col gap-3">
                <label
                  className="font-sans text-xs uppercase tracking-wide"
                  style={{ color: BRAND.colors.grey500 }}
                >
                  Background
                </label>
                <Select
                  value={bg.kind}
                  onValueChange={(v) =>
                    onBgKindChange(v as BackgroundConfig["kind"])
                  }
                >
                  <SelectTrigger className="w-full font-sans">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solid">Solid</SelectItem>
                    <SelectItem value="gradient">Gradient</SelectItem>
                    <SelectItem value="loop">Loop</SelectItem>
                    <SelectItem value="upload">Upload</SelectItem>
                  </SelectContent>
                </Select>

                {bg.kind === "solid" ? (
                  <input
                    type="color"
                    value={bg.color}
                    onChange={(e) => {
                      setBg({ kind: "solid", color: e.target.value });
                      setBgDirty(true);
                    }}
                  />
                ) : null}

                {bg.kind === "gradient" ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="range"
                      min={0}
                      max={360}
                      step={1}
                      value={bg.angle}
                      onChange={(e) => {
                        setBg({ ...bg, angle: Number(e.target.value) });
                        setBgDirty(true);
                      }}
                    />
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={bg.from}
                        onChange={(e) => {
                          setBg({ ...bg, from: e.target.value });
                          setBgDirty(true);
                        }}
                      />
                      <input
                        type="color"
                        value={bg.to}
                        onChange={(e) => {
                          setBg({ ...bg, to: e.target.value });
                          setBgDirty(true);
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                {bg.kind === "loop" ? (
                  <Select
                    value={bg.src}
                    onValueChange={(v) => {
                      setBg({ kind: "loop", src: v });
                      setBgDirty(true);
                    }}
                  >
                    <SelectTrigger className="w-full font-sans">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOOP_LIBRARY.map((l) => (
                        <SelectItem key={l.id} value={l.src}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {bg.kind === "upload" ? (
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onBgUpload(f);
                      e.target.value = "";
                    }}
                    className="font-sans text-xs"
                  />
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <label
                    className="font-sans text-xs uppercase tracking-wide"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    Card size
                  </label>
                  <span
                    className="font-sans text-[11px] tabular-nums"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    {Math.round(cardScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.4}
                  step={0.05}
                  value={cardScale}
                  onChange={(e) => setCardScale(Number(e.target.value))}
                  style={{ accentColor: BRAND.colors.ink }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <label
                    className="font-sans text-xs uppercase tracking-wide"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    Font scale
                  </label>
                  <span
                    className="font-sans text-[11px] tabular-nums"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    {Math.round(fontScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                  style={{ accentColor: BRAND.colors.ink }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <label
                    className="font-sans text-xs uppercase tracking-wide"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    Vertical position
                  </label>
                  <span
                    className="font-sans text-[11px] tabular-nums"
                    style={{ color: BRAND.colors.grey500 }}
                  >
                    {verticalOffsetPct}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={verticalOffsetPct}
                  onChange={(e) =>
                    setVerticalOffsetPct(Number(e.target.value))
                  }
                  style={{ accentColor: BRAND.colors.ink }}
                />
              </div>

              {layout === "incard" &&
              !preparedTweet.media.some(
                (m) => m.type === "video" || m.type === "gif",
              ) ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <label
                      className="font-sans text-xs uppercase tracking-wide"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      Duration
                    </label>
                    <span
                      className="font-sans text-[11px] tabular-nums"
                      style={{ color: BRAND.colors.grey500 }}
                    >
                      {durationSec}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={15}
                    step={1}
                    value={durationSec}
                    onChange={(e) => setDurationSec(Number(e.target.value))}
                    style={{ accentColor: BRAND.colors.ink }}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs" style={{ color: BRAND.colors.grey500 }}>
              Controls appear here as the tweet loads.
            </p>
          )}
        </aside>

        <main
          className="flex flex-1 items-center justify-center p-4 md:p-12"
          style={{ backgroundColor: "#5A5A60" }}
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
          className="flex flex-col p-6 border-t md:border-t-0 md:border-l md:w-[260px]"
          style={{
            backgroundColor: BRAND.colors.paper,
            borderColor: BRAND.colors.grey200,
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
