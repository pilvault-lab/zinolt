/**
 * Pipes a rendered MP4 blob through the server-side ffmpeg metadata stripper.
 * Removes encoder, software, and timestamp headers from the container so the
 * file carries no tool-origin signals. Falls back to the original blob if the
 * request fails.
 */
export async function stripVideoMetadata(blob: Blob): Promise<Blob> {
  try {
    const res = await fetch("/api/strip-metadata", {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: blob,
    });
    if (res.ok) return await res.blob();
  } catch {
    // network error — return original
  }
  return blob;
}
