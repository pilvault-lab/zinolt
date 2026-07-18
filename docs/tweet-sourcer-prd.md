# PRD — Tweet Sourcer (Zinolt Sourcing Pipeline, Phase 1)

## Overview

A sourcing layer that feeds the finished tweet-to-video engine. Two components in this phase:

1. **Chrome extension ("Send to Zinolt")** — captures tweets from the user's own real X browsing session, manually via an injected button and optionally via a passive auto-collector.
2. **Queue + dashboard** — a pending-queue table (Supabase) and an approval view inside the Zinolt app. Approving a tweet hands its URL to the existing tweet-to-video editor; the engine does all fetching and rendering.

**Phase 2 (explicitly out of scope now):** Playwright background scraper on a burner account that writes into the same queue. The schema below is designed so the scraper can be added without migration.

**Core principle:** the queue stores tweet **URLs + light ranking metadata only**. No tweet text payloads, no media downloads, no rendering logic in this layer. The engine's fxtwitter fetch layer remains the single source of truth for content, invoked at render time.

---

## Architecture

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  Chrome Extension (x.com)   │      │  [Phase 2] Playwright        │
│  manual button + passive    │      │  burner scraper (IDs only)   │
│  auto-capture               │      │                              │
└──────────────┬──────────────┘      └──────────────┬───────────────┘
               │  POST (Supabase REST, anon key      │
               │  + shared secret header)            │
               └──────────────────┬──────────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │  Supabase table: tweet_queue │
                   └──────────────┬───────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │  Zinolt /sourcing dashboard  │
                   │  rank · approve · reject     │
                   └──────────────┬───────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │  EXISTING tweet-video editor │
                   │  (fetch → style → render)    │
                   └──────────────────────────────┘
```

---

## 1. Queue Table (Supabase)

Table: `tweet_queue`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, pk, default gen | |
| `tweet_id` | text, **unique** | numeric status ID extracted from URL — dedup key |
| `tweet_url` | text | canonical `https://x.com/{handle}/status/{id}` |
| `author_handle` | text | reference/sourcing analytics only, never rendered |
| `likes` | integer | count at capture time, for ranking |
| `views` | bigint, nullable | if visible in DOM at capture |
| `has_media` | boolean | true if tweet contains photo/video/gif |
| `media_type` | text, nullable | `'video' \| 'gif' \| 'photo' \| null` (best-effort from DOM) |
| `text_preview` | text | first ~120 chars, display-only in dashboard list |
| `page_target` | text, nullable | `'general' \| 'fintech' \| null` (tag at capture or in dashboard) |
| `status` | text, default `'pending'` | `'pending' \| 'approved' \| 'rejected' \| 'rendered'` |
| `source` | text | `'extension_manual' \| 'extension_auto'` (phase 2 adds `'scraper'`) |
| `captured_at` | timestamptz, default now() | |

- Unique constraint on `tweet_id` — re-capturing the same tweet upserts (refreshes `likes`/`views`) instead of duplicating.
- Housekeeping: dashboard auto-archives `pending` rows older than 7 days (viral shelf life) — a status `'expired'` or a delete, builder's choice.
- RLS: table locked down; writes allowed only with a shared secret header validated by a Supabase Edge Function or a simple policy on a custom claim. Low-stakes internal tool — a static secret in the extension config is acceptable. Do not ship the service role key in the extension.

---

## 2. Chrome Extension — "Send to Zinolt"

Manifest V3. Content script on `x.com/*` and `twitter.com/*`. No background scraping, no headless anything — it only reads the DOM of pages the user is actually viewing, which keeps it inside normal-usage risk.

### 2a. Manual capture (core)

- Inject a small **"→ Z" button** into every tweet `article` element's action row (next to like/retweet/share). Style: minimal, monochrome, doesn't clash with X UI. Use a MutationObserver to handle X's virtualized timeline (tweets mount/unmount constantly on scroll).
- On click, extract from that article's DOM:
  - status URL (from the tweet's timestamp anchor `a[href*="/status/"]`)
  - author handle
  - like count and view count as displayed (parse "14.2K" → 14200)
  - media presence + best-effort type (video player element vs img)
  - first ~120 chars of `[data-testid="tweetText"]` for the preview
- POST to Supabase REST upsert. On success: button flips to a ✓ state for that tweet. On failure: brief red state + retry on next click.
- Works on timeline, the List view, search results, and individual tweet pages (same article structure).

### 2b. Passive auto-capture (toggle, default OFF)

- Extension popup has an on/off toggle: **"Auto-collect while browsing."**
- When on, as tweets scroll into view the content script checks them against thresholds (configurable in popup):
  - min likes (default 5,000)
  - require media (default ON)
- Any tweet crossing thresholds is silently upserted with `source: 'extension_auto'`. A tiny counter badge on the extension icon shows session captures.
- Dedup is free via the `tweet_id` unique constraint.
- Intended workflow: turn it on, scroll the 50-account List for 10 minutes, turn it off — queue fills itself while the user just reads.

### 2c. Popup config

- Auto-capture toggle + thresholds (min likes, require media)
- Default `page_target` tag for captures (`general` / `fintech` / none)
- Supabase endpoint + shared secret (stored in `chrome.storage.local`)
- Session capture counter + "open dashboard" link

---

## 3. Sourcing Dashboard (inside Zinolt app)

New route: `/sourcing`. Follows existing Zinolt UI conventions — clean, white, high-contrast, typography-first. This is an inbox, not a feed: open, process, close.

### List view
- Rows of pending tweets, default sort: **views/likes descending**, secondary sort recency.
- Each row: text preview, author handle (small, muted), likes/views, media-type icon (▶ video / gif / image / text), `page_target` tag chip (editable inline), captured-at, source badge.
- Filters: page target, media type, source, min likes. Toggle to include `approved`/`rejected` history.
- Bulk actions: select multiple → reject; select multiple → set page target.

### Row actions
- **Approve & Style** (primary): sets `status: 'approved'`, opens the existing tweet-video editor with the tweet URL prefilled and fetch auto-triggered, page profile pre-selected from `page_target`. User styles and renders in the engine as normal. On successful export, engine marks the row `'rendered'` (pass `queue_id` through to the editor for the callback).
- **Approve → Batch**: appends the URL to the engine's existing batch-mode queue instead of opening the editor (for days when defaults are fine).
- **Reject**: sets `'rejected'`, row fades out.
- Keyboard flow: j/k to move, a to approve, r to reject — the 2-minute-inbox experience.

### Housekeeping
- Banner count of pending items; auto-expiry of stale pendings per §1.
- Simple stats footer: captures this week by source, approve rate, renders completed. (Nice-to-have; don't gold-plate.)

---

## 4. Integration Contract with the Engine

- Editor accepts `?url=<tweetUrl>&profile=<pageId>&queue_id=<uuid>` query params: auto-fetch on load, profile pre-selected.
- After a successful MP4 export, if `queue_id` present, editor PATCHes the queue row to `'rendered'`.
- Batch mode accepts an array of URLs from the dashboard (same in-memory handoff or query param list — builder's choice, keep it simple).
- **No fetching of tweet content in the extension or dashboard beyond the DOM preview snippet.** All content resolution stays in the engine's fetch layer.

---

## 5. Build Order

1. `tweet_queue` table + RLS/secret write path.
2. Extension manual capture (button, extraction, upsert, ✓ state). **← first usable milestone: capture from real browsing.**
3. `/sourcing` dashboard list + approve/reject + editor handoff via query params. **← full loop closed: browse → capture → approve → render.**
4. Passive auto-capture mode + popup thresholds.
5. Batch handoff, keyboard shortcuts, bulk actions, expiry, stats footer.

Stop-and-use is possible from step 3. Step 4 is where daily sourcing time collapses.

---

## 6. Constraints & Notes

- X ships DOM changes regularly; keep all selectors (`article`, `[data-testid="tweetText"]`, status anchor, action row) in one `selectors.ts` constant file so breakage is a one-file fix.
- Extension must fail silent and safe: if selectors break, buttons just don't render — never block or error the X page itself.
- No interception of X's network traffic, no auth token reuse, no requests to X endpoints from the extension. DOM-read + external POST only.
- Phone capture (share-sheet → queue) is a future nice-to-have the Supabase-hosted queue already enables; not in this phase.

## Out of Scope (Phase 2+)

- Playwright burner-account scraper (writes `source: 'scraper'` rows into the same table).
- Auto-render-on-approve with default styling.
- Engagement-baseline-per-author ranking (median multiplier instead of raw likes).
- Cross-page analytics.
