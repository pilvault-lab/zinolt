import type { NextRequest } from "next/server";

const ALLOWED_HOSTS = new Set([
  "pbs.twimg.com",
  "video.twimg.com",
  "abs.twimg.com",
]);

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return new Response("missing url", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response("host not allowed", { status: 400 });
  }

  const forwardHeaders: HeadersInit = {};
  const range = req.headers.get("range");
  if (range) (forwardHeaders as Record<string, string>).Range = range;

  const upstream = await fetch(parsed.toString(), {
    headers: forwardHeaders,
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(`upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const passthrough = new Headers();
  const copy = (h: string) => {
    const v = upstream.headers.get(h);
    if (v) passthrough.set(h, v);
  };
  copy("content-type");
  copy("content-length");
  copy("accept-ranges");
  copy("content-range");
  passthrough.set("cache-control", "public, s-maxage=86400");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: passthrough,
  });
}
