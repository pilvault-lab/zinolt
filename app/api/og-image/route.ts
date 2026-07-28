import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024; // 512KB — og tags live near the top

function isValidHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

async function urlExistsInWireItems(url: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("wire_items")
    .select("id")
    .eq("url", url)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

function extractOgImage(html: string): string | null {
  // Look for og:image first, then twitter:image. Both variants of attribute order.
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "missing_url" }, { status: 400 });
  }

  const parsed = isValidHttpUrl(raw);
  if (!parsed) {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }

  const exists = await urlExistsInWireItems(parsed.toString());
  if (!exists) {
    return NextResponse.json({ error: "not_allowed" }, { status: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; VernavleBot/1.0; +https://zinolt.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok || !res.body) {
      return NextResponse.json({ image: null });
    }

    // Read only the first ~MAX_BYTES so we don't pull entire pages.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try {
      await reader.cancel();
    } catch {}

    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      concat(chunks),
    );
    const image = extractOgImage(html);
    if (!image) return NextResponse.json({ image: null });

    // Resolve relative URLs against the article URL.
    let resolved: string;
    try {
      resolved = new URL(image, parsed).toString();
    } catch {
      return NextResponse.json({ image: null });
    }
    return NextResponse.json({ image: resolved });
  } catch {
    return NextResponse.json({ image: null });
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
