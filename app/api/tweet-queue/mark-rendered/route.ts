import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// Called by the tweet-video editor after a successful MP4 export when the
// composition was opened from /sourcing (queue_id present in the URL).
// Server-only — uses the service_role key so RLS is bypassed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const queueId =
    body && typeof body === "object" && "queue_id" in body
      ? (body as { queue_id: unknown }).queue_id
      : undefined;
  if (typeof queueId !== "string" || !UUID_RE.test(queueId)) {
    return NextResponse.json({ error: "invalid_queue_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("tweet_queue")
    .update({ status: "rendered" })
    .eq("id", queueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
