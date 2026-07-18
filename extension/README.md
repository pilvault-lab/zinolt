# Send to Zinolt — Chrome extension

Manifest V3 extension that injects a **→ Z** button into every tweet on
x.com. Clicking it upserts the tweet into the `tweet_queue` Supabase
table used by the Zinolt sourcing dashboard.

Scope of this milestone (PRD Build Order §2): manual capture only. Passive
auto-capture, thresholds, and stats live in §4.

## Load unpacked

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select this `extension/` folder
4. Pin the extension icon so the popup is one click away
5. Open the popup, paste the shared secret you used in the `tweet_queue`
   RLS policy, pick a default page target, and hit **Save**
6. Open or reload `x.com` — every tweet's action row should now carry a
   **→ Z** pill next to Bookmark / Share

## What the button does

- Reads the tweet's ID, URL, author handle, likes, views, media presence,
  and the first 120 chars of body text straight from the article DOM
- POSTs an upsert to
  `<supabaseUrl>/rest/v1/tweet_queue?on_conflict=tweet_id` with header
  `x-zinolt-secret` and `source: 'extension_manual'`
- Flips to **✓** on success, **!** on error (with the failure message in
  the tooltip). Click again to retry.

## When something breaks

- Buttons don't appear: X changed markup. Update the selectors in
  `src/selectors.js` — that's the only file DOM-coupled to X.
- All buttons flash **!** immediately: shared secret missing or wrong.
  Fix it in the popup.
- Row shows up in Supabase but likes/views are 0/null: X hid the count
  behind a data-heavy label. Best-effort — okay to ignore for now.

## Files

```
extension/
  manifest.json         MV3 manifest, host_permissions, content-script wiring
  popup.html/css/js     Config UI: shared secret + default page target
  src/
    config.js           Supabase URL + anon key (public by design)
    selectors.js        ALL x.com DOM selectors, one file
    content.js          MutationObserver, extraction, upsert, button states
    content.css         Button styles
```

## Constraints (from PRD §6)

- Fail silent — if a selector breaks, buttons just don't render; never
  block x.com or throw into the page context
- DOM-read only — no X API calls, no auth-token reuse
- Content lookup is the engine's job — the extension only writes URLs +
  light ranking metadata
