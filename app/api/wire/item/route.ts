import { type NextRequest, NextResponse } from "next/server";
import { getItem, setFlag, type ItemFlag } from "@/lib/wire/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLAGS: readonly ItemFlag[] = ["starred", "used", "hidden"];

type Body = { id?: number; flag?: ItemFlag; value?: 0 | 1 | boolean };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (!body.flag || !FLAGS.includes(body.flag)) {
    return NextResponse.json({ error: "bad_flag" }, { status: 400 });
  }

  const current = getItem(id);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // If value omitted, toggle; otherwise coerce to 0/1.
  const next: 0 | 1 =
    body.value === undefined
      ? current[body.flag] === 1
        ? 0
        : 1
      : body.value
        ? 1
        : 0;

  setFlag(id, body.flag, next);
  return NextResponse.json({ id, flag: body.flag, value: next });
}
