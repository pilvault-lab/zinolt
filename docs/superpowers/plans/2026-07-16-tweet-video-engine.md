# Tweet-to-Video Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/tweet-video` — a browser-based tool that fetches any X/Twitter post and renders it as a Zinolt-quality MP4 (9:16 / 1:1 / 16:9), with two layouts (In-Card and Stacked), page-profile identities, and configurable backgrounds.

**Architecture:** Two Next.js route handlers proxy fxtwitter/syndication + the twimg CDN. A client wrapper normalizes tweets. Two Remotion compositions (`InCardComposition`, `StackedComposition`) render at six aspect variants. A three-pane studio (`/tweet-video`) drives preview via `<Player>` and export via `@remotion/web-renderer`. Videos ride the existing local-video service worker (`/__local-video/<id>`) that LetterboxReel already uses.

**Tech Stack:** Next.js 16 (fork — see `AGENTS.md`) · React 19 · Remotion 4.0.478 · `@remotion/web-renderer` · `@remotion/media` · Radix + shadcn primitives · Tailwind 4 · TypeScript · client-side twemoji SVG bundle.

**Reference spec:** `docs/superpowers/specs/2026-07-16-tweet-video-engine-design.md`

**Zinolt caveats to keep in mind while implementing:**
- Next.js in this repo is a fork; the AGENTS.md file warns "This is NOT the Next.js you know". If a route handler API doesn't behave as you expect, check `node_modules/next/dist/docs/`.
- No test framework is installed. Verification is: `next build` for typecheck, `next dev` + browser for behavior, `remotion studio` for composition inspection, and actual MP4 export → open in a player.
- The existing `Studio.tsx` in `app/studio/_components/` is the north-star pattern for three-pane editors, `renderMediaOnWeb` calls, and local-video SW usage. Reference it heavily.

---

## Task 1: Media proxy + tweet fetch types

**Files:**
- Create: `app/api/tweet/media/route.ts`
- Create: `lib/tweet-fetch.ts` (types only for this task)

Goal: `/api/tweet/media?url=<twimg-url>` streams any whitelisted twimg CDN URL back to the client with byte-range support. This unlocks canvas-safe images and video-range fetches later. Also lock in the shared `FetchedTweet` / `TweetMedia` types.

- [ ] **Step 1: Create `lib/tweet-fetch.ts` with types only**

```ts
// lib/tweet-fetch.ts
export interface FetchedTweet {
  id: string;
  text: string;
  author: {
    name: string;
    handle: string;
    avatarUrl: string;
    verified: boolean;
  };
  createdAt: string;
  stats: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  media: TweetMedia[];
}

export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  width: number;
  height: number;
  durationMs?: number;
  thumbnailUrl?: string;
}

export type TweetFetchError =
  | "invalid_url"
  | "not_found"
  | "protected"
  | "both_sources_failed";

// fetchTweet() implementation added in Task 2.
```

- [ ] **Step 2: Create the media proxy route**

```ts
// app/api/tweet/media/route.ts
import { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
]);

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return new Response("missing url", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response("host not allowed", { status: 400 });
  }

  const forwardHeaders: HeadersInit = {};
  const range = req.headers.get("range");
  if (range) forwardHeaders["Range"] = range;

  const upstream = await fetch(parsed.toString(), {
    headers: forwardHeaders,
    // Twimg refuses requests without a normal UA occasionally.
    // @ts-expect-error Next fetch permits this on the server.
    next: { revalidate: 86400 },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const passthrough = new Headers();
  const copy = (h: string) => {
    const v = upstream.headers.get(h);
    if (v) passthrough.set(h, v);
  };
  copy("content-type");
  copy("content-length");
  copy("accept-ranges");
  copy("content-range");
  passthrough.set("cache-control", "public, s-maxage=86400");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: passthrough,
  });
}
```

- [ ] **Step 3: Manual verify the proxy**

Run `npm run dev` in one terminal. In another:

```bash
curl -I "http://localhost:3000/api/tweet/media?url=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2FGH0hZaEXsAA_p1M.jpg"
```

Expected: `200 OK`, `content-type: image/jpeg`, `accept-ranges: bytes`.

Range-check with a video:

```bash
curl -I -H "Range: bytes=0-1023" "http://localhost:3000/api/tweet/media?url=https%3A%2F%2Fvideo.twimg.com%2Fext_tw_video%2F1234567890%2Fpu%2Fvid%2F720x1280%2Ftest.mp4"
```

Expected: `206 Partial Content`, `content-range: bytes 0-1023/*`.

Rejection check:

```bash
curl -I "http://localhost:3000/api/tweet/media?url=https%3A%2F%2Fexample.com%2Fx.jpg"
```

Expected: `400 host not allowed`.

- [ ] **Step 4: Commit**

```bash
git add app/api/tweet/media/route.ts lib/tweet-fetch.ts
git commit -m "Add twimg CDN media proxy and tweet fetch types"
```

---

## Task 2: Tweet JSON route + client fetcher

**Files:**
- Create: `app/api/tweet/route.ts`
- Modify: `lib/tweet-fetch.ts` (add `fetchTweet()` wrapper + rewrite helper)

Goal: `/api/tweet?url=...` returns a normalized `FetchedTweet`. Handles fxtwitter as primary, syndication as fallback, and rewrites all media URLs to hit the proxy from Task 1.

- [ ] **Step 1: Create the tweet route**

```ts
// app/api/tweet/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { FetchedTweet, TweetMedia } from "@/lib/tweet-fetch";

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
  // Real X client hides the trailing t.co that points at the tweet's own media.
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trimEnd();
}

async function fetchFx(id: string): Promise<FetchedTweet | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    tweet?: {
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
    };
  };
  const t = json.tweet;
  if (!t) return null;
  const media: TweetMedia[] = (t.media?.all ?? []).map((m) => ({
    type: m.type,
    url: proxyMediaUrl(m.url),
    width: m.width,
    height: m.height,
    durationMs: m.duration ? Math.round(m.duration * 1000) : undefined,
    thumbnailUrl: m.thumbnail_url ? proxyMediaUrl(m.thumbnail_url) : undefined,
  }));
  const text = stripTrailingSelfLink(decodeEntities(t.text));
  return {
    id: t.id,
    text,
    author: {
      name: t.author.name,
      handle: t.author.screen_name,
      avatarUrl: proxyMediaUrl(t.author.avatar_url),
      verified: false, // fxtwitter doesn't expose it reliably; identity comes from PageProfile anyway
    },
    createdAt: t.created_at,
    stats: {
      likes: t.likes ?? 0,
      retweets: t.retweets ?? 0,
      replies: t.replies ?? 0,
      views: t.views,
    },
    media,
  };
}

async function fetchSyndication(id: string): Promise<FetchedTweet | null> {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
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
    photos?: Array<{ url: string; width: number; height: number }>;
    video?: {
      variants: Array<{ src: string; type: string; bitrate?: number }>;
      duration_millis?: number;
      poster?: string;
    };
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
  };

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

  const rawText = decodeEntities(
    json.text.replace(/<[^>]+>/g, ""), // syndication returns HTML anchors
  );

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
    return NextResponse.json(
      { error: "both_sources_failed" },
      { status: 502 },
    );
  }

  return NextResponse.json(tweet, {
    headers: { "cache-control": "public, s-maxage=600" },
  });
}
```

- [ ] **Step 2: Add `fetchTweet()` wrapper in `lib/tweet-fetch.ts`**

Append to `lib/tweet-fetch.ts`:

```ts
export async function fetchTweet(
  input: string,
  force?: "syndication",
): Promise<FetchedTweet> {
  const params = new URLSearchParams({ url: input });
  if (force) params.set("force", force);
  const res = await fetch(`/api/tweet?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: TweetFetchError;
    };
    throw new Error(body.error ?? "both_sources_failed");
  }
  return (await res.json()) as FetchedTweet;
}
```

- [ ] **Step 3: Manual verify with three real tweets**

```bash
# text-only
curl "http://localhost:3000/api/tweet?url=https://x.com/naval/status/1002103360646823936" | jq '.text, .media | length'

# photo tweet
curl "http://localhost:3000/api/tweet?url=https://x.com/nasa/status/1859612345678901234" | jq '.media[0].type, .media[0].url'

# video tweet
curl "http://localhost:3000/api/tweet?url=https://x.com/anywhere/status/1234567890" | jq '.media[0].type, .media[0].durationMs'
```

Expected: JSON returns with `.text` preserved (including `\n`), `.media[].url` all starting with `/api/tweet/media?url=`, and video items include `durationMs`.

Fallback check — force syndication:

```bash
curl "http://localhost:3000/api/tweet?url=https://x.com/naval/status/1002103360646823936&force=syndication" | jq '.text'
```

- [ ] **Step 4: Commit**

```bash
git add app/api/tweet/route.ts lib/tweet-fetch.ts
git commit -m "Add tweet fetch route with fxtwitter primary and syndication fallback"
```

---

## Task 3: Twemoji asset bundle + text splitter

**Files:**
- Create: `public/twemoji/README.md` (short note on source)
- Create: `scripts/fetch-twemoji.mjs`
- Create: `lib/twemoji.ts`

Goal: get Twemoji SVGs into `public/twemoji/` and a util that splits any string into `{ type, value }` segments. Bundle the full set (~3600 SVGs, ~10MB) rather than fetching on demand — Next.js will only serve what's actually referenced, so it's fine.

- [ ] **Step 1: Write the fetch script**

```js
// scripts/fetch-twemoji.mjs
// Grab the current Twemoji SVG assets from jsDelivr. Run once.
// Usage: node scripts/fetch-twemoji.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";

const VERSION = "14.0.2";
const BASE = `https://cdn.jsdelivr.net/gh/twitter/twemoji@${VERSION}/assets/svg`;
const OUT = new URL("../public/twemoji/", import.meta.url);

async function main() {
  await mkdir(OUT, { recursive: true });
  const listRes = await fetch(
    `https://api.github.com/repos/twitter/twemoji/contents/assets/svg?ref=v${VERSION}`,
    { headers: { "User-Agent": "zinolt-twemoji-fetch" } },
  );
  if (!listRes.ok) {
    throw new Error(`Failed listing: ${listRes.status}`);
  }
  const files = (await listRes.json()) as Array<{ name: string }>;
  console.log(`Fetching ${files.length} SVGs into ${OUT.pathname}...`);
  let done = 0;
  for (const f of files) {
    const out = new URL(f.name, OUT);
    if (existsSync(out)) {
      done++;
      continue;
    }
    const res = await fetch(`${BASE}/${f.name}`);
    if (!res.ok) {
      console.warn(`skip ${f.name}: ${res.status}`);
      continue;
    }
    await pipeline(
      Readable.fromWeb(res.body),
      createWriteStream(out),
    );
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${files.length}`);
  }
  console.log(`Done: ${done} files.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script**

```bash
node scripts/fetch-twemoji.mjs
```

Expected: prints progress up to ~3600 files. `public/twemoji/1f600.svg` and friends exist.

- [ ] **Step 3: Write `lib/twemoji.ts`**

```ts
// lib/twemoji.ts
export type Segment =
  | { type: "text"; value: string }
  | { type: "emoji"; codepoint: string };

// Match one emoji-cluster including ZWJ sequences, VS16, and skin-tone modifiers.
// Twemoji filenames drop VS16 (fe0f) unless required to disambiguate — we use
// the same rule as twitter.github.io/twemoji: strip fe0f only from single-cluster
// codepoints where the file exists without it. We keep the fe0f in ZWJ chains.
const EMOJI_RE =
  /(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*[️\u{1F3FB}-\u{1F3FF}]*)/gu;

function codepointFilename(cluster: string): string {
  const cps = Array.from(cluster).map((ch) =>
    ch.codePointAt(0)!.toString(16).padStart(4, "0"),
  );
  // Strip fe0f from single-codepoint clusters to match twemoji's filenames.
  if (cps.length === 2 && cps[1] === "fe0f") {
    return cps[0];
  }
  return cps.join("-");
}

export function splitTwemoji(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      segments.push({ type: "text", value: text.slice(last, idx) });
    }
    segments.push({
      type: "emoji",
      codepoint: codepointFilename(match[0]),
    });
    last = idx + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }
  return segments;
}
```

- [ ] **Step 4: Quick sanity console-test**

Add temporarily to `lib/twemoji.ts` at bottom (delete after):

```ts
// TEMP smoke test
if (process.env.NODE_ENV !== "production" && typeof window === "undefined") {
  console.log(splitTwemoji("hi 👋 world 👨‍👩‍👧"));
}
```

Run `npm run dev` and check the terminal — you should see three segments (text, emoji `1f44b`, text, emoji `1f468-200d-1f469-200d-1f467`, ...). Then delete the smoke test.

- [ ] **Step 5: Commit**

```bash
git add public/twemoji/ scripts/fetch-twemoji.mjs lib/twemoji.ts public/twemoji/README.md
git commit -m "Bundle twemoji SVGs and add text-to-segment splitter"
```

Note: the twemoji commit is ~10MB of SVGs. If that's uncomfortable for the repo, cherry-pick only the top ~500 most common codepoints; the util already returns the codepoint so the `<Img>` fallback (empty box) is graceful.

---

## Task 4: TweetText component + tweet types shared

**Files:**
- Create: `remotion/tweet/types.ts`
- Create: `remotion/tweet/TweetText.tsx`

Goal: a Remotion-safe component that turns a raw string into an inline sequence of text and `<Img>` emoji, preserving `\n`.

- [ ] **Step 1: Create shared types file**

```ts
// remotion/tweet/types.ts
import type { FetchedTweet } from "@/lib/tweet-fetch";

export type CardTheme = "light" | "dark";

export type BackgroundConfig =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; angle: number; from: string; to: string }
  | { kind: "loop"; src: string }
  | { kind: "upload"; src: string };

export interface CardIdentity {
  name: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
}

export interface TweetCardProps {
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  inCardMedia: boolean;
  maxWidthPx: number;
  cornerRadius: number;
  fontScale?: number;
}

export type Aspect = "9x16" | "1x1" | "16x9";
```

- [ ] **Step 2: Create `TweetText.tsx`**

```tsx
// remotion/tweet/TweetText.tsx
import React from "react";
import { Img, staticFile } from "remotion";
import { splitTwemoji } from "@/lib/twemoji";

export const TweetText: React.FC<{
  text: string;
  fontSize: number;
  color: string;
}> = ({ text, fontSize, color }) => {
  const lines = text.split("\n");
  return (
    <div
      style={{
        fontSize,
        color,
        lineHeight: 1.35,
        letterSpacing: -0.2,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.map((line, li) => (
        <React.Fragment key={li}>
          {splitTwemoji(line).map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <Img
                key={i}
                src={staticFile(`twemoji/${seg.codepoint}.svg`)}
                style={{
                  height: "1em",
                  width: "1em",
                  verticalAlign: "-0.15em",
                  display: "inline-block",
                  margin: "0 0.05em",
                }}
              />
            ),
          )}
          {li < lines.length - 1 ? <br /> : null}
        </React.Fragment>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add remotion/tweet/types.ts remotion/tweet/TweetText.tsx
git commit -m "Add tweet types and TweetText component with inline twemoji"
```

---

## Task 5: TweetCard component

**Files:**
- Create: `remotion/tweet/TweetCard.tsx`

Goal: the card frame itself. Header row + text + optional media placeholder + optional timestamp + optional stats + auto-sizing text + overflow scaling.

- [ ] **Step 1: Create the file**

```tsx
// remotion/tweet/TweetCard.tsx
import React, { useEffect, useRef, useState } from "react";
import { Img, continueRender, delayRender } from "remotion";
import { TweetText } from "./TweetText";
import type { TweetCardProps } from "./types";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function bucketFontSize(chars: number): number {
  if (chars <= 60) return 64;
  if (chars <= 120) return 52;
  if (chars <= 200) return 40;
  if (chars <= 280) return 32;
  return 28;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const ds = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${t} · ${ds}`;
}

function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const VerifiedBadge: React.FC<{ size: number }> = ({ size }) => (
  <svg
    viewBox="0 0 22 22"
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      display: "inline-block",
      verticalAlign: "-0.15em",
      marginLeft: 4,
    }}
    aria-hidden
  >
    <path
      fill="#1D9BF0"
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
    />
  </svg>
);

const StatIcon: React.FC<{ kind: "reply" | "retweet" | "like" }> = ({
  kind,
}) => {
  const paths: Record<string, string> = {
    reply:
      "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
    retweet:
      "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
    like: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  };
  return (
    <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }} aria-hidden>
      <path fill="currentColor" d={paths[kind]} />
    </svg>
  );
};

export const TweetCard: React.FC<TweetCardProps> = ({
  tweet,
  identity,
  theme,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  inCardMedia,
  maxWidthPx,
  cornerRadius,
  fontScale = 1,
}) => {
  const bg = theme === "dark" ? "#15202B" : "#FFFFFF";
  const ink = theme === "dark" ? "#E7E9EA" : "#0F1419";
  const muted = theme === "dark" ? "#71767B" : "#536471";

  const baseSize = bucketFontSize(tweet.text.length);
  const textSize = Math.round(baseSize * fontScale);

  // Overflow scaling — measure and rescale if the card ends up > 70% comp height.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [handle] = useState(() => delayRender("TweetCard measure"));

  useEffect(() => {
    // Defer to next frame so children (twemoji <Img>) have a chance to load.
    const raf = requestAnimationFrame(() => {
      const el = cardRef.current;
      const parent = el?.parentElement;
      if (!el || !parent) {
        continueRender(handle);
        return;
      }
      const parentH = parent.getBoundingClientRect().height;
      const cardH = el.getBoundingClientRect().height;
      const limit = parentH * 0.7;
      if (cardH > limit && limit > 0) {
        setScale(Math.max(0.6, limit / cardH));
      }
      continueRender(handle);
    });
    return () => cancelAnimationFrame(raf);
  }, [handle, tweet.text, tweet.media.length]);

  return (
    <div
      ref={cardRef}
      style={{
        maxWidth: maxWidthPx,
        width: "100%",
        backgroundColor: bg,
        borderRadius: cornerRadius,
        padding: "28px 32px",
        boxShadow: "0 8px 40px rgba(0, 0, 0, 0.25)",
        fontFamily: FONT_STACK,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <Img
          src={identity.avatarUrl}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div
            style={{
              color: ink,
              fontWeight: 800,
              fontSize: 22,
              lineHeight: 1.15,
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {identity.name}
            </span>
            {showVerifiedBadge && identity.verified ? (
              <VerifiedBadge size={20} />
            ) : null}
          </div>
          <div style={{ color: muted, fontSize: 18, lineHeight: 1.3 }}>
            @{identity.handle}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ marginTop: 18 }}>
        <TweetText text={tweet.text} fontSize={textSize} color={ink} />
      </div>

      {/* Media placeholder — TweetMediaGrid wires in later.
          For now render nothing here so this component compiles standalone. */}
      {inCardMedia && tweet.media.length > 0 ? (
        <div
          style={{
            marginTop: 20,
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 12,
            backgroundColor: theme === "dark" ? "#22303C" : "#EFF3F4",
          }}
        />
      ) : null}

      {/* Timestamp */}
      {showTimestamp ? (
        <div
          style={{
            marginTop: 18,
            color: muted,
            fontSize: 16,
          }}
        >
          {formatTimestamp(tweet.createdAt)}
        </div>
      ) : null}

      {/* Stats */}
      {showStats ? (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 32,
            color: muted,
            fontSize: 15,
            alignItems: "center",
            paddingTop: 12,
            borderTop:
              theme === "dark" ? "1px solid #2F3336" : "1px solid #EFF3F4",
          }}
        >
          <div
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <StatIcon kind="reply" /> {compactNumber(tweet.stats.replies)}
          </div>
          <div
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <StatIcon kind="retweet" /> {compactNumber(tweet.stats.retweets)}
          </div>
          <div
            style={{ display: "flex", gap: 6, alignItems: "center" }}
          >
            <StatIcon kind="like" /> {compactNumber(tweet.stats.likes)}
          </div>
        </div>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/tweet/TweetCard.tsx
git commit -m "Add TweetCard component with auto-sizing text and overflow scaling"
```

---

## Task 6: Page profiles + stub avatars

**Files:**
- Create: `lib/page-profiles.ts`
- Create: `public/pages/general/avatar.jpg` (400×400 placeholder)
- Create: `public/pages/fintech/avatar.jpg` (400×400 placeholder)

- [ ] **Step 1: Create the profiles file**

```ts
// lib/page-profiles.ts
import type { BackgroundConfig } from "@/remotion/tweet/types";

export interface PageProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
  defaultTheme: "light" | "dark";
  defaultBackground: BackgroundConfig;
  defaultAspect: "9x16" | "1x1" | "16x9";
  defaultShowStats: boolean;
  defaultShowTimestamp: boolean;
  defaultShowVerifiedBadge: boolean;
}

export const PAGE_PROFILES: readonly PageProfile[] = [
  {
    id: "general",
    displayName: "General Page",
    handle: "general_page",
    avatarUrl: "/pages/general/avatar.jpg",
    verified: false,
    defaultTheme: "dark",
    defaultBackground: {
      kind: "gradient",
      angle: 135,
      from: "#0f172a",
      to: "#1e293b",
    },
    defaultAspect: "9x16",
    defaultShowStats: false,
    defaultShowTimestamp: true,
    defaultShowVerifiedBadge: false,
  },
  {
    id: "fintech",
    displayName: "Fintech Page",
    handle: "fintech_page",
    avatarUrl: "/pages/fintech/avatar.jpg",
    verified: true,
    defaultTheme: "light",
    defaultBackground: { kind: "solid", color: "#f8fafc" },
    defaultAspect: "9x16",
    defaultShowStats: false,
    defaultShowTimestamp: true,
    defaultShowVerifiedBadge: true,
  },
] as const;

export const DEFAULT_PROFILE_ID = "general";

export const getProfile = (id: string): PageProfile =>
  PAGE_PROFILES.find((p) => p.id === id) ?? PAGE_PROFILES[0];
```

- [ ] **Step 2: Generate stub avatar JPGs**

Use ImageMagick if installed:

```bash
mkdir -p public/pages/general public/pages/fintech
magick -size 400x400 xc:'#1e293b' -fill white -gravity center -pointsize 200 -annotate 0 'G' public/pages/general/avatar.jpg
magick -size 400x400 xc:'#f8fafc' -fill '#0f172a' -gravity center -pointsize 200 -annotate 0 'F' public/pages/fintech/avatar.jpg
```

If ImageMagick isn't installed, use any two 400×400 JPGs. The exact image doesn't matter — user swaps later.

- [ ] **Step 3: Commit**

```bash
git add lib/page-profiles.ts public/pages/
git commit -m "Add stubbed page profiles for general and fintech"
```

---

## Task 7: InCardComposition + register 3 aspects

**Files:**
- Create: `remotion/tweet/InCardComposition.tsx`
- Modify: `remotion/Root.tsx`

Goal: a Remotion composition that centers a TweetCard over a background. Three aspect ratios registered. This is the first "URL → MP4" milestone once the editor lands.

- [ ] **Step 1: Create `InCardComposition.tsx`**

```tsx
// remotion/tweet/InCardComposition.tsx
import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { TweetCard } from "./TweetCard";
import type {
  Aspect,
  BackgroundConfig,
  CardIdentity,
  CardTheme,
} from "./types";
import type { FetchedTweet } from "@/lib/tweet-fetch";

const CARD_MAX_WIDTH: Record<Aspect, number> = {
  "9x16": 900,
  "1x1": 900,
  "16x9": 720,
};

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:|\/)/i.test(s);
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(p);

const Background: React.FC<{
  bg: BackgroundConfig;
  forRender: boolean;
}> = ({ bg, forRender }) => {
  if (bg.kind === "solid") {
    return <AbsoluteFill style={{ backgroundColor: bg.color }} />;
  }
  if (bg.kind === "gradient") {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`,
        }}
      />
    );
  }
  const src = resolveSrc(bg.src);
  return (
    <AbsoluteFill>
      {forRender ? (
        <MediaVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <OffthreadVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </AbsoluteFill>
  );
};

export interface InCardProps {
  aspect: Aspect;
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  background: BackgroundConfig;
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  fontScale: number;
  centerY: number;
  forRender: boolean;
}

export const inCardDefaultProps: InCardProps = {
  aspect: "9x16",
  tweet: {
    id: "0",
    text: "Paste a tweet URL to preview.",
    author: { name: "Zinolt", handle: "zinolt", avatarUrl: "", verified: false },
    createdAt: new Date().toISOString(),
    stats: { likes: 0, retweets: 0, replies: 0 },
    media: [],
  },
  identity: {
    name: "Zinolt",
    handle: "zinolt",
    avatarUrl: "/pages/general/avatar.jpg",
    verified: false,
  },
  theme: "dark",
  background: {
    kind: "gradient",
    angle: 135,
    from: "#0f172a",
    to: "#1e293b",
  },
  showStats: false,
  showTimestamp: true,
  showVerifiedBadge: false,
  fontScale: 1,
  centerY: 0.5,
  forRender: false,
};

export const InCardComposition: React.FC<InCardProps> = ({
  aspect,
  tweet,
  identity,
  theme,
  background,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  fontScale,
  centerY,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const translate = spring({
    frame,
    fps,
    from: 20,
    to: 0,
    config: { damping: 20, stiffness: 120 },
    durationInFrames: 18,
  });

  return (
    <AbsoluteFill>
      <Background bg={background} forRender={forRender} />
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5%",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: CARD_MAX_WIDTH[aspect],
            position: "relative",
            top: `${(centerY - 0.5) * 100}%`,
            transform: `translateY(${translate}px)`,
            opacity,
          }}
        >
          <TweetCard
            tweet={tweet}
            identity={identity}
            theme={theme}
            showStats={showStats}
            showTimestamp={showTimestamp}
            showVerifiedBadge={showVerifiedBadge}
            inCardMedia={true}
            maxWidthPx={CARD_MAX_WIDTH[aspect]}
            cornerRadius={20}
            fontScale={fontScale}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Register three aspect variants in `remotion/Root.tsx`**

Replace the entire `remotion/Root.tsx` with:

```tsx
// remotion/Root.tsx
import { Composition } from "remotion";
import { TEMPLATES } from "../lib/templates";
import { Reel, reelDefaultProps } from "./Reel";
import { LetterboxReel, letterboxDefaultProps } from "./LetterboxReel";
import {
  InCardComposition,
  inCardDefaultProps,
} from "./tweet/InCardComposition";

const TWEET_FPS = 30;
const TWEET_DURATION = 30 * 7; // 7s default

const TWEET_ASPECTS = [
  { id: "TweetInCard9x16", aspect: "9x16" as const, width: 1080, height: 1920 },
  { id: "TweetInCard1x1", aspect: "1x1" as const, width: 1080, height: 1080 },
  { id: "TweetInCard16x9", aspect: "16x9" as const, width: 1920, height: 1080 },
];

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.filter((t) => t.id !== "letterbox" && t.id !== "tweet-video").map(
      (t) => (
        <Composition
          key={t.compositionId}
          id={t.compositionId}
          component={Reel}
          durationInFrames={450}
          fps={30}
          width={1080}
          height={1920}
          defaultProps={{ ...reelDefaultProps, backgroundSrc: t.background }}
        />
      ),
    )}
    <Composition
      id="LetterboxReel"
      component={LetterboxReel}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={letterboxDefaultProps}
    />
    {TWEET_ASPECTS.map(({ id, aspect, width, height }) => (
      <Composition
        key={id}
        id={id}
        component={InCardComposition}
        durationInFrames={TWEET_DURATION}
        fps={TWEET_FPS}
        width={width}
        height={height}
        defaultProps={{ ...inCardDefaultProps, aspect }}
      />
    ))}
  </>
);
```

- [ ] **Step 3: Verify in Remotion Studio**

```bash
npm run studio
```

Expected: Studio opens at `http://localhost:3000` (or similar). Sidebar shows `TweetInCard9x16`, `TweetInCard1x1`, `TweetInCard16x9`. Selecting one plays the default "Paste a tweet URL to preview." card over the dark gradient. No console errors.

- [ ] **Step 4: Commit**

```bash
git add remotion/tweet/InCardComposition.tsx remotion/Root.tsx
git commit -m "Add InCardComposition with three aspect variants"
```

---

## Task 8: Editor scaffold — URL fetch, Player preview, MP4 export

**Files:**
- Create: `app/tweet-video/page.tsx`
- Create: `app/tweet-video/_components/TweetVideoStudio.tsx`

Goal: first end-to-end user flow. Paste a URL → see it in the Player → click Compose → download an MP4. Text-only tweets work fully; photo/video wire-up comes in later tasks.

- [ ] **Step 1: Create the suspense wrapper**

```tsx
// app/tweet-video/page.tsx
import { Suspense } from "react";
import { TweetVideoStudio } from "./_components/TweetVideoStudio";

export default function TweetVideoPage() {
  return (
    <Suspense fallback={null}>
      <TweetVideoStudio />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create the studio component**

```tsx
// app/tweet-video/_components/TweetVideoStudio.tsx
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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "tweet";
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

  // canRenderMediaOnWeb probe — same as Studio.tsx.
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
        composition: {
          id: `TweetInCard${aspect}`,
          component: InCardComposition as unknown as React.ComponentType<
            Record<string, unknown>
          >,
          durationInFrames: COMP_DURATION_FRAMES,
          fps: COMP_FPS,
          width: compDims.w,
          height: compDims.h,
          defaultProps:
            inCardDefaultProps as unknown as Record<string, unknown>,
        },
        inputProps: {
          ...inputProps,
          forRender: true,
        } as unknown as Record<string, unknown>,
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

      {/* Top bar with URL + profile + aspect */}
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
          className="px-6 py-2 text-sm"
          style={{ color: BRAND.colors.ink, backgroundColor: "#FFECEC" }}
        >
          {fetchError === "invalid_url"
            ? "That doesn't look like a tweet URL."
            : fetchError === "not_found" || fetchError === "protected"
              ? "Tweet not found or protected."
              : "Both sources failed."}{" "}
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
        {/* LEFT — controls (skeleton for now, filled in later tasks) */}
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

        {/* CENTER — Player */}
        <main
          className="flex flex-1 items-center justify-center"
          style={{ backgroundColor: "#5A5A60", padding: 48 }}
        >
          {tweet ? (
            <Player
              component={
                InCardComposition as unknown as React.ComponentType<
                  Record<string, unknown>
                >
              }
              durationInFrames={COMP_DURATION_FRAMES}
              fps={COMP_FPS}
              compositionWidth={compDims.w}
              compositionHeight={compDims.h}
              controls
              loop
              inputProps={inputProps as unknown as Record<string, unknown>}
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

        {/* RIGHT — download */}
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
```

- [ ] **Step 3: Verify end-to-end with a text tweet**

```bash
npm run dev
```

Navigate to `http://localhost:3000/tweet-video`. Paste a text-only tweet URL (e.g. `https://x.com/naval/status/1002103360646823936`). Click Fetch. Preview should render the tweet card over the profile's dark gradient. Click Download video. Wait for the MP4 to download. Open it — 7-second loop of the tweet card, no audio.

- [ ] **Step 4: Commit**

```bash
git add app/tweet-video/
git commit -m "Add /tweet-video studio with URL fetch, preview, and MP4 export"
```

---

## Task 9: Homepage template card

**Files:**
- Modify: `lib/templates.ts`
- Create: `public/tweet-video/preview.png` (a 720×1280 thumbnail — either a real screenshot or a placeholder)

- [ ] **Step 1: Take a preview screenshot**

With the dev server running, load `/tweet-video`, paste any tweet, take a screenshot of the Player at approximately 720×1280 (or generate a placeholder):

```bash
mkdir -p public/tweet-video
# If you have imagemagick, quick placeholder:
magick -size 720x1280 gradient:'#0f172a-#1e293b' -fill white -gravity center -pointsize 64 -annotate 0 'Tweet\nto\nVideo' public/tweet-video/preview.png
```

Otherwise drop any 720×1280 PNG in that path.

- [ ] **Step 2: Register the template**

Modify `lib/templates.ts` — add to the `TEMPLATES` array (keep everything else):

```ts
export const TEMPLATES: readonly Template[] = [
  {
    id: "letterbox",
    compositionId: "LetterboxReel",
    label: "Letterbox Card",
    background: "",
    preview: "/letterbox-card-empty.png",
  },
  {
    id: "wall",
    compositionId: "WallSignage",
    label: "Wall Signage",
    background: "",
    preview: "/wall/wall-preview.svg",
    href: "/wall",
  },
  {
    id: "frosted",
    compositionId: "FrostedCard",
    label: "Frosted Card",
    background: "",
    preview: "/frosted/frosted-preview.svg",
    href: "/frosted",
  },
  {
    id: "dangle",
    compositionId: "Dangle",
    label: "Dangle Card",
    background: "",
    preview: "/dangle/dangle-preview.svg",
    href: "/dangle",
  },
  {
    id: "tweet-video",
    compositionId: "TweetInCard9x16",
    label: "Tweet to Video",
    background: "",
    preview: "/tweet-video/preview.png",
    href: "/tweet-video",
  },
] as const;
```

- [ ] **Step 3: Verify homepage**

Reload `http://localhost:3000/`. New "Tweet to Video" card appears in the grid. Click "Add your art →" navigates to `/tweet-video`.

- [ ] **Step 4: Commit**

```bash
git add lib/templates.ts public/tweet-video/
git commit -m "Add Tweet to Video card to homepage template grid"
```

---

## Task 10: Photo grid + in-card photos

**Files:**
- Create: `remotion/tweet/TweetMediaGrid.tsx`
- Modify: `remotion/tweet/TweetCard.tsx` (swap placeholder for real grid)

Goal: photos render properly inside the card. Native X grid layouts for 1–4 photos.

- [ ] **Step 1: Create the grid**

```tsx
// remotion/tweet/TweetMediaGrid.tsx
import React from "react";
import { Img } from "remotion";
import type { TweetMedia } from "@/lib/tweet-fetch";

const GAP = 2;
const RADIUS = 12;

const boxStyle: React.CSSProperties = {
  overflow: "hidden",
  borderRadius: RADIUS,
  backgroundColor: "#0f1419",
};

export const TweetMediaGrid: React.FC<{
  media: TweetMedia[];
}> = ({ media }) => {
  const photos = media.filter((m) => m.type === "photo");

  if (photos.length === 0) return null;

  if (photos.length === 1) {
    const p = photos[0];
    const aspect = p.width && p.height ? p.width / p.height : 16 / 9;
    // Soft-cap portrait: never taller than 500 card units.
    const maxHeightRatio = 500;
    return (
      <div
        style={{
          ...boxStyle,
          width: "100%",
          maxHeight: maxHeightRatio,
          aspectRatio: `${aspect}`,
        }}
      >
        <Img
          src={p.url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
    );
  }

  if (photos.length === 2) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: GAP,
          aspectRatio: "16 / 9",
        }}
      >
        {photos.map((p, i) => (
          <div key={i} style={boxStyle}>
            <Img
              src={p.url}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (photos.length === 3) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: GAP,
          aspectRatio: "16 / 9",
        }}
      >
        <div style={{ ...boxStyle, gridRow: "1 / 3" }}>
          <Img
            src={photos[0].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
        <div style={boxStyle}>
          <Img
            src={photos[1].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
        <div style={boxStyle}>
          <Img
            src={photos[2].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </div>
    );
  }

  // 4+ → 2x2
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: GAP,
        aspectRatio: "1 / 1",
      }}
    >
      {photos.slice(0, 4).map((p, i) => (
        <div key={i} style={boxStyle}>
          <Img
            src={p.url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Wire the grid into `TweetCard.tsx`**

Modify `remotion/tweet/TweetCard.tsx`. Replace the media placeholder block:

```tsx
{/* Media placeholder — TweetMediaGrid wires in later.
    For now render nothing here so this component compiles standalone. */}
{inCardMedia && tweet.media.length > 0 ? (
  <div
    style={{
      marginTop: 20,
      width: "100%",
      aspectRatio: "16 / 9",
      borderRadius: 12,
      backgroundColor: theme === "dark" ? "#22303C" : "#EFF3F4",
    }}
  />
) : null}
```

With:

```tsx
{inCardMedia && tweet.media.length > 0 ? (
  <div style={{ marginTop: 20 }}>
    <TweetMediaGrid media={tweet.media} />
  </div>
) : null}
```

And add to the imports at top of `TweetCard.tsx`:

```tsx
import { TweetMediaGrid } from "./TweetMediaGrid";
```

- [ ] **Step 3: Verify with a photo tweet**

Reload `/tweet-video`. Fetch a tweet with 1 photo, then 4 photos. Photos should render in the card. Download and verify the MP4 shows the photos.

- [ ] **Step 4: Commit**

```bash
git add remotion/tweet/TweetMediaGrid.tsx remotion/tweet/TweetCard.tsx
git commit -m "Render photos in tweet card using native X 1-4 grid layouts"
```

---

## Task 11: Video/GIF support via local-video SW

**Files:**
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx` (video download + SW upload)
- Modify: `remotion/tweet/TweetMediaGrid.tsx` (video slot)

Goal: video and GIF tweets play in the preview and export correctly. Route through `storeLocalVideo()` so `renderMediaOnWeb` can range-fetch.

- [ ] **Step 1: Extend the studio to download tweet media into the SW**

Add near the top of `TweetVideoStudio.tsx`, after other imports:

```tsx
import {
  deleteLocalVideo,
  prepareLocalVideoSW,
  pingLocalVideoSW,
  storeLocalVideo,
} from "@/lib/local-video";
```

Add these state and effects right after the existing `useState` calls:

```tsx
const [preparedTweet, setPreparedTweet] = useState<FetchedTweet | null>(null);
const preparedUrlsRef = useRef<string[]>([]);

useEffect(() => {
  prepareLocalVideoSW();
  const id = setInterval(pingLocalVideoSW, 15_000);
  return () => clearInterval(id);
}, []);

// When a new tweet is fetched, download any video/gif into the local SW and
// rewrite its URL to /__local-video/<id>. Photos stay on the proxy URL.
useEffect(() => {
  if (!tweet) {
    setPreparedTweet(null);
    return;
  }
  let cancelled = false;
  const localUrlsCreated: string[] = [];

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
          return m; // fall back to proxy URL; player may still play it
        }
      }),
    );
    if (cancelled) {
      for (const u of localUrlsCreated) void deleteLocalVideo(u);
      return;
    }
    // Free previous SW clips
    for (const u of preparedUrlsRef.current) void deleteLocalVideo(u);
    preparedUrlsRef.current = localUrlsCreated;
    setPreparedTweet({ ...tweet, media: newMedia });
  })();

  return () => {
    cancelled = true;
  };
}, [tweet]);

// Cleanup SW clips on unmount
useEffect(() => {
  return () => {
    for (const u of preparedUrlsRef.current) void deleteLocalVideo(u);
  };
}, []);
```

Replace every use of `tweet` in `inputProps` and download with `preparedTweet ?? tweet`. Specifically, in the `inputProps` `useMemo`:

```tsx
tweet: preparedTweet ?? tweet ?? inCardDefaultProps.tweet,
```

And add `preparedTweet` to the dependency array.

Also change the Player `tweet ?` check to `preparedTweet ?` so the preview waits until videos are ready:

```tsx
{preparedTweet ? (
  <Player ... />
) : tweet ? (
  <div>Preparing media…</div>
) : (
  <div>Paste a tweet URL to start</div>
)}
```

The exact fallback structure:

```tsx
{preparedTweet ? (
  <Player
    component={
      InCardComposition as unknown as React.ComponentType<
        Record<string, unknown>
      >
    }
    durationInFrames={COMP_DURATION_FRAMES}
    fps={COMP_FPS}
    compositionWidth={compDims.w}
    compositionHeight={compDims.h}
    controls
    loop
    inputProps={inputProps as unknown as Record<string, unknown>}
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
      {tweet ? "Preparing media…" : "Paste a tweet URL to start"}
    </p>
  </div>
)}
```

Also make the Download button gate on `preparedTweet`, not `tweet`:

```tsx
disabled={!preparedTweet || isRendering || canExport === false}
```

And in `handleDownload`, replace `if (!tweet) return;` with `if (!preparedTweet) return;`, and use `preparedTweet.text` in the slug and `preparedTweet` throughout.

- [ ] **Step 2: Wire video into `TweetMediaGrid.tsx`**

Modify the file — at the top, add:

```tsx
import { OffthreadVideo } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
```

Add a `forRender: boolean` prop on the component:

```tsx
export const TweetMediaGrid: React.FC<{
  media: TweetMedia[];
  forRender?: boolean;
}> = ({ media, forRender = false }) => {
  const items = media; // videos included now
  if (items.length === 0) return null;

  const first = items[0];
  if (first.type === "video" || first.type === "gif") {
    const aspect =
      first.width && first.height ? first.width / first.height : 16 / 9;
    return (
      <div
        style={{
          ...boxStyle,
          width: "100%",
          aspectRatio: `${aspect}`,
          maxHeight: 500,
        }}
      >
        {forRender ? (
          <MediaVideo
            src={first.url}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <OffthreadVideo
            src={first.url}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
      </div>
    );
  }

  // Photos-only path below — leave the existing 1/2/3/4 branches unchanged,
  // but change the `photos` filter to just the items array since we've already
  // handled the video case above.
  const photos = items.filter((m) => m.type === "photo");
  // ...rest of the existing photo layout code, unchanged...
```

Keep the existing photo branches (1/2/3/4) as-is, just replacing the leading `const photos = media.filter(...)` with the reworked version above.

- [ ] **Step 3: Thread `forRender` through `TweetCard` and `InCardComposition`**

In `TweetCard.tsx`, add `forRender?: boolean` to `TweetCardProps` in `remotion/tweet/types.ts`:

```ts
export interface TweetCardProps {
  // ...existing...
  forRender?: boolean;
}
```

In `TweetCard.tsx`, destructure `forRender = false` from props and pass through:

```tsx
<TweetMediaGrid media={tweet.media} forRender={forRender} />
```

In `InCardComposition.tsx`, forward `forRender` to `<TweetCard>`:

```tsx
<TweetCard
  ...existing props...
  forRender={forRender}
/>
```

- [ ] **Step 4: Verify with a video tweet**

Fetch a video tweet. Preview should show the video playing (muted) inside the card. Download — verify the MP4 has the video (still muted; audio comes in Task 14).

- [ ] **Step 5: Commit**

```bash
git add app/tweet-video/_components/TweetVideoStudio.tsx remotion/tweet/TweetMediaGrid.tsx remotion/tweet/TweetCard.tsx remotion/tweet/types.ts remotion/tweet/InCardComposition.tsx
git commit -m "Support tweet videos and GIFs via local-video service worker"
```

---

## Task 12: StackedComposition + auto layout selection

**Files:**
- Create: `remotion/tweet/StackedComposition.tsx`
- Modify: `remotion/Root.tsx` (register 3 stacked variants)
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx` (layout toggle + auto-select)

Goal: the primary meme format. Compact card on top, full-frame video in the middle, blurred-video background behind everything. Auto-selected when the tweet has video/gif.

- [ ] **Step 1: Create `StackedComposition.tsx`**

```tsx
// remotion/tweet/StackedComposition.tsx
import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import { TweetCard } from "./TweetCard";
import type {
  Aspect,
  BackgroundConfig,
  CardIdentity,
  CardTheme,
} from "./types";
import type { FetchedTweet, TweetMedia } from "@/lib/tweet-fetch";

const CARD_MAX_WIDTH: Record<Aspect, number> = {
  "9x16": 780,
  "1x1": 720,
  "16x9": 640,
};

const VIDEO_ZONE: Record<Aspect, { widthPct: number; heightPct: number; topPct: number }> = {
  "9x16": { widthPct: 92, heightPct: 55, topPct: 30 },
  "1x1": { widthPct: 84, heightPct: 60, topPct: 26 },
  "16x9": { widthPct: 55, heightPct: 78, topPct: 12 },
};

const CARD_TOP: Record<Aspect, number> = {
  "9x16": 4,
  "1x1": 3,
  "16x9": 2,
};

const isAbsoluteUrl = (s: string) => /^(blob:|data:|https?:|file:|\/)/i.test(s);
const resolveSrc = (p: string): string =>
  isAbsoluteUrl(p) ? p : staticFile(p);

const SolidOrGradient: React.FC<{ bg: BackgroundConfig }> = ({ bg }) => {
  if (bg.kind === "solid") {
    return <AbsoluteFill style={{ backgroundColor: bg.color }} />;
  }
  if (bg.kind === "gradient") {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`,
        }}
      />
    );
  }
  return null;
};

export interface StackedProps {
  aspect: Aspect;
  tweet: FetchedTweet;
  identity: CardIdentity;
  theme: CardTheme;
  background: BackgroundConfig; // fallback if no video
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  fontScale: number;
  muted: boolean;
  forRender: boolean;
}

export const stackedDefaultProps: StackedProps = {
  aspect: "9x16",
  tweet: {
    id: "0",
    text: "Fetch a video tweet to preview.",
    author: { name: "Zinolt", handle: "zinolt", avatarUrl: "", verified: false },
    createdAt: new Date().toISOString(),
    stats: { likes: 0, retweets: 0, replies: 0 },
    media: [],
  },
  identity: {
    name: "Zinolt",
    handle: "zinolt",
    avatarUrl: "/pages/general/avatar.jpg",
    verified: false,
  },
  theme: "dark",
  background: { kind: "solid", color: "#000000" },
  showStats: false,
  showTimestamp: false,
  showVerifiedBadge: false,
  fontScale: 1,
  muted: false,
  forRender: false,
};

function pickVideo(media: TweetMedia[]): TweetMedia | null {
  return media.find((m) => m.type === "video" || m.type === "gif") ?? null;
}

export const StackedComposition: React.FC<StackedProps> = ({
  aspect,
  tweet,
  identity,
  theme,
  background,
  showStats,
  showTimestamp,
  showVerifiedBadge,
  fontScale,
  muted,
  forRender,
}) => {
  const frame = useCurrentFrame();
  const cardOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const video = pickVideo(tweet.media);
  const videoSrc = video ? resolveSrc(video.url) : "";
  const isGif = video?.type === "gif";
  const zone = VIDEO_ZONE[aspect];

  return (
    <AbsoluteFill>
      {/* Background */}
      {video ? (
        <AbsoluteFill>
          {forRender ? (
            <MediaVideo
              src={videoSrc}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(40px) brightness(0.6)",
              }}
            />
          ) : (
            <OffthreadVideo
              src={videoSrc}
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(40px) brightness(0.6)",
              }}
            />
          )}
        </AbsoluteFill>
      ) : (
        <SolidOrGradient bg={background} />
      )}

      {/* Main video zone */}
      {video ? (
        <AbsoluteFill
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: `${zone.widthPct}%`,
              height: `${zone.heightPct}%`,
              marginTop: `${zone.topPct - 50}%`, // shift down from center
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {forRender ? (
              <MediaVideo
                src={videoSrc}
                muted={muted || isGif}
                {...(isGif ? { loop: true } : {})}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 16,
                }}
              />
            ) : (
              <OffthreadVideo
                src={videoSrc}
                muted={muted || isGif}
                {...(isGif ? { loop: true } : {})}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 16,
                }}
              />
            )}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* Compact tweet card */}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: `${CARD_TOP[aspect]}%`,
          paddingLeft: "4%",
          paddingRight: "4%",
          opacity: cardOpacity,
        }}
      >
        <TweetCard
          tweet={tweet}
          identity={identity}
          theme={theme}
          showStats={showStats}
          showTimestamp={showTimestamp}
          showVerifiedBadge={showVerifiedBadge}
          inCardMedia={false}
          maxWidthPx={CARD_MAX_WIDTH[aspect]}
          cornerRadius={18}
          fontScale={fontScale}
          forRender={forRender}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Register 3 stacked comps in `Root.tsx`**

Modify `remotion/Root.tsx` — add above the existing `TWEET_ASPECTS`:

```tsx
import {
  StackedComposition,
  stackedDefaultProps,
} from "./tweet/StackedComposition";

const STACKED_ASPECTS = [
  { id: "TweetStacked9x16", aspect: "9x16" as const, width: 1080, height: 1920 },
  { id: "TweetStacked1x1", aspect: "1x1" as const, width: 1080, height: 1080 },
  { id: "TweetStacked16x9", aspect: "16x9" as const, width: 1920, height: 1080 },
];
```

And in the JSX, after the `TWEET_ASPECTS.map`, add:

```tsx
{STACKED_ASPECTS.map(({ id, aspect, width, height }) => (
  <Composition
    key={id}
    id={id}
    component={StackedComposition}
    durationInFrames={30 * 12} // max — editor overrides per tweet
    fps={30}
    width={width}
    height={height}
    defaultProps={{ ...stackedDefaultProps, aspect }}
  />
))}
```

- [ ] **Step 3: Add layout state + auto-select in the editor**

Modify `app/tweet-video/_components/TweetVideoStudio.tsx`.

At top, add import:

```tsx
import {
  StackedComposition,
  stackedDefaultProps,
  type StackedProps,
} from "@/remotion/tweet/StackedComposition";
```

Add state:

```tsx
const [layout, setLayout] = useState<"incard" | "stacked">("incard");
const [layoutDirty, setLayoutDirty] = useState(false);
const [muted, setMuted] = useState(false);
```

Auto-select layout when a prepared tweet arrives (only if user hasn't overridden):

```tsx
useEffect(() => {
  if (!preparedTweet || layoutDirty) return;
  const hasVideo = preparedTweet.media.some(
    (m) => m.type === "video" || m.type === "gif",
  );
  setLayout(hasVideo ? "stacked" : "incard");
}, [preparedTweet, layoutDirty]);
```

Compute duration based on layout + video presence:

```tsx
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
```

Split `inputProps` into per-layout:

```tsx
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
```

Delete the old combined `inputProps`.

Update the Player and download:

```tsx
const currentComponent =
  layout === "stacked" ? StackedComposition : InCardComposition;
const currentProps = layout === "stacked" ? stackedInputProps : inCardInputProps;
const currentDefaultProps =
  layout === "stacked" ? stackedDefaultProps : inCardDefaultProps;
const currentCompId =
  layout === "stacked" ? `TweetStacked${aspect}` : `TweetInCard${aspect}`;
```

Player:

```tsx
<Player
  component={
    currentComponent as unknown as React.ComponentType<Record<string, unknown>>
  }
  durationInFrames={durationFrames}
  fps={COMP_FPS}
  compositionWidth={compDims.w}
  compositionHeight={compDims.h}
  controls
  loop
  inputProps={currentProps as unknown as Record<string, unknown>}
  style={{ width: playerW, height: playerH }}
/>
```

Download:

```tsx
const { getBlob } = await renderMediaOnWeb({
  composition: {
    id: currentCompId,
    component: currentComponent as unknown as React.ComponentType<
      Record<string, unknown>
    >,
    durationInFrames: durationFrames,
    fps: COMP_FPS,
    width: compDims.w,
    height: compDims.h,
    defaultProps: currentDefaultProps as unknown as Record<string, unknown>,
  },
  inputProps: {
    ...currentProps,
    forRender: true,
  } as unknown as Record<string, unknown>,
  licenseKey: "free-license",
  videoBitrate: layout === "stacked" ? 16_000_000 : 12_000_000,
  hardwareAcceleration: "prefer-hardware",
  ...(layout === "stacked" && !muted
    ? { audioBitrate: "high" as const }
    : { muted: true }),
  onProgress: ({ progress: p }) => setProgress(p),
});
```

Add the layout toggle to the left panel:

```tsx
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
```

- [ ] **Step 4: Verify with a video tweet**

Fetch a video tweet. Layout should auto-flip to Stacked. Preview shows the compact card up top, video below, blurred background. Download and inspect the MP4.

- [ ] **Step 5: Commit**

```bash
git add remotion/tweet/StackedComposition.tsx remotion/Root.tsx app/tweet-video/_components/TweetVideoStudio.tsx
git commit -m "Add StackedComposition and auto-select layout for video tweets"
```

---

## Task 13: Background editor — solid/gradient/loop/upload

**Files:**
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx`
- Add: `LOOP_LIBRARY` constant (inline in the studio or in a new file)

Goal: user can pick or upload a background. Applies to InCard by default; Stacked's default is the blurred video BG but the picker also applies when the user forces solid/gradient/loop over the blurred BG.

- [ ] **Step 1: Add the loop library constant**

Inline in `TweetVideoStudio.tsx`, near the top:

```tsx
const LOOP_LIBRARY: Array<{ id: string; label: string; src: string }> = [
  { id: "light-ray-white", label: "Light Ray", src: "/rays/light-ray-white.mp4" },
  { id: "ferrofluid-white", label: "Ferrofluid", src: "/rays/ferrofluid-white.mp4" },
  { id: "light-pillar", label: "Light Pillar", src: "/rays/light-pillar-white-v3.mp4" },
];
```

- [ ] **Step 2: Add background state (with dirty tracking) and upload handling**

```tsx
const [bg, setBg] = useState<BackgroundConfig>(profile.defaultBackground);
const [bgDirty, setBgDirty] = useState(false);
const bgUploadUrlRef = useRef<string | null>(null);

// Reset background when profile changes AND user hasn't touched it
useEffect(() => {
  if (!bgDirty) setBg(profile.defaultBackground);
}, [profile, bgDirty]);

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
    else if (kind === "loop") setBg({ kind: "loop", src: LOOP_LIBRARY[0].src });
    else setBg({ kind: "upload", src: "" });
  },
  [],
);

const onBgUpload = useCallback(async (file: File) => {
  // Free previous
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
```

Add import for `BackgroundConfig`:

```tsx
import type { BackgroundConfig } from "@/remotion/tweet/types";
```

- [ ] **Step 3: Add background controls to the left panel**

```tsx
<div className="flex flex-col gap-3">
  <label
    className="font-sans text-xs uppercase tracking-wide"
    style={{ color: BRAND.colors.grey500 }}
  >
    Background
  </label>
  <Select value={bg.kind} onValueChange={(v) => onBgKindChange(v as BackgroundConfig["kind"])}>
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
    />
  ) : null}
</div>
```

- [ ] **Step 4: Wire `bg` into both compositions' inputProps**

Replace `background: profile.defaultBackground` in both `inCardInputProps` and `stackedInputProps` with `background: bg`. Add `bg` to their dependency arrays.

- [ ] **Step 5: Verify each background kind**

Fetch a text tweet. Try each background kind — solid, gradient, a loop, an image upload, a video upload. Download once with each to confirm the render matches the preview.

- [ ] **Step 6: Commit**

```bash
git add app/tweet-video/_components/TweetVideoStudio.tsx
git commit -m "Add background editor with solid, gradient, loop, and upload options"
```

---

## Task 14: Audio mute toggle + polish

**Files:**
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx` (add mute checkbox)

Goal: user can toggle audio on/off when the tweet has a video. Default unmuted.

- [ ] **Step 1: Add mute checkbox to left panel**

Show only when the prepared tweet has a video (not GIF):

```tsx
{preparedTweet?.media.some((m) => m.type === "video") ? (
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
```

The `muted` state and its use in `stackedInputProps` + `renderMediaOnWeb` are already set up from Task 12.

Also add mute to `inCardInputProps` — extend `InCardProps` and `InCardComposition` to accept `muted`:

In `remotion/tweet/InCardComposition.tsx`, add to props:

```ts
export interface InCardProps {
  // ...existing...
  muted: boolean;
}
```

And to `inCardDefaultProps`: `muted: false`.

Pass through to `<TweetMediaGrid>` (which needs to accept `muted` — extend it too, or just always render muted in-card since the primary audio use is Stacked).

For simplicity: **keep in-card videos always muted** for v1 (documented in the spec: "Muted-optional per audio toggle"). Only Stacked routes audio. So no changes needed in `InCardComposition` — leave `muted: true` always in the media grid.

- [ ] **Step 2: Verify audio toggle**

Fetch a video tweet with audio (a talking-head clip works). Default Stacked layout. Preview plays with audio. Toggle mute — audio stops. Download once unmuted, once muted, confirm each MP4 matches.

- [ ] **Step 3: Commit**

```bash
git add app/tweet-video/_components/TweetVideoStudio.tsx
git commit -m "Add mute audio toggle for stacked video tweets"
```

---

## Task 15: Font scale + duration sliders

**Files:**
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx`

Goal: fine-tune controls for text sizing and (in-card only) duration.

- [ ] **Step 1: Add state**

```tsx
const [fontScale, setFontScale] = useState(1);
const [durationSec, setDurationSec] = useState(7);
```

Feed `fontScale` into both input-props (`fontScale` field).

Modify `durationFrames`:

```tsx
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
```

- [ ] **Step 2: Add sliders to the left panel**

```tsx
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
  />
</div>

{layout === "incard" &&
!preparedTweet?.media.some(
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
    />
  </div>
) : null}
```

- [ ] **Step 3: Verify**

Long tweet → text at max font size overflows without font-scale adjustment. Scale down — text fits. Text tweet → duration slider works, MP4 length matches.

- [ ] **Step 4: Commit**

```bash
git add app/tweet-video/_components/TweetVideoStudio.tsx
git commit -m "Add font scale and duration sliders to tweet video studio"
```

---

## Task 16: Toggle controls + final polish

**Files:**
- Modify: `app/tweet-video/_components/TweetVideoStudio.tsx`

Goal: expose card-row toggles (stats/timestamp/verified badge), card theme, and clean up any rough edges. Verify each error state.

- [ ] **Step 1: Add toggle state with dirty tracking**

```tsx
const [theme, setTheme] = useState<CardTheme>(profile.defaultTheme);
const [themeDirty, setThemeDirty] = useState(false);
const [showStats, setShowStats] = useState(profile.defaultShowStats);
const [showStatsDirty, setShowStatsDirty] = useState(false);
const [showTimestamp, setShowTimestamp] = useState(profile.defaultShowTimestamp);
const [showTimestampDirty, setShowTimestampDirty] = useState(false);
const [showVerifiedBadge, setShowVerifiedBadge] = useState(
  profile.defaultShowVerifiedBadge,
);
const [showVerifiedBadgeDirty, setShowVerifiedBadgeDirty] = useState(false);

useEffect(() => {
  if (!themeDirty) setTheme(profile.defaultTheme);
  if (!showStatsDirty) setShowStats(profile.defaultShowStats);
  if (!showTimestampDirty) setShowTimestamp(profile.defaultShowTimestamp);
  if (!showVerifiedBadgeDirty)
    setShowVerifiedBadge(profile.defaultShowVerifiedBadge);
}, [
  profile,
  themeDirty,
  showStatsDirty,
  showTimestampDirty,
  showVerifiedBadgeDirty,
]);
```

Import `CardTheme`:

```tsx
import type { BackgroundConfig, CardTheme } from "@/remotion/tweet/types";
```

Feed these into both `inCardInputProps` and `stackedInputProps`, replacing the profile-default reads. Add them to the dep arrays.

- [ ] **Step 2: Add UI**

```tsx
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
      onClick={() => { setTheme("light"); setThemeDirty(true); }}
      className="flex-1"
    >
      Light
    </Button>
    <Button
      variant={theme === "dark" ? "default" : "outline"}
      onClick={() => { setTheme("dark"); setThemeDirty(true); }}
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
  <label className="flex items-center gap-2 font-sans text-sm">
    <input
      type="checkbox"
      checked={showStats}
      onChange={(e) => { setShowStats(e.target.checked); setShowStatsDirty(true); }}
    />
    Show stats
  </label>
  <label className="flex items-center gap-2 font-sans text-sm">
    <input
      type="checkbox"
      checked={showTimestamp}
      onChange={(e) => { setShowTimestamp(e.target.checked); setShowTimestampDirty(true); }}
    />
    Show timestamp
  </label>
  <label className="flex items-center gap-2 font-sans text-sm">
    <input
      type="checkbox"
      checked={showVerifiedBadge}
      onChange={(e) => { setShowVerifiedBadge(e.target.checked); setShowVerifiedBadgeDirty(true); }}
    />
    Show verified badge
  </label>
</div>
```

- [ ] **Step 3: Verify error states**

- Paste garbage into the URL field → Fetch → red banner "That doesn't look like a tweet URL".
- Paste a deleted tweet's URL → red banner + syndication fallback button. Click it — if syndication also fails, banner stays with new error.
- Kill your internet, try to fetch → error banner shows.
- Fetch a good tweet, click Compose while offline → export error appears in right panel.
- Reload, refetch — everything recovers cleanly.

- [ ] **Step 4: Commit**

```bash
git add app/tweet-video/_components/TweetVideoStudio.tsx
git commit -m "Add card theme and row toggles with dirty-flag tracking"
```

---

## Task 17: Build sanity + smoke test

Goal: make sure the whole thing builds and renders end-to-end at every aspect.

- [ ] **Step 1: Typecheck + build**

```bash
npm run build
```

Expected: no TypeScript errors. If there are errors, fix them before moving on. Common issues:
- `bg` used before declaration (React hook ordering) — declare `bg` before any `useMemo` that reads it.
- Missing exports on `InCardProps` / `StackedProps` — re-export from the composition files.

- [ ] **Step 2: Smoke test across coverage matrix**

For each of these tweet types, fetch → export at 9:16, 1:1, 16:9, and verify the MP4 plays:

- Short text banger
- ~280-char wall (verify auto-sizing kicks in)
- "No one:\nX:" multi-line meme format
- Single photo
- 4-photo grid
- Native video (landscape)
- Native video (vertical, i.e., an iPhone recording)
- GIF reply
- Emoji-dense text
- A verified-user tweet with badge toggle on

Record any failures. Fix.

- [ ] **Step 3: Commit anything from the smoke fixes**

```bash
git add -A
git commit -m "Fix smoke test issues from tweet-video E2E pass"
```

Skip if no fixes needed.

- [ ] **Step 4: Final commit + push**

```bash
git push
```

---

## Self-Review Checklist

Ran before saving this plan. Findings and their fixes:

1. **Spec coverage:**
   - Fetch layer — Task 1 + Task 2 ✅
   - TweetCard + auto-sizing — Task 5 ✅
   - Twemoji — Task 3 + Task 4 ✅
   - Media rendering (photos, video, GIF) — Task 10 + Task 11 ✅
   - InCard + Stacked comps with 3 aspects each — Tasks 7, 12 ✅
   - Page profiles — Task 6 ✅
   - Editor UI (three-pane, all controls, all states) — Tasks 8, 13, 14, 15, 16 ✅
   - Audio passthrough — Task 14 ✅
   - Homepage template card — Task 9 ✅
   - Build + smoke — Task 17 ✅
   - Batch mode — deferred to v1.1 per spec, not in this plan.

2. **Placeholder scan:** none.

3. **Type consistency:**
   - `Aspect` uses `9x16`/`1x1`/`16x9` (no colons — safer as composition IDs), consistent across `types.ts`, `Root.tsx`, and studio.
   - `BackgroundConfig` shape identical in `types.ts` and `page-profiles.ts`.
   - `CardIdentity` shape identical between `TweetCardProps`, `InCardProps`, `StackedProps`.
   - `forRender` optional on `TweetCard` (defaulted false), required on compositions — matches how `Studio.tsx` handles it.

4. **Ambiguity check:** the term "muted" appears in both the Composition props and the in-card media grid. Documented in Task 14 that in-card videos are always muted for v1; audio only routes through Stacked.

---

## Post-Plan Notes

- **Twemoji size:** ~10MB in `public/twemoji/`. Not gitignored; committed to keep renders deterministic. If it becomes uncomfortable, drop the fetch step from the commit and rely on a build-time script instead.
- **Local-video SW aliveness:** the studio pings the SW every 15s (from Task 11). Same pattern as Studio.tsx uses for LetterboxReel. Don't remove that interval.
- **fxtwitter reliability:** third-party service, may die. Syndication fallback is our safety net. Both routes are proxied through `/api/tweet` so switching to a third source later is one file change.
