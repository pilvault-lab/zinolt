# Quoted Tweet Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the quoted tweet inside the main tweet card in the `/tweet-video` studio's InCard layout.

**Architecture:** Extend `FetchedTweet` with an optional `quoted: QuotedTweet` field. Refactor both fetch adapters (`fxtwitter`, `syndication`) to extract shared mapping helpers and populate the new field. Introduce a new `QuotedTweetCard` component that reuses `TweetText` and `TweetMediaGrid`, and slot it into `TweetCard` between the outer media and the timestamp.

**Tech Stack:** Next.js 16 App Router route handler, Remotion 4.0.478 components, TypeScript, no test framework.

**Verification approach.** This codebase has no unit-test infrastructure and the spec explicitly opts out of adding one. Each task verifies via `npm run build` (which runs both TypeScript type-check and lint via `next build`) plus a targeted manual check appropriate to the task (curl for API, studio smoke for components). See spec `docs/superpowers/specs/2026-07-16-quoted-tweet-support-design.md` for full context.

**Reference spec:** `docs/superpowers/specs/2026-07-16-quoted-tweet-support-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `lib/tweet-fetch.ts` | Modify | Add `QuotedTweet` interface; add optional `quoted` on `FetchedTweet` |
| `app/api/tweet/route.ts` | Modify | Extract shared mapping helpers; populate `quoted` from both adapters |
| `remotion/tweet/QuotedTweetCard.tsx` | Create | Nested frosted-glass card for the quoted tweet |
| `remotion/tweet/TweetCard.tsx` | Modify | Render `QuotedTweetCard` between media and timestamp; update auto-scale effect deps |

---

## Task 1: Add `QuotedTweet` type

**Files:**
- Modify: `lib/tweet-fetch.ts`

- [ ] **Step 1: Add the `QuotedTweet` interface and `quoted?` field**

Open `lib/tweet-fetch.ts`. Between the `FetchedTweet` interface and the `TweetMedia` interface, keep `TweetMedia` where it is, but add a new `QuotedTweet` interface after `TweetMedia`, and add an optional `quoted` field on `FetchedTweet`. Final file contents:

```ts
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
  quoted?: QuotedTweet;
}

export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  width: number;
  height: number;
  durationMs?: number;
  thumbnailUrl?: string;
}

export interface QuotedTweet {
  id: string;
  text: string;
  author: {
    name: string;
    handle: string;
    avatarUrl: string;
    verified: boolean;
  };
  createdAt: string;
  media: TweetMedia[];
}

export type TweetFetchError =
  | "invalid_url"
  | "not_found"
  | "protected"
  | "both_sources_failed";

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

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. No type errors introduced. `quoted` is optional so no existing consumer breaks.

- [ ] **Step 3: Commit**

```bash
git add lib/tweet-fetch.ts
git commit -m "Add QuotedTweet type and optional quoted field on FetchedTweet"
```

---

## Task 2: Extract shared fxtwitter mapping and populate `quoted`

**Files:**
- Modify: `app/api/tweet/route.ts`

- [ ] **Step 1: Extend `FxTweetJson` shape with an optional `quote` field**

In `app/api/tweet/route.ts`, replace the current `FxTweetJson` interface (lines 29-54) with the two interfaces below. `FxTweetLike` captures the shape shared between the outer tweet and the quote so both can be mapped by the same helper:

```ts
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
```

- [ ] **Step 2: Extract a shared helper for fx media mapping**

Above `fetchFx`, add a helper that maps an fx media array to `TweetMedia[]`:

```ts
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
```

- [ ] **Step 3: Add a `mapFxQuote` helper that produces `QuotedTweet`**

Import `QuotedTweet` at the top of the file — update the existing import:

```ts
import type { FetchedTweet, QuotedTweet, TweetMedia } from "@/lib/tweet-fetch";
```

Then add below `mapFxMedia`:

```ts
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
```

- [ ] **Step 4: Update `fetchFx` to use the helpers and populate `quoted`**

Replace the body of `fetchFx` (currently lines 56-89). Final version:

```ts
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
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Live-test the fx path with a known quote-tweet URL**

Start the dev server: `npm run dev` (background it or use another terminal). Then in a new shell:

```bash
curl -s "http://localhost:3000/api/tweet?url=https://x.com/elonmusk/status/1780213311998198213" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('has quoted:',!!j.quoted);if(j.quoted)console.log('quoted author:',j.quoted.author.handle,'| media count:',j.quoted.media.length)})"
```

Expected output: `has quoted: true` and the quoted author's handle. If the specific tweet above is no longer a quote-tweet, substitute any other known quote-tweet URL. If a quote-tweet URL returns `has quoted: false`, the mapping is broken — investigate before moving on.

- [ ] **Step 7: Commit**

```bash
git add app/api/tweet/route.ts
git commit -m "Extract fxtwitter shared mappers and populate quoted field"
```

---

## Task 3: Add syndication quote extraction

**Files:**
- Modify: `app/api/tweet/route.ts`

- [ ] **Step 1: Extend `SynTweetJson` with `quoted_tweet`**

In `app/api/tweet/route.ts`, replace the current `SynTweetJson` interface (lines 91-117 before the fx refactor changed line numbers — locate by name) with the three interfaces below. `SynMediaDetail` is extracted so it can be reused by the media mapper, and `SynQuotedTweet` is a subset of the outer shape (no `favorite_count` / `conversation_count`):

```ts
interface SynMediaDetail {
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
}

interface SynQuotedTweet {
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
  mediaDetails?: SynMediaDetail[];
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
  mediaDetails?: SynMediaDetail[];
  quoted_tweet?: SynQuotedTweet;
}
```

- [ ] **Step 2: Extract a shared syndication media mapper**

Above `fetchSyndication`, add:

```ts
function mapSynMedia(details: SynMediaDetail[] | undefined): TweetMedia[] {
  const media: TweetMedia[] = [];
  for (const m of details ?? []) {
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
  return media;
}
```

- [ ] **Step 3: Add a `mapSynQuote` helper**

Below `mapSynMedia`, add:

```ts
function mapSynQuote(q: SynQuotedTweet): QuotedTweet {
  const rawText = decodeEntities(q.text.replace(/<[^>]+>/g, ""));
  return {
    id: q.id_str,
    text: stripTrailingSelfLink(rawText),
    author: {
      name: q.user.name,
      handle: q.user.screen_name,
      avatarUrl: proxyMediaUrl(q.user.profile_image_url_https),
      verified: Boolean(q.user.is_blue_verified || q.user.verified),
    },
    createdAt: q.created_at,
    media: mapSynMedia(q.mediaDetails),
  };
}
```

- [ ] **Step 4: Replace `fetchSyndication` body to use the helpers and populate `quoted`**

Replace `fetchSyndication` (currently lines 119-174):

```ts
async function fetchSyndication(id: string): Promise<FetchedTweet | null> {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as SynTweetJson;

  const media = mapSynMedia(json.mediaDetails);
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
    quoted: json.quoted_tweet ? mapSynQuote(json.quoted_tweet) : undefined,
  };
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Live-test the syndication path with `force=syndication`**

With `npm run dev` still running:

```bash
curl -s "http://localhost:3000/api/tweet?url=https://x.com/elonmusk/status/1780213311998198213&force=syndication" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('has quoted:',!!j.quoted);if(j.quoted)console.log('quoted author:',j.quoted.author.handle,'| media count:',j.quoted.media.length)})"
```

Expected: `has quoted: true` (assuming the URL is still a quote-tweet). If syndication doesn't surface `quoted_tweet` for the URL you chose, try another well-known quote-tweet URL — some tweets are only available via fx.

- [ ] **Step 7: Commit**

```bash
git add app/api/tweet/route.ts
git commit -m "Extract syndication shared mappers and populate quoted field"
```

---

## Task 4: Create `QuotedTweetCard` component

**Files:**
- Create: `remotion/tweet/QuotedTweetCard.tsx`

- [ ] **Step 1: Write the full component**

Create `remotion/tweet/QuotedTweetCard.tsx` with these contents:

```tsx
import React from "react";
import { Img } from "remotion";
import { TweetText } from "./TweetText";
import { TweetMediaGrid } from "./TweetMediaGrid";
import type { QuotedTweet } from "@/lib/tweet-fetch";
import type { CardTheme } from "./types";

interface QuotedTweetCardProps {
  quote: QuotedTweet;
  theme: CardTheme;
  outerTextSize: number;
  showVerifiedBadge: boolean;
  forRender: boolean;
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
      marginLeft: 3,
      marginRight: 3,
    }}
    aria-hidden
  >
    <path
      fill="#1D9BF0"
      d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
    />
  </svg>
);

function formatCompactDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

export const QuotedTweetCard: React.FC<QuotedTweetCardProps> = ({
  quote,
  theme,
  outerTextSize,
  showVerifiedBadge,
  forRender,
}) => {
  const bg =
    theme === "dark"
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(255, 255, 255, 0.4)";
  const border =
    theme === "dark"
      ? "1px solid rgba(255, 255, 255, 0.12)"
      : "1px solid rgba(15, 20, 25, 0.06)";
  const ink = theme === "dark" ? "#FFFFFF" : "#0F1419";
  const muted = theme === "dark" ? "rgba(255, 255, 255, 0.72)" : "#536471";
  const avatarFallback = theme === "dark" ? "#22303C" : "#EFF3F4";

  const textSize = Math.round(outerTextSize * 0.72);
  const date = formatCompactDate(quote.createdAt);

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 20px",
        borderRadius: 16,
        backgroundColor: bg,
        border,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        {quote.author.avatarUrl ? (
          <Img
            src={quote.author.avatarUrl}
            onError={() => {
              /* swallow — missing avatar doesn't fail the render */
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: avatarFallback,
              flexShrink: 0,
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            fontSize: 16,
            lineHeight: 1.2,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: ink, fontWeight: 700 }}>
            {quote.author.name}
          </span>
          {showVerifiedBadge && quote.author.verified ? (
            <VerifiedBadge size={16} />
          ) : null}
          <span style={{ color: muted, marginLeft: 6 }}>
            @{quote.author.handle}
          </span>
          {date ? (
            <span style={{ color: muted, marginLeft: 6 }}>· {date}</span>
          ) : null}
        </div>
      </div>

      {quote.text ? (
        <div style={{ marginTop: 10 }}>
          <TweetText text={quote.text} fontSize={textSize} color={ink} />
        </div>
      ) : null}

      {quote.media.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <TweetMediaGrid media={quote.media} forRender={forRender} />
        </div>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. The component isn't imported anywhere yet, but it must type-check on its own.

- [ ] **Step 3: Commit**

```bash
git add remotion/tweet/QuotedTweetCard.tsx
git commit -m "Add QuotedTweetCard component"
```

---

## Task 5: Integrate `QuotedTweetCard` into `TweetCard`

**Files:**
- Modify: `remotion/tweet/TweetCard.tsx`

- [ ] **Step 1: Import `QuotedTweetCard`**

Open `remotion/tweet/TweetCard.tsx`. Add the import next to the existing sibling imports (near line 3-4):

```tsx
import { QuotedTweetCard } from "./QuotedTweetCard";
```

- [ ] **Step 2: Insert the render slot between media and timestamp**

Currently the render tree goes:

```tsx
{inCardMedia && tweet.media.length > 0 ? (
  <div style={{ marginTop: 20 }}>
    <TweetMediaGrid media={tweet.media} forRender={forRender} />
  </div>
) : null}

{showTimestamp ? ( ... ) : null}
```

Insert the quoted card between them so the tree becomes:

```tsx
{inCardMedia && tweet.media.length > 0 ? (
  <div style={{ marginTop: 20 }}>
    <TweetMediaGrid media={tweet.media} forRender={forRender} />
  </div>
) : null}

{tweet.quoted ? (
  <QuotedTweetCard
    quote={tweet.quoted}
    theme={theme}
    outerTextSize={textSize}
    showVerifiedBadge={showVerifiedBadge}
    forRender={forRender}
  />
) : null}

{showTimestamp ? ( ... ) : null}
```

- [ ] **Step 3: Add `tweet.quoted?.id` to the auto-scale effect dependency array**

The existing `useEffect` (around lines 113-130) currently ends with:

```tsx
  }, [handle, tweet.text, tweet.media.length]);
```

Change to:

```tsx
  }, [handle, tweet.text, tweet.media.length, tweet.quoted?.id]);
```

This makes the re-measure fire when a quote appears, disappears, or changes.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add remotion/tweet/TweetCard.tsx
git commit -m "Render QuotedTweetCard between media and timestamp"
```

---

## Task 6: Manual smoke test in the studio

**Files:**
- None (verification only; commit any tweaks discovered)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`. Wait for `Ready in Xs`. Open http://localhost:3000/tweet-video.

- [ ] **Step 2: Test a quote of a text-only tweet**

Paste a known quote-tweet URL where the referenced tweet is text-only (e.g. any quote of a plain text tweet from X). Verify:
- Nested card appears between the outer text and the timestamp
- Nested card has visibly lower opacity than the outer card (recessed look)
- Quote author row is a single line: avatar + bold name + `@handle` + date
- Quote text renders at ~72% the size of the outer text
- No media grid appears in the quote

- [ ] **Step 3: Test a quote of a tweet with photos**

Paste a quote-tweet URL where the referenced tweet has photos. Verify:
- Quote photos render below the quote text
- Grid layout matches the number of photos (1, 2, 3, or 4)
- No missing-asset errors in the console

- [ ] **Step 4: Test a quote of a tweet with a video/gif**

Paste a quote-tweet URL where the referenced tweet contains a video or GIF. Verify:
- Quote video plays silently (muted) alongside any outer video
- No console errors

- [ ] **Step 5: Regression check — a regular (non-quote) tweet**

Paste any regular non-quote-tweet URL. Verify no nested card appears and the outer card renders exactly as before. Compare against `git stash`'d main behavior if in doubt.

- [ ] **Step 6: Auto-scale check**

With a quote-tweet URL whose combined text is long (outer + quote together should be tall), verify:
- The whole card visibly shrinks to fit within the composition
- Nothing overflows off the frame

- [ ] **Step 7: Theme and slider checks**

- Toggle theme between light and dark. Confirm nested card contrast remains readable in both.
- Move the Card size slider (60-140%). Confirm the nested card scales in lockstep with the outer card.
- Move the Font scale slider. Confirm the quoted text scales in lockstep with the outer text.

- [ ] **Step 8: MP4 export smoke**

With any quote-tweet loaded, click Export. Confirm the MP4 completes without errors and the exported file shows the nested card and its media correctly.

- [ ] **Step 9: If any polish tweaks were needed during smoke, commit them**

If nothing needed fixing, skip this step. Otherwise:

```bash
git add remotion/tweet/QuotedTweetCard.tsx remotion/tweet/TweetCard.tsx
git commit -m "Polish quoted tweet rendering after smoke test"
```

---

## Post-Implementation Review

After Task 6 passes, the feature is ready to ship. To land it:

- [ ] **Step 1: Push the branch**

```bash
git push
```

- [ ] **Step 2: Open a PR against main and merge when green**

Use `gh pr create` and `gh pr merge --squash` following the same flow as the previous tweet-video-engine PR. Verify the production deploy on `zinolt.com/tweet-video` renders a quote-tweet URL correctly.
