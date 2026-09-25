import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  /** Exact Blob pathnames to delete (safest). */
  pathnames?: string[];
  /** Prefixes to sweep — anything under these gets deleted. */
  prefixes?: string[];
};

// Hard guardrail: only ever touch our own namespace. Prevents a bogus caller
// from wiping other Blob folders even if they know the store token.
const ALLOWED_ROOTS = [
  "frame-grab/uploads/",
  "frame-grab/jobs/",
  "frame-grab/youtube/",
];

function isSafe(p: string): boolean {
  return ALLOWED_ROOTS.some((root) => p.startsWith(root));
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // sendBeacon sends Blob bodies that don't always parse as JSON — treat as no-op
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const pathnames = (body.pathnames ?? []).filter(
    (p): p is string => typeof p === "string" && isSafe(p),
  );
  const prefixes = (body.prefixes ?? []).filter(
    (p): p is string => typeof p === "string" && isSafe(p),
  );

  const toDelete = new Set<string>(pathnames);

  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      for (const b of page.blobs) {
        if (isSafe(b.pathname)) toDelete.add(b.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  if (toDelete.size === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  await del(Array.from(toDelete));
  return NextResponse.json({ ok: true, deleted: toDelete.size });
}
