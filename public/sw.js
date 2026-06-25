// Zinolt local-video service worker.
// Serves uploaded clip blobs at /__local-video/<id> with proper Range support
// so @remotion/web-renderer's worker can stream them at near-native speed,
// instead of decoding a data URL or failing on blob: URLs it cannot fetch.

const PREFIX = "/__local-video/";
const files = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const reply = (payload) => {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
  };
  if (data.type === "set-clip" && data.id && data.blob) {
    files.set(data.id, data.blob);
    reply({ ok: true });
  } else if (data.type === "delete-clip" && data.id) {
    files.delete(data.id);
    reply({ ok: true });
  } else if (data.type === "ping") {
    reply({ ok: true });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(PREFIX)) return;

  event.respondWith(
    (async () => {
      const id = decodeURIComponent(url.pathname.slice(PREFIX.length));
      const blob = files.get(id);
      if (!blob) return new Response("Not found", { status: 404 });

      const type = blob.type || "video/mp4";
      const total = blob.size;
      const range = event.request.headers.get("range");

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = Math.min(parseInt(match[1], 10), total - 1);
          const end = match[2]
            ? Math.min(parseInt(match[2], 10), total - 1)
            : total - 1;
          if (start > end) {
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${total}` },
            });
          }
          const slice = blob.slice(start, end + 1, type);
          return new Response(slice, {
            status: 206,
            statusText: "Partial Content",
            headers: {
              "Content-Type": type,
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Content-Length": String(end - start + 1),
              "Accept-Ranges": "bytes",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      return new Response(blob, {
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Length": String(total),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    })(),
  );
});
