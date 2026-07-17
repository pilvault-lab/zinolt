# Quoted Tweet Support — Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** Render the quoted tweet inside the main tweet card in the `/tweet-video` InCard layout.

## Problem

Today, `FetchedTweet` carries only a single tweet's data. When a user pastes a tweet URL that is itself quoting another tweet, the studio renders only the outer author's text; the referenced tweet is invisible. Both source APIs already return the quoted content, but the fetch adapters drop it.

## Goals

- The studio renders both the outer tweet and the quoted tweet when applicable.
- Nested rendering matches the frosted-glass aesthetic of `TweetCard` — visibly recessed but coherent with the outer card.
- Zero regression for non-quote tweets.

## Non-goals

- Rendering quotes in the Stacked layout. Stacked is video-first; it silently ignores `tweet.quoted`.
- Rendering nested quotes (a quote of a quote). Depth is capped at one level by the type.
- Any new UI controls in the studio. The quote renders automatically when present.

## Data model

Extend `lib/tweet-fetch.ts`:

```ts
export interface FetchedTweet {
  id: string;
  text: string;
  author: { name: string; handle: string; avatarUrl: string; verified: boolean };
  createdAt: string;
  stats: { likes: number; retweets: number; replies: number; views?: number };
  media: TweetMedia[];
  quoted?: QuotedTweet;    // new
}

export interface QuotedTweet {
  id: string;
  text: string;
  author: { name: string; handle: string; avatarUrl: string; verified: boolean };
  createdAt: string;
  media: TweetMedia[];
}
```

`QuotedTweet` is a subset of `FetchedTweet`: no `stats`, no nested `quoted`. If a tweet is not a quote-tweet, `quoted` stays undefined.

## Fetch adapters

Both adapters in `app/api/tweet/route.ts` need to map a quote when present.

**fxtwitter:** `json.tweet.quote` is returned in the same shape as `json.tweet`. Extract a shared helper `mapFxTweetLike(t)` that produces the fields common to `FetchedTweet` and `QuotedTweet` — text decoding, media proxying, author, createdAt. Use it for both the outer tweet and (if `t.quote` exists) the quote.

**syndication:** `json.quoted_tweet` is a subset of `SynTweetJson` shape — same field names, no `favorite_count`/`conversation_count` needed. Extract `mapSynQuotedTweet(qt)` that produces a `QuotedTweet`. Media comes from `quoted_tweet.mediaDetails` and goes through the same `proxyMediaUrl` pipeline.

Fetch route caching (`s-maxage=600`) is unchanged. The quote arrives in the same response payload as the parent — no second HTTP call.

## Component: QuotedTweetCard

New file `remotion/tweet/QuotedTweetCard.tsx`.

```ts
interface QuotedTweetCardProps {
  quote: QuotedTweet;
  theme: CardTheme;
  outerTextSize: number;
  showVerifiedBadge: boolean;
  forRender: boolean;
}
```

**Container:**

- `borderRadius: 16`, `padding: "16px 20px"`, `marginTop: 20`
- Background: `theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.4)"` — roughly half the outer card's opacity so it reads as recessed
- Border: `theme === "dark" ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,20,25,0.06)"` — thinner and lower-contrast than outer
- No `backdropFilter` — the outer card already blurs the underlying background; a second blur produces artifacts
- No box shadow

**Header (compact one-liner):**

- Avatar 28px (vs 56px outer), then inline text on one row:
  - `**Name**` (bold, `ink`)
  - Verified badge at 16px (if `showVerifiedBadge && author.verified`)
  - ` @handle` in `muted`
  - ` · ` separator in `muted`
  - Short relative-ish date in `muted` — reuse formatting logic but compact: month + day only, add year only if different from current year
- `whiteSpace: nowrap`, ellipsis on overflow
- Missing avatar falls back to a 28px filled circle in the muted-background color, matching the outer card's fallback pattern

**Text:**

- Reuse `<TweetText>` with `fontSize = Math.round(outerTextSize * 0.72)`
- Same `ink` color as outer
- Composes with the outer `fontScale` — user's font-scale slider affects both; quote stays at 72% of outer at all scales

**Media:**

- Reuse `<TweetMediaGrid>` unchanged
- Wrapper `marginTop: 12`
- The grid's existing `maxHeight: 500` cap prevents runaway heights inside a nested card

**Intentionally omitted:** stats, full timestamp block, its own `fontScale` prop. The nested card trims chrome so it reads as secondary content.

## Integration into TweetCard

In `remotion/tweet/TweetCard.tsx`, insert the quoted-card render slot after the main media grid (currently lines 213-217) and before the timestamp (currently line 219):

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

This matches X's own visual order: main text → main media → quoted card → timestamp → stats.

**Auto-scale dependency.** TweetCard's `useEffect` at line 113-130 measures its own height against the parent and shrinks uniformly if it exceeds 70%. The dependency array must include `tweet.quoted?.id` so the measurement re-runs when a quote appears, disappears, or changes. One-line diff.

**Font-scale composition.** Outer computes `textSize = round(baseSize × fontScale)`. Nested computes its own text size as `round(outerTextSize × 0.72)`. Result: quote size tracks the slider without a separate control.

**Card-size slider.** Already applied at the composition layer via `cardScale` transform in `InCardComposition.tsx:161`. The whole card — including the nested quote — scales uniformly. No change needed.

**Stacked layout.** No integration. If a Stacked tweet has `tweet.quoted`, it is silently ignored — no fallback, no warning.

## Edge cases

| Case | Behavior |
|------|----------|
| Non-quote tweet (`quoted` undefined) | Whole block renders `null`. Zero impact. |
| Quote with text only | Renders header + text, no media grid. |
| Quote with media only (no text) | `<TweetText text="" />` renders nothing; media grid renders alone below the header. |
| Quote with video/gif | Reuses `TweetMediaGrid` video path; muted, plays alongside outer video. |
| Protected or deleted quoted tweet | Upstream APIs omit the field; nothing renders. |
| Nested quote (quote of a quote) | Type has no `quoted` field. Capped at one level even if API surfaces one. |
| Long quote pushing card off-screen | Existing auto-scale shrinks the whole card to 70% of parent height once the effect dep triggers a re-measure. |
| Missing quote avatar | Same filled-circle fallback + swallowed `onError` as the outer header. |
| Missing quote media asset | Existing `onError` swallow in `TweetMediaGrid` renders an empty box; render does not fail. |

## Files touched

- `lib/tweet-fetch.ts` — add `QuotedTweet` type + `quoted?` field on `FetchedTweet`
- `app/api/tweet/route.ts` — extract shared mapping helpers, map `quote` (fx) and `quoted_tweet` (syndication) into `QuotedTweet`
- `remotion/tweet/QuotedTweetCard.tsx` — new component
- `remotion/tweet/TweetCard.tsx` — insert render slot and add `tweet.quoted?.id` to the auto-scale effect dependency array

## Test plan

Manual smoke in the `/tweet-video` studio on four tweet URLs:

1. A tweet quoting a text-only tweet
2. A tweet quoting a tweet with photos
3. A tweet quoting a tweet with a video
4. A regular non-quote tweet (regression check — nothing visual changes)

Additional checks:

- Auto-scale triggers on a long quote (card visibly shrinks; nothing overflows off the composition)
- MP4 export succeeds on cases 1-3; quote media appears in the output
- Toggle theme light/dark — nested card contrast holds against outer card
- Card-size and font-scale sliders scale the quote in step with the outer card

No unit tests. This codebase has no test infrastructure; every other `remotion/tweet/` component is verified live in the studio.
