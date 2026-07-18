// Zinolt content script: injects a "→ Z" button into every tweet's action
// row and upserts the tweet into the Supabase queue on click.
//
// Design principles (see docs/tweet-sourcer-prd.md §6):
//   - Fail silent. If a selector breaks, buttons just don't render.
//     Never throw into the page and never block X's own scripts.
//   - DOM-read only. No X API calls, no auth-token reuse.
//   - One button per article, marked with data-zinolt-injected to skip re-work.

(function () {
  const CFG = window.ZINOLT_CONFIG;
  const S = window.ZINOLT_SELECTORS;
  const INJECTED_ATTR = "data-zinolt-injected";
  const BUTTON_CLASS = "zinolt-send-btn";
  const ID_RE = /\/status\/(\d{15,20})/;

  // Parse X's compacted counts: "14.2K" -> 14200, "1.3M" -> 1300000.
  function parseCount(raw) {
    if (raw == null) return 0;
    const text = String(raw).trim();
    if (!text) return 0;
    const clean = text.replace(/,/g, "").replace(/\s/g, "");
    const m = clean.match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
    if (!m) {
      const n = Number(clean);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
    const base = parseFloat(m[1]);
    const suffix = (m[2] || "").toUpperCase();
    const mult = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
    return Math.round(base * mult);
  }

  // Read the aria-label from an action button — X puts counts and full names
  // there, e.g. "12,345 Likes. Like".
  function readButtonCount(article, sel) {
    const btn = article.querySelector(sel);
    if (!btn) return 0;
    const label = btn.getAttribute("aria-label") || "";
    const num = label.match(/[\d,.]+/);
    return num ? parseCount(num[0]) : 0;
  }

  // Best-effort views count. On timeline, X puts view count as the last
  // action-row control; on individual pages the analytics anchor carries it.
  function readViews(article) {
    const analytics = article.querySelector(S.analyticsAnchor);
    if (analytics) {
      const label = analytics.getAttribute("aria-label") || analytics.textContent || "";
      const num = label.match(/[\d,.]+[KMB]?/i);
      if (num) return parseCount(num[0]);
    }
    return null;
  }

  function extract(article) {
    const timeEl = article.querySelector(S.statusTimeAnchor);
    const statusAnchor = timeEl ? timeEl.closest("a[href*='/status/']") : null;
    const href = statusAnchor ? statusAnchor.getAttribute("href") || "" : "";
    const idMatch = href.match(ID_RE);
    if (!idMatch) return null;
    const tweetId = idMatch[1];

    const userAnchor = article.querySelector(S.userNameAnchor);
    const authorHandle = userAnchor
      ? (userAnchor.getAttribute("href") || "").replace(/^\//, "").split("/")[0]
      : "";

    const tweetUrl = `https://x.com/${authorHandle || "i"}/status/${tweetId}`;

    const likes = readButtonCount(article, S.likeButton);
    const views = readViews(article);

    const hasVideo = !!article.querySelector(S.video);
    const hasPhoto = !!article.querySelector(S.photo);
    const hasGif = !!article.querySelector(S.gifAudioIndicator);
    const hasMedia = hasVideo || hasPhoto || hasGif;
    const mediaType = hasVideo ? "video" : hasGif ? "gif" : hasPhoto ? "photo" : null;

    const textEl = article.querySelector(S.tweetText);
    const rawText = textEl ? textEl.textContent || "" : "";
    const textPreview = rawText.slice(0, 120);

    return {
      tweet_id: tweetId,
      tweet_url: tweetUrl,
      author_handle: authorHandle || "unknown",
      likes,
      views,
      has_media: hasMedia,
      media_type: mediaType,
      text_preview: textPreview,
      source: "extension_manual",
    };
  }

  async function upsert(row) {
    const stored = await chrome.storage.local.get(["sharedSecret", "pageTarget"]);
    const secret = stored.sharedSecret;
    if (!secret) {
      throw new Error("Shared secret not configured — open the extension popup.");
    }
    const pageTarget = stored.pageTarget || null;

    const url = `${CFG.supabaseUrl}/rest/v1/tweet_queue?on_conflict=tweet_id`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: CFG.supabaseAnonKey,
        Authorization: `Bearer ${CFG.supabaseAnonKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
        "x-zinolt-secret": secret,
      },
      body: JSON.stringify({ ...row, page_target: pageTarget }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  function setButtonState(btn, state, message) {
    btn.classList.remove(
      `${BUTTON_CLASS}--sending`,
      `${BUTTON_CLASS}--ok`,
      `${BUTTON_CLASS}--err`,
    );
    btn.textContent = state === "ok" ? "✓" : state === "err" ? "!" : "→ Z";
    if (state === "sending") btn.classList.add(`${BUTTON_CLASS}--sending`);
    if (state === "ok") btn.classList.add(`${BUTTON_CLASS}--ok`);
    if (state === "err") btn.classList.add(`${BUTTON_CLASS}--err`);
    btn.title = message || (state === "ok" ? "Sent" : state === "err" ? "Retry" : "Send to Zinolt");
  }

  function makeButton(article) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_CLASS;
    setButtonState(btn, "idle");
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.classList.contains(`${BUTTON_CLASS}--sending`)) return;
      setButtonState(btn, "sending", "Sending…");
      try {
        const row = extract(article);
        if (!row) throw new Error("Could not read tweet ID from DOM");
        await upsert(row);
        setButtonState(btn, "ok", "Sent to Zinolt");
      } catch (err) {
        console.warn("[Zinolt]", err);
        setButtonState(btn, "err", err && err.message ? err.message : "Failed — click to retry");
      }
    });
    return btn;
  }

  function inject(article) {
    if (article.hasAttribute(INJECTED_ATTR)) return;
    const row = article.querySelector(S.actionRow);
    if (!row) return; // fail silent
    article.setAttribute(INJECTED_ATTR, "1");
    const holder = document.createElement("div");
    holder.className = `${BUTTON_CLASS}-holder`;
    holder.appendChild(makeButton(article));
    row.appendChild(holder);
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const articles = scope.querySelectorAll(S.article);
    for (const a of articles) {
      try {
        inject(a);
      } catch (err) {
        // Absolutely never let a single tweet blow up the whole scan.
        console.warn("[Zinolt] inject failed", err);
      }
    }
    // Also scan any articles outside the mutated subtree — the observer batches
    // deep subtrees but callers may pass an ancestor.
    if (root && root !== document) {
      const outside = document.querySelectorAll(
        `${S.article}:not([${INJECTED_ATTR}])`,
      );
      for (const a of outside) {
        try {
          inject(a);
        } catch (err) {
          console.warn("[Zinolt] inject failed", err);
        }
      }
    }
  }

  // Debounce the observer — X's virtualized timeline mutates constantly.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      scan(document);
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  scan(document);
})();
