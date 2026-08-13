import { access } from "node:fs/promises";
import { join } from "node:path";

/** Firefox cookies are our permanent auth strategy for yt-dlp.
 *
 *  Why: Chrome/Chromium lock their cookie DB while running, and YouTube
 *  rotates exported cookies.txt within seconds. Firefox does NOT lock its
 *  cookie DB, so `--cookies-from-browser firefox` reads live, always-fresh
 *  cookies — no exports, no rotation breakage.
 *
 *  Setup (one-time):
 *   1. Install Firefox.
 *   2. Sign in to YouTube in Firefox. Stay signed in.
 *   3. Nothing else — yt-dlp reads Firefox's live cookie DB on every call.
 *
 *  Fallback: if Firefox is missing, we fall back to cookies.txt in the
 *  project root (Netscape format, exported via a browser extension).
 */
const COOKIES_FILE = join(process.cwd(), "cookies.txt");

export async function cookieArgs(): Promise<string[]> {
  // Primary path — Firefox live cookies.
  return ["--cookies-from-browser", "firefox"];
}

/** Escape hatch: force cookies.txt (e.g. if the Firefox profile is broken). */
export async function fallbackCookiesTxtArgs(): Promise<string[]> {
  try {
    await access(COOKIES_FILE);
    return ["--cookies", COOKIES_FILE];
  } catch {
    return [];
  }
}
