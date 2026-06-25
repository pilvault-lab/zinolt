// Client-side helpers for the local-video service worker (public/sw.js).
// Stores uploaded clip File blobs in the SW so they can be range-fetched
// via a normal HTTP URL by both the Player and renderMediaOnWeb's worker.

export const LOCAL_VIDEO_PREFIX = "/__local-video/";

let registration: Promise<ServiceWorkerRegistration> | null = null;

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  if (!registration) {
    registration = navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }
  await registration;
  await navigator.serviceWorker.ready;
  return registration;
}

async function activeWorker(): Promise<ServiceWorker> {
  const reg = await ensureRegistration();
  const sw = navigator.serviceWorker.controller ?? reg.active;
  if (sw) return sw;
  // Wait once for the SW to take control after first install.
  return new Promise((resolve) => {
    const listener = () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          listener,
        );
        resolve(navigator.serviceWorker.controller);
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", listener);
  });
}

function ask<T>(
  sw: ServiceWorker,
  message: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      reject(new Error("Service worker did not respond in time."));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data as T);
    };
    sw.postMessage(message, [channel.port2]);
  });
}

/** Kick off SW registration eagerly so the first upload doesn't pay the cost. */
export function prepareLocalVideoSW(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  void ensureRegistration().catch(() => {
    /* Swallow — surfaced again on first storeLocalVideo call. */
  });
}

export async function storeLocalVideo(file: File): Promise<string> {
  const sw = await activeWorker();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await ask<{ ok: boolean }>(sw, { type: "set-clip", id, blob: file });
  return `${LOCAL_VIDEO_PREFIX}${id}`;
}

export async function deleteLocalVideo(url: string): Promise<void> {
  if (!url.startsWith(LOCAL_VIDEO_PREFIX)) return;
  const id = decodeURIComponent(url.slice(LOCAL_VIDEO_PREFIX.length));
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker.controller;
  if (!sw) return;
  try {
    await ask<{ ok: boolean }>(sw, { type: "delete-clip", id });
  } catch {
    // Best-effort cleanup; ignore failures.
  }
}
