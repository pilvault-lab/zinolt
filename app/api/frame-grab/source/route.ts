import { proxyPrivateBlob } from "@/lib/frame-grab-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams private source videos (YouTube fetches + uploads) to the browser. */
export function GET(req: Request) {
  return proxyPrivateBlob(req, "frame-grab/");
}
