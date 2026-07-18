(async function () {
  const form = document.getElementById("cfg");
  const secretEl = document.getElementById("sharedSecret");
  const pageTargetEl = document.getElementById("pageTarget");
  const statusEl = document.getElementById("status");

  const stored = await chrome.storage.local.get(["sharedSecret", "pageTarget"]);
  if (stored.sharedSecret) secretEl.value = stored.sharedSecret;
  if (stored.pageTarget) pageTargetEl.value = stored.pageTarget;

  function say(kind, msg) {
    statusEl.dataset.kind = kind;
    statusEl.textContent = msg;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sharedSecret = secretEl.value.trim();
    const pageTarget = pageTargetEl.value || null;
    if (!sharedSecret) {
      say("err", "Shared secret is required.");
      return;
    }
    try {
      await chrome.storage.local.set({ sharedSecret, pageTarget });
      say("ok", "Saved. Reload x.com to pick up changes.");
    } catch (err) {
      say("err", (err && err.message) || "Save failed.");
    }
  });
})();
