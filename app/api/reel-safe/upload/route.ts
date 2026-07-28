import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-kind size caps enforced by the blob service via the signed token. The
// client can't exceed these because the token embeds `maximumSizeInBytes`.
const CAPS: Record<UploadKind, { maxBytes: number; contentTypes: string[] }> = {
  main: {
    maxBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    contentTypes: ["video/*"],
  },
  broll: {
    maxBytes: 500 * 1024 * 1024, // 500 MB per clip
    contentTypes: ["video/*"],
  },
  watermark: {
    maxBytes: 25 * 1024 * 1024,
    contentTypes: ["image/png"],
  },
};

type UploadKind = "main" | "broll" | "watermark";

function isUploadKind(v: unknown): v is UploadKind {
  return v === "main" || v === "broll" || v === "watermark";
}

/** Signed-upload token endpoint. Called by @vercel/blob/client's `upload()`.
 *  We validate the requested pathname prefix and clamp size/content-type per
 *  file kind so a malicious client can't push a 10 GB payload through. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        // clientPayload is a JSON string set by the browser: {"kind": "main"}.
        let kind: UploadKind = "main";
        try {
          const parsed = JSON.parse(clientPayloadRaw ?? "{}") as { kind?: unknown };
          if (isUploadKind(parsed.kind)) kind = parsed.kind;
        } catch {
          // fall through with default
        }
        // All reel-safe uploads live under this prefix so the sandbox and
        // cleanup logic can find them predictably.
        if (!pathname.startsWith("reel-safe/uploads/")) {
          throw new Error("Uploads must live under reel-safe/uploads/");
        }
        const cap = CAPS[kind];
        return {
          allowedContentTypes: cap.contentTypes,
          maximumSizeInBytes: cap.maxBytes,
          // Random suffix prevents accidental overwrites when two users pick
          // files with the same name.
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ kind }),
        };
      },
      onUploadCompleted: async () => {
        // No-op. We don't need a server callback — the client already knows
        // the resulting URL and posts it to /api/reel-safe next.
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "upload_token_failed", message: msg }, { status: 400 });
  }
}
