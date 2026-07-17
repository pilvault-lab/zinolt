import { type NextRequest, NextResponse } from "next/server";
import type { FetchedTweet, QuotedTweet, TweetMedia } from "@/lib/tweet-fetch";

const ID_RE = /(?:status\/)?(\d{15,20})/;

function extractId(input: string): string | null {
  const m = input.match(ID_RE);
  return m?.[1] ?? null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function proxyMediaUrl(cdn: string): string {
  return `/api/tweet/media?url=${encodeURIComponent(cdn)}`;
}

function stripTrailingSelfLink(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trimEnd();
}

interface FxTweetLike {
  id: string;
  text: string;
  created_at: string;
  author: {
    name: string;
    screen_name: string;
    avatar_url: string;
  };
  likes: number;
  retweets: number;
  replies: number;
  views?: number;
  media?: {
    all?: Array<{
      type: "photo" | "video" | "gif";
      url: string;
      width: number;
      height: number;
      duration?: number;
      thumbnail_url?: string;
    }>;
  };
}

interface FxTweetJson {
  tweet?: FxTweetLike & { quote?: FxTweetLike };
}

function mapFxMedia(m: FxTweetLike["media"]): TweetMedia[] {
  return (m?.all ?? []).map((x) => ({
    type: x.type,
    url: proxyMediaUrl(x.url),
    width: x.width,
    height: x.height,
    durationMs: x.duration ? Math.round(x.duration * 1000) : undefined,
    thumbnailUrl: x.thumbnail_url ? proxyMediaUrl(x.thumbnail_url) : undefined,
  }));
}

function mapFxQuote(q: FxTweetLike): QuotedTweet {
  return {
    id: q.id,
    text: stripTrailingSelfLink(decodeEntities(q.text)),
    author: {
      name: q.author.name,
      handle: q.author.screen_name,
      avatarUrl: proxyMediaUrl(q.author.avatar_url),
      verified: false,
    },
    createdAt: q.created_at,
    media: mapFxMedia(q.media),
  };
}

async function fetchFx(id: string): Promise<FetchedTweet | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`);
  if (!res.ok) return null;
  const json = (await res.json()) as FxTweetJson;
  const t = json.tweet;
  if (!t) return null;
  const media = mapFxMedia(t.media);
  const text = stripTrailingSelfLink(decodeEntities(t.text));
  return {
    id: t.id,
    text,
    author: {
      name: t.author.name,
      handle: t.author.screen_name,
      avatarUrl: proxyMediaUrl(t.author.avatar_url),
      verified: false,
    },
    createdAt: t.created_at,
    stats: {
      likes: t.likes ?? 0,
      retweets: t.retweets ?? 0,
      replies: t.replies ?? 0,
      views: t.views,
    },
    media,
    quoted: t.quote ? mapFxQuote(t.quote) : undefined,
  };
}

interface SynTweetJson {
  id_str: string;
  text: string;
  created_at: string;
  user: {
    name: string;
    screen_name: string;
    profile_image_url_https: string;
    is_blue_verified?: boolean;
    verified?: boolean;
  };
  favorite_count?: number;
  conversation_count?: number;
  mediaDetails?: Array<{
    type: "photo" | "video" | "animated_gif";
    media_url_https: string;
    original_info?: { width: number; height: number };
    video_info?: {
      duration_millis?: number;
      variants: Array<{
        content_type: string;
        bitrate?: number;
        url: string;
      }>;
    };
  }>;
}

async function fetchSyndication(id: string): Promise<FetchedTweet | null> {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as SynTweetJson;

  const media: TweetMedia[] = [];
  for (const m of json.mediaDetails ?? []) {
    if (m.type === "photo") {
      media.push({
        type: "photo",
        url: proxyMediaUrl(m.media_url_https),
        width: m.original_info?.width ?? 0,
        height: m.original_info?.height ?? 0,
      });
    } else if (m.type === "video" || m.type === "animated_gif") {
      const mp4s = (m.video_info?.variants ?? []).filter(
        (v) => v.content_type === "video/mp4" && v.url,
      );
      mp4s.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const top = mp4s[0];
      if (top) {
        media.push({
          type: m.type === "animated_gif" ? "gif" : "video",
          url: proxyMediaUrl(top.url),
          width: m.original_info?.width ?? 0,
          height: m.original_info?.height ?? 0,
          durationMs: m.video_info?.duration_millis,
          thumbnailUrl: proxyMediaUrl(m.media_url_https),
        });
      }
    }
  }

  const rawText = decodeEntities(json.text.replace(/<[^>]+>/g, ""));

  return {
    id: json.id_str,
    text: stripTrailingSelfLink(rawText),
    author: {
      name: json.user.name,
      handle: json.user.screen_name,
      avatarUrl: proxyMediaUrl(json.user.profile_image_url_https),
      verified: Boolean(json.user.is_blue_verified || json.user.verified),
    },
    createdAt: json.created_at,
    stats: {
      likes: json.favorite_count ?? 0,
      retweets: 0,
      replies: json.conversation_count ?? 0,
    },
    media,
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const force = req.nextUrl.searchParams.get("force");
  if (!url) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  const id = extractId(url);
  if (!id) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  let tweet: FetchedTweet | null = null;

  if (force !== "syndication") {
    try {
      tweet = await fetchFx(id);
    } catch {
      tweet = null;
    }
  }
  if (!tweet) {
    try {
      tweet = await fetchSyndication(id);
    } catch {
      tweet = null;
    }
  }

  if (!tweet) {
    return NextResponse.json({ error: "both_sources_failed" }, { status: 502 });
  }

  return NextResponse.json(tweet, {
    headers: { "cache-control": "public, s-maxage=600" },
  });
}
