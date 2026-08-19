import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * Signed-upload token for @vercel/blob/client's `upload()`. The browser hits
 * this to get a scoped token, then streams the file bytes directly to Blob
 * storage — bypassing the Vercel function body-size limit that was 413ing
 * every file over ~4.5 MB.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("frame-grab/uploads/")) {
          throw new Error("Uploads must live under frame-grab/uploads/");
        }
        return {
          allowedContentTypes: ["video/*"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "upload_token_failed", message: msg }, { status: 400 });
  }
}
