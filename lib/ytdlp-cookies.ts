import { access } from "node:fs/promises";
import { join } from "node:path";

/** Path to an optional Netscape-format cookies file. When present it is
 *  passed to every yt-dlp call so authenticated content (bot-check bypass)
 *  works without needing live browser access.
 *
 *  How to create cookies.txt:
 *  1. Install the "Get cookies.txt LOCALLY" extension in Chrome.
 *  2. Go to youtube.com (logged in), click the extension → Export All.
 *  3. Save the file as cookies.txt in the project root (C:\Projects\zinolt\).
 *  The same file covers TikTok — just visit tiktok.com and re-export. */
const COOKIES_FILE = join(process.cwd(), "cookies.txt");

export async function cookieArgs(): Promise<string[]> {
  try {
    await access(COOKIES_FILE);
    return ["--cookies", COOKIES_FILE];
  } catch {
    return [];
  }
}
