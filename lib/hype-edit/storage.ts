import { EMPTY_PROJECT, type HypeFrame, type HypeProject } from "./types";
import { gcBlobs, getBlob } from "./blob-store";

const KEY = "hype-edit:project:v1";

/**
 * Load persisted project. Session frames (uploaded/pasted/dropped) are
 * rehydrated from IndexedDB — their blob URLs are recreated fresh, since
 * the old ones die on reload.
 */
export async function loadProject(): Promise<HypeProject | null> {
  if (typeof window === "undefined") return null;
  let parsed: HypeProject;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw) as HypeProject;
  } catch {
    return null;
  }
  const settings = { ...EMPTY_PROJECT.settings, ...(parsed.settings ?? {}) };
  const rawFrames: HypeFrame[] = Array.isArray(parsed.frames)
    ? parsed.frames.filter((f): f is HypeFrame => Boolean(f && f.kind))
    : [];

  const rehydrated: HypeFrame[] = [];
  for (const f of rawFrames) {
    if (f.session) {
      const blob = await getBlob(f.id);
      if (blob) {
        rehydrated.push({ ...f, src: URL.createObjectURL(blob) });
      }
      // else: blob missing — drop the frame
    } else {
      // Path frames + solids persist as-is.
      rehydrated.push(f);
    }
  }

  return {
    frames: rehydrated,
    audioFile: typeof parsed.audioFile === "string" ? parsed.audioFile : "",
    bpmOverride:
      typeof parsed.bpmOverride === "number" && parsed.bpmOverride > 0
        ? parsed.bpmOverride
        : undefined,
    settings,
  };
}

/**
 * Persist the project. Session frames are kept in the manifest (id/kind/etc.)
 * but their `src` (a blob URL) is stripped — it's rebuilt on load from IDB.
 */
export function saveProject(project: HypeProject) {
  if (typeof window === "undefined") return;
  try {
    const framesForSave = project.frames.map((f) =>
      f.session ? { ...f, src: undefined } : f,
    );
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...project, frames: framesForSave }),
    );
    // Garbage-collect any orphan blobs (frames that were deleted).
    const keep = new Set(
      project.frames.filter((f) => f.session).map((f) => f.id),
    );
    void gcBlobs(keep);
  } catch {
    /* quota / SecurityError — swallow */
  }
}

export function clearProject() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
