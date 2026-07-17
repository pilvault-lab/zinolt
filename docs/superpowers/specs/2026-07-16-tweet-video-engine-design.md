# Tweet-to-Video Engine — Design Spec

**Date:** 2026-07-16
**Module:** `/tweet-video`
**Status:** Approved, ready for implementation plan

---

## Overview

A browser-based tool inside Zinolt that converts any X/Twitter post URL into a rendered MP4 (9:16 / 1:1 / 16:9). Renders text, photo, video, and GIF tweets under configurable card themes, backgrounds, and per-page brand identities. Reuses Zinolt's existing Remotion + `@remotion/web-renderer` pipeline, service-worker-backed local video, and shadcn/BRAND design tokens.

**v1 scope:** single-tweet URL → MP4 with full feature set (profiles, both layouts, all aspects, backgrounds, audio).
**Deferred to v1.1:** batch mode, background music for text-only renders, thread support.

---

## Locked Decisions

1. **Homepage template card** — `/tweet-video` appears in the main `TEMPLATES` grid alongside Letterbox/Wall/Frosted/Dangle.
2. **Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`** — no self-hosted font. Segoe UI on Windows render machine.
3. **Stubbed page profiles** — two placeholder entries (`general`, `fintech`) in `lib/page-profiles.ts`; user swaps names/handles/avatars later.
4. **Batch mode deferred** to v1.1.
5. **Twemoji for emojis** — self-hosted SVGs in `/public/twemoji/`, rendered inline as `<Img>` sized to `1em`.
6. **Always proxy media** through `/api/tweet/media` — no direct twimg.com fetches from the client.
7. **Reuse `lib/local-video.ts` service worker** for video tweets — same `/__local-video/<id>` scheme LetterboxReel uses.
8. **Stats hidden by default** in profiles.

---

## Architecture & File Layout

```
app/
  page.tsx                          # add tweet-video card to grid (edit)
  tweet-video/
    page.tsx                        # suspense wrapper
    _components/
      TweetVideoStudio.tsx          # three-pane editor
  api/
    tweet/
      route.ts                      # GET ?url=... → normalized FetchedTweet JSON
      media/
        route.ts                    # GET ?url=... → streamed CDN passthrough

lib/
  templates.ts                      # add tweet-video entry (edit)
  tweet-fetch.ts                    # fetch + normalize + fxtwitter/syndication fallback
  page-profiles.ts                  # PageProfile type + stubbed entries
  twemoji.ts                        # text → segment array util

remotion/
  Root.tsx                          # register 6 new compositions (edit)
  tweet/
    types.ts
    TweetCard.tsx
    TweetText.tsx
    TweetMediaGrid.tsx
    InCardComposition.tsx
    StackedComposition.tsx

public/
  twemoji/                          # 72x72 SVGs per emoji codepoint
  pages/
    general/avatar.jpg              # stub
    fintech/avatar.jpg              # stub
  tweet-video/
    preview.png                     # homepage card thumbnail
```

---

## 1. Fetch Layer

### `app/api/tweet/route.ts` — tweet JSON proxy

- `GET /api/tweet?url=<tweet_url_or_id>&force=<'syndication'|undefined>`.
- Extract ID: `/(?:status\/)?(\d{15,20})/`.
- Try fxtwitter first (`https://api.fxtwitter.com/status/{id}`); on non-2xx or JSON error, fall back to syndication (`https://cdn.syndication.twimg.com/tweet-result?id={id}&token=x`). `force=syndication` skips fxtwitter.
- Cache: `Cache-Control: public, s-maxage=600`.
- Errors: `{ error: 'invalid_url' | 'not_found' | 'protected' | 'both_sources_failed' }` with 4xx status.
- Returns `FetchedTweet` JSON. All media URLs rewritten to `/api/tweet/media?url=<encoded>` before returning.

### `app/api/tweet/media/route.ts` — CDN passthrough

- `GET /api/tweet/media?url=<encoded_cdn_url>`.
- Whitelist host: `pbs.twimg.com`, `video.twimg.com`, `abs.twimg.com`. Reject others with 400.
- Stream response; pass `Range` header both ways; mirror status, `content-type`, `content-length`, `accept-ranges`.
- `Cache-Control: public, s-maxage=86400`.

### `lib/tweet-fetch.ts` — client wrapper + types

```ts
export interface FetchedTweet {
  id: string;
  text: string;              // \n preserved, t.co self-links stripped, entities decoded
  author: { name: string; handle: string; avatarUrl: string; verified: boolean };
  createdAt: string;
  stats: { likes: number; retweets: number; replies: number; views?: number };
  media: TweetMedia[];
}
export interface TweetMedia {
  type: 'photo' | 'video' | 'gif';
  url: string;               // /api/tweet/media?url=...
  width: number;
  height: number;
  durationMs?: number;
  thumbnailUrl?: string;
}
export async function fetchTweet(input: string, force?: 'syndication'): Promise<FetchedTweet>;
```

**Normalizer rules (both sources):**
- Strip HTML anchors from syndication.
- Preserve `\n` exactly.
- Decode entities via a small hand-rolled table (no `dompurify`).
- Drop trailing t.co link if it points at tweet's own media.
- Videos: sort variants by bitrate desc, pick top. GIFs from fxtwitter arrive as MP4 → tag `'gif'`.
- All media URLs rewritten to `/api/tweet/media?...` (author avatar too).

---

## 2. TweetCard Component

### `remotion/tweet/TweetCard.tsx`

```ts
interface TweetCardProps {
  tweet: FetchedTweet;                     // text + media only; author ignored
  identity: {                              // from active PageProfile
    name: string; handle: string; avatarUrl: string; verified: boolean;
  };
  theme: 'light' | 'dark';                 // #FFFFFF / #15202B
  showStats: boolean;
  showTimestamp: boolean;
  showVerifiedBadge: boolean;
  inCardMedia: boolean;                    // false in Stacked
  maxWidthPx: number;
  cornerRadius: number;                    // default 16
  fontScale?: number;                      // 0.7-1.4 manual override
}
```

**Layout (top-down):**
1. Header row: 48px circular avatar → name (bold 20px base) + verified badge inline → `@handle` muted 16px on next line.
2. Tweet text (`<TweetText>`) — line-height 1.35, preserves `\n`.
3. Media block (only if `inCardMedia && media.length > 0`) — rounded 12px, 2px gaps.
4. Timestamp row (optional): `9:47 PM · Jul 12, 2026`.
5. Stats row (optional): reply/retweet/like icons + counts. Views suppressed by default.

Card shadow: `0 8px 40px rgba(0,0,0,0.25)`.

**Auto-sizing text — char-count buckets:**

| chars | base fontSize |
|-------|---------------|
| ≤ 60 | 64px |
| ≤ 120 | 52px |
| ≤ 200 | 40px |
| ≤ 280 | 32px |
| > 280 | 28px |

Final size = `bucket × (fontScale ?? 1)`.

**Overflow safety:** after DOM measurement (via `useEffect` + `getBoundingClientRect` + `delayRender`), if card height > 70% of composition height, scale entire card down by `min(1, (0.7 * compHeight) / actualHeight)`.

**Font stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

**Verified badge:** inline SVG (X's actual glyph), blue in both themes. `verified: boolean` only — no gold/gray tiers.

### `remotion/tweet/TweetText.tsx`

Runs raw text through `lib/twemoji.ts` → array of `{ type: 'text' | 'emoji', value: string }` segments. Renders text spans and `<Img src="/twemoji/{codepoint}.svg" style={{ height: '1em', verticalAlign: '-0.15em' }} />` inline. Newlines → `<br />`.

### `lib/twemoji.ts`

Small util — scan string for emoji codepoints (surrogate-pair-aware), split into text and emoji segments. Codepoint → SVG filename mapping matches Twemoji's naming (`1f600.svg`). Assets bundled into `/public/twemoji/`.

---

## 3. Media Rendering

### `remotion/tweet/TweetMediaGrid.tsx` — photo grids

| Count | Layout |
|-------|--------|
| 1 | Full width, natural aspect, soft-cap ~500 card-units tall |
| 2 | Side-by-side, 1:1 crop each |
| 3 | Left = tall 2:3, right = two stacked squares |
| 4 | 2×2, 1:1 crops |

12px rounded corners, 2px gaps, `object-fit: cover` for cropped slots. Uses Remotion `<Img>` (triggers `delayRender` for decode). Photo URLs already proxied.

### In-card video/GIF

- `<OffthreadVideo>` in preview, `<Video>` from `@remotion/media` in render (via `forRender` prop switch).
- Source: local-video SW URL after client downloads through `/api/tweet/media` and hands blob to `storeLocalVideo()`.
- Muted per audio toggle.
- GIF loops for composition duration.

### Loading + errors

Failed photo/video → dark placeholder rectangle in slot. Composition still renders.

---

## 4. Compositions

### `InCardComposition.tsx` — text and photo tweets

- Card centered over background.
- Duration: 4–15s slider, default 7s (text/photo). Video in-card → `videoDurationMs + 1000`.
- Entrance: opacity 0→1 + `translateY(20 → 0)` over frames 0–12, `easeOutCubic`.
- Card `maxWidthPx`: 900 (9:16), 900 (1:1), 720 (16:9).
- Card `centerY` prop (0.35–0.65) for vertical fine-tune.

**BackgroundConfig:**

```ts
type BackgroundConfig =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; angle: number; from: string; to: string }
  | { kind: 'loop'; src: string }
  | { kind: 'upload'; src: string };
```

`LOOP_LIBRARY` = existing Zinolt loops (`/rays/light-ray-white.mp4`, `/rays/ferrofluid-white.mp4`, `/rays/light-pillar-white-v3.mp4`, plus 1-2 curated additions). Upload accepts image/* + video/* (video via local-video SW).

### `StackedComposition.tsx` — video/GIF tweets (Myles mode)

Three z-layers:

1. **Blurred BG video** — tweet's video, `object-fit: cover` full-frame, `filter: blur(40px) brightness(0.6)`. Muted always. Fallback: solid/gradient from config if user forces it.
2. **Main video** — `object-fit: contain` in centered zone. Zone: 92% width × 55% height at 9:16.
3. **Compact TweetCard** — `inCardMedia: false`, `maxWidthPx: 780` at 9:16, positioned in top ~18% zone, centered.

Duration: video duration. GIF: loop 2× if < 6s else 1×, hard cap 12s.

### Aspect ratios → compositions

| Aspect | W × H | Comp IDs |
|--------|-------|----------|
| 9:16 | 1080 × 1920 | `TweetInCard9x16`, `TweetStacked9x16` |
| 1:1 | 1080 × 1080 | `TweetInCard1x1`, `TweetStacked1x1` |
| 16:9 | 1920 × 1080 | `TweetInCard16x9`, `TweetStacked16x9` |

Six comps in `remotion/Root.tsx`. Same two components, different width/height/defaultProps wrappers.

### Auto-layout selection

`tweet.media.some(m => m.type === 'video' || m.type === 'gif')` → default Stacked, else InCard. User-overridable.

---

## 5. Page Profiles

### `lib/page-profiles.ts`

```ts
export interface PageProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  verified: boolean;
  defaultTheme: 'light' | 'dark';
  defaultBackground: BackgroundConfig;
  defaultAspect: '9:16' | '1:1' | '16:9';
  defaultShowStats: boolean;
  defaultShowTimestamp: boolean;
  defaultShowVerifiedBadge: boolean;
}

export const PAGE_PROFILES: readonly PageProfile[] = [
  { id: 'general', displayName: 'General Page', handle: 'general_page',
    avatarUrl: '/pages/general/avatar.jpg', verified: false,
    defaultTheme: 'dark',
    defaultBackground: { kind: 'gradient', angle: 135, from: '#0f172a', to: '#1e293b' },
    defaultAspect: '9:16', defaultShowStats: false,
    defaultShowTimestamp: true, defaultShowVerifiedBadge: false },
  { id: 'fintech', displayName: 'Fintech Page', handle: 'fintech_page',
    avatarUrl: '/pages/fintech/avatar.jpg', verified: true,
    defaultTheme: 'light',
    defaultBackground: { kind: 'solid', color: '#f8fafc' },
    defaultAspect: '9:16', defaultShowStats: false,
    defaultShowTimestamp: true, defaultShowVerifiedBadge: true },
] as const;

export const DEFAULT_PROFILE_ID = 'general';
export const getProfile = (id: string): PageProfile => ...;
```

Stub avatars: 400×400 placeholder JPGs in `/public/pages/{id}/avatar.jpg`.

**Profile switch behavior:** identity swaps immediately. Defaults (theme/background/aspect/toggles) reset **only if user hasn't touched them this session** — dirty-flag tracking per control.

---

## 6. Editor UI

### Top bar

- URL input + Fetch button (Enter submits)
- Profile `<Select>`
- Aspect `<Select>`: 9:16 / 1:1 / 16:9
- "Change style" → `/` (right)

### Left panel (~320px, scrollable)

1. Layout toggle: In-Card / Stacked
2. Card theme toggle: Light / Dark
3. Background editor: kind `<Select>` + type-specific controls
4. Toggles: Show stats, Show timestamp, Show verified badge, Mute video audio (only when video present)
5. Font scale slider (0.7–1.4)
6. Duration slider (4–15s, InCard non-video only)

Any manual change flips a dirty flag → profile switches respect it.

### Center — `<Player>`

- ~380px wide at aspect
- `compositionMeta` picks composition based on aspect + layout
- Empty: "Paste a tweet URL to start"
- Fetching: skeleton in preview area
- Fetch error: red text under URL input + "Try syndication fallback" button

### Right panel (~260px)

- Compose button → progress → auto-download
- Filename: `${profile.id}_${slug(tweet.text, 40)}_${aspect}.mp4`
- `canRenderMediaOnWeb` probe → disable button + "Chrome or Edge on desktop" note on failure
- Render config: `videoBitrate: 16_000_000` (Stacked/video) or `12_000_000` (InCard text/photo). Audio: `high` bitrate when unmuted with video, else `muted: true`.

### Fetch flow

1. User pastes URL → Fetch.
2. Client `GET /api/tweet?url=...`.
3. On success, parallel-download every `media[].url` (photos → blob URLs, videos → `storeLocalVideo()`).
4. Once first-frame renderable → Player mounts with `inputProps`.

---

## 7. Audio

- Preview `<OffthreadVideo>` and export `<Video>` both take `muted={muteToggle}` on the main video.
- Blurred BG video always muted.
- Export unmuted: `audioBitrate: 'high'`. Muted: `muted: true`.
- Toggle only visible when tweet has a `'video'` media item. Default **unmuted**.
- GIF = silent MP4, toggle hidden.
- Text/photo = silent output. Background music deferred to v1.1.

---

## Build Order

1. **Fetch layer** — `/api/tweet`, `/api/tweet/media`, `lib/tweet-fetch.ts`, tests via URL cases.
2. **Twemoji + TweetText** — asset bundling script, split util, inline `<Img>` rendering.
3. **TweetCard** with theme + auto-sizing + verified badge (no media yet).
4. **InCardComposition** + solid/gradient backgrounds + registration in `Root.tsx`. **← first end-to-end: URL → MP4.**
5. **TweetMediaGrid** + in-card photos.
6. **Video/GIF via local-video SW** + in-card video path.
7. **StackedComposition** with blurred-video BG + audio passthrough. **← primary meme format live.**
8. **Loop-library + upload backgrounds** + aspect ratio variants (6 comps registered).
9. **Page profiles** + editor top bar profile selector + dirty-flag reset behavior.
10. **Editor polish** — error states, filename slugs, duration control, all the loading states.

Each step ships independently.

---

## Test Tweets (dev coverage)

Cover during dev: short text banger, ~280-char wall, "No one: / X:" multi-line, single photo, 4-photo grid, native video (landscape), native video (vertical), GIF reply, emoji-heavy text, verified vs non-verified author.

---

## Notes

- **Framework caveat:** Next.js in this repo is a modified fork (`@AGENTS.md` — "This is NOT the Next.js you know"). Read `node_modules/next/dist/docs/` for the current App Router / Route Handler API before writing route handlers.
- **Auth / accounts:** none. Internal tool.
- **Watermark:** not required in v1 (PRD lists it in step 7 alongside profiles but doesn't specify a watermark spec; we ship without unless asked).
