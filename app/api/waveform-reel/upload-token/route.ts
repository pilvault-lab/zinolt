import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 2 GB. The browser streams bytes straight to Blob storage — this is only
// here as a sanity cap. Vercel Blob itself has no per-file limit.
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Signed-upload token endpoint for @vercel/blob/client's `upload()`. The
 * browser hits this to mint a scoped token, then PUTs file bytes directly
 * to Blob storage. Bypasses the ~4.5 MB Vercel function body cap that was
 * 413ing every upload from mobile.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("waveform-reel/uploads/")) {
          throw new Error("Uploads must live under waveform-reel/uploads/");
        }
        return {
          allowedContentTypes: ["audio/*", "video/*"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "upload_token_failed", message: msg },
      { status: 400 },
    );
  }
}
