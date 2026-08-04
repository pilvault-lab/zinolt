# TikTok Grab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "TikTok Grab" template — paste a TikTok URL, get a branded 1080×1920 MP4 with the Vernavle watermark, download it.

**Architecture:** yt-dlp fetches the raw TikTok video (`raw.mp4`) keyed by TikTok video ID under `.tiktok-cache/{id}/`. ffmpeg applies the existing full-bleed treatment + watermark from `lib/video-treatment.ts`, writing `branded.mp4` to the same dir. A streaming GET route serves the branded file. The template card on the homepage is added by inserting one entry into `TEMPLATES` in `lib/templates.ts`.

**Tech Stack:** Next.js App Router, yt-dlp CLI, ffmpeg via `lib/video-treatment.ts`, React (client component)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/tiktok/download.ts` | yt-dlp info + download, ffmpeg treatment, cache management |
| Create | `app/api/tiktok/download/route.ts` | POST handler — returns `{videoId, title, downloadUrl}` |
| Create | `app/api/tiktok/file/route.ts` | GET handler — streams `branded.mp4` |
| Create | `public/tiktok/preview.svg` | Template grid preview image |
| Create | `app/tiktok/page.tsx` | Page metadata + entry point |
| Create | `app/tiktok/_components/TikTokGrab.tsx` | Client UI — URL input, status, download link |
| Modify | `lib/templates.ts` | Add `tiktok-grab` entry to `TEMPLATES` array |

---

### Task 1: Backend lib — `lib/tiktok/download.ts`

**Files:**
- Create: `lib/tiktok/download.ts`

- [ ] **Step 1: Create the file**

```typescript
import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { brandAssetPaths, buildTreatmentArgs, runFfmpeg } from "../video-treatment";

const CACHE_ROOT = join(process.cwd(), ".tiktok-cache");

function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c.toString()));
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export type TikTokResult = {
  videoId: string;
  title: string;
  filename: string;
};

export async function downloadTikTok(
  rawUrl: string,
): Promise<TikTokResult | { error: string }> {
  // Step 1: info JSON — extracts real video ID and duration regardless of
  // URL format (short links, @user/video/, etc.).
  const infoRes = await run("yt-dlp", [
    "-J",
    "--no-playlist",
    "--skip-download",
    rawUrl,
  ]);
  if (infoRes.code !== 0) {
    return { error: `yt-dlp info failed: ${infoRes.stderr.slice(0, 200)}` };
  }

  let infoJson: { id?: string; title?: string; duration?: number };
  try {
    infoJson = JSON.parse(infoRes.stdout) as typeof infoJson;
  } catch {
    return { error: "yt-dlp returned invalid JSON" };
  }

  const videoId = infoJson.id;
  if (!videoId) return { error: "could_not_extract_video_id" };

  const dir = join(CACHE_ROOT, videoId);
  await mkdir(dir, { recursive: true });

  const rawPath = join(dir, "raw.mp4");
  const brandedPath = join(dir, "branded.mp4");

  // Step 2: download raw video (cached).
  if (!(await fileExists(rawPath))) {
    const dlRes = await run("yt-dlp", [
      "--no-playlist",
      "-f", "mp4/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", rawPath,
      rawUrl,
    ]);
    if (dlRes.code !== 0 || !(await fileExists(rawPath))) {
      return { error: `yt-dlp download failed: ${dlRes.stderr.slice(0, 300)}` };
    }
  }

  // Step 3: apply brand treatment (cached).
  if (!(await fileExists(brandedPath))) {
    const brand = brandAssetPaths(join(process.cwd(), "public"));
    const duration = infoJson.duration ?? 9999;
    const args = buildTreatmentArgs({
      source: rawPath,
      output: brandedPath,
      orientation: "full-bleed",
      clipStart: 0,
      clipDuration: duration,
      watermarkPath: brand.watermark,
      vernavleTtf: brand.vernavleTtf,
      fontsDir: brand.fontsDir,
    });
    const ffRes = await runFfmpeg(args);
    if (ffRes.code !== 0 || !(await fileExists(brandedPath))) {
      return { error: `ffmpeg failed: ${ffRes.stderr.slice(-300)}` };
    }
  }

  return {
    videoId,
    title: infoJson.title ?? videoId,
    filename: `tiktok-${videoId}.mp4`,
  };
}

export function tiktokCacheDir(videoId: string): string {
  return join(CACHE_ROOT, videoId);
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/tiktok/download.ts
git commit -m "TikTok Grab: backend lib — yt-dlp download + brand treatment"
```

---

### Task 2: API download route

**Files:**
- Create: `app/api/tiktok/download/route.ts`

- [ ] **Step 1: Create the file**

```typescript
import { NextResponse } from "next/server";
import { downloadTikTok } from "@/lib/tiktok/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  const res = await downloadTikTok(url);
  if ("error" in res) {
    return NextResponse.json(res, { status: 502 });
  }
  return NextResponse.json({
    videoId: res.videoId,
    title: res.title,
    filename: res.filename,
    downloadUrl: `/api/tiktok/file?id=${encodeURIComponent(res.videoId)}`,
  });
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/tiktok/download/route.ts
git commit -m "TikTok Grab: POST /api/tiktok/download route"
```

---

### Task 3: API file-serving route

**Files:**
- Create: `app/api/tiktok/file/route.ts`

- [ ] **Step 1: Create the file**

```typescript
import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tiktokCacheDir } from "@/lib/tiktok/download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  // TikTok video IDs are long numeric strings; allow word chars + hyphens.
  if (!/^[\w-]{1,50}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const filePath = join(tiktokCacheDir(id), "branded.mp4");
  try {
    const s = await stat(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = createReadStream(filePath) as any;
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(s.size),
        "content-disposition": `attachment; filename="tiktok-${id}.mp4"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/tiktok/file/route.ts
git commit -m "TikTok Grab: GET /api/tiktok/file streaming route"
```

---

### Task 4: Preview image + page entry

**Files:**
- Create: `public/tiktok/preview.svg`
- Create: `app/tiktok/page.tsx`

- [ ] **Step 1: Create the preview SVG**

Create `public/tiktok/preview.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 192" fill="none">
  <rect width="108" height="192" fill="#0a0a0a"/>
  <circle cx="54" cy="92" r="22" fill="none" stroke="white" stroke-width="1.5" opacity="0.35"/>
  <polygon points="49,83 49,101 67,92" fill="white" opacity="0.55"/>
  <text x="54" y="138" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="7.5" fill="white" opacity="0.4" letter-spacing="1">TIKTOK GRAB</text>
</svg>
```

- [ ] **Step 2: Create the page file**

Create `app/tiktok/page.tsx`:

```typescript
import { TikTokGrab } from "./_components/TikTokGrab";

export const metadata = {
  title: "TikTok Grab — Zinolt",
  description:
    "Paste a TikTok URL and download it branded in 1080×1920 with the Vernavle watermark.",
};

export default function TikTokGrabPage() {
  return <TikTokGrab />;
}
```

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: error about missing `TikTokGrab` module — that's expected at this step.

- [ ] **Step 4: Commit**

```bash
git add public/tiktok/preview.svg app/tiktok/page.tsx
git commit -m "TikTok Grab: preview SVG + page shell"
```

---

### Task 5: UI component

**Files:**
- Create: `app/tiktok/_components/TikTokGrab.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";

export const TikTokGrab: React.FC = () => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; downloadUrl: string } | null>(null);
  const [error, setError] = useState("");

  const doGrab = useCallback(async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tiktok/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = (await res.json()) as {
        error?: string;
        title?: string;
        downloadUrl?: string;
      };
      if (!res.ok) {
        setError(String(j.error ?? "download_failed"));
      } else {
        setResult({ title: j.title ?? url, downloadUrl: j.downloadUrl! });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.colors.paper }}>
      <Header
        right={
          <Button asChild variant="outline" className="rounded-full font-sans">
            <Link href="/">Change style</Link>
          </Button>
        }
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-sans text-xl font-semibold" style={{ color: BRAND.colors.ink }}>
              TikTok Grab
            </h1>
            <p className="font-sans text-sm" style={{ color: BRAND.colors.grey500 }}>
              Paste a TikTok URL. Get a branded 1080×1920 MP4 with the Vernavle watermark.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doGrab();
              }}
              placeholder="https://www.tiktok.com/@user/video/..."
              className="min-w-0 flex-1 rounded-md border px-3 py-2 font-sans text-sm"
              style={{
                borderColor: BRAND.colors.grey200,
                backgroundColor: "#fff",
                color: BRAND.colors.ink,
              }}
            />
            <Button onClick={doGrab} disabled={loading || !url.trim()}>
              {loading ? "Processing…" : "Grab"}
            </Button>
          </div>

          {loading ? (
            <p className="font-sans text-xs" style={{ color: BRAND.colors.grey500 }}>
              Downloading and branding — this may take a minute…
            </p>
          ) : null}

          {error ? (
            <p className="font-sans text-xs" style={{ color: BRAND.colors.ink }} role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <div
              className="flex items-center justify-between gap-3 rounded-md border p-3 font-sans text-sm"
              style={{ borderColor: BRAND.colors.grey200 }}
            >
              <span
                className="truncate"
                style={{ color: BRAND.colors.grey500 }}
                title={result.title}
              >
                {result.title}
              </span>
              <a
                href={result.downloadUrl}
                download
                className="shrink-0 underline font-sans text-sm"
                style={{ color: BRAND.colors.ink }}
              >
                Download
              </a>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/tiktok/_components/TikTokGrab.tsx
git commit -m "TikTok Grab: UI component"
```

---

### Task 6: Register in templates + homepage

**Files:**
- Modify: `lib/templates.ts`

- [ ] **Step 1: Add entry to TEMPLATES array**

In `lib/templates.ts`, append to the `TEMPLATES` array (after the `clip-studio` entry):

```typescript
  {
    id: "tiktok-grab",
    compositionId: "",
    label: "TikTok Grab",
    background: "",
    preview: "/tiktok/preview.svg",
    href: "/tiktok",
  },
```

The homepage auto-renders every entry in `TEMPLATES` — no changes needed to `app/page.tsx`.

- [ ] **Step 2: TypeScript check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build, `/tiktok` route appears in the route table.

- [ ] **Step 3: Commit**

```bash
git add lib/templates.ts
git commit -m "TikTok Grab: register template — appears on homepage grid"
```

---

### Task 7: Build, deploy, verify

- [ ] **Step 1: Run rebuild script**

```powershell
cmd /c "C:\Projects\zinolt\scripts\rebuild-zinolt.bat"
```

Expected: build succeeds, server restarts, `Server up: HTTP 200`.

- [ ] **Step 2: Verify homepage**

Hard-refresh (`Ctrl+Shift+R`) — confirm "TikTok Grab" card appears in the template grid.

- [ ] **Step 3: Verify the tool**

Navigate to `http://localhost:3001/tiktok`, paste a TikTok URL, click Grab, wait for "Download" link to appear, download and confirm the video has the Vernavle watermark.

- [ ] **Step 4: Push**

```bash
git push origin main
```
