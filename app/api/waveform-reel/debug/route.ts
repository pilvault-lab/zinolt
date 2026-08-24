import { NextResponse } from "next/server";
import { sandboxAvailable } from "@/lib/waveform-reel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint — returns which env vars are present (without values)
 * so we can figure out why sandbox / Blob paths aren't triggering on the
 * deployed server. Safe to leave in production; leaks no secrets.
 */
export async function GET() {
  return NextResponse.json({
    env: {
      BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
      VERCEL_OIDC_TOKEN: !!process.env.VERCEL_OIDC_TOKEN,
      VERCEL_TOKEN: !!process.env.VERCEL_TOKEN,
      VERCEL_TEAM_ID: !!process.env.VERCEL_TEAM_ID,
      VERCEL_PROJECT_ID: !!process.env.VERCEL_PROJECT_ID,
      VERCEL: !!process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV || null,
      NODE_ENV: process.env.NODE_ENV || null,
    },
    sandboxAvailable: sandboxAvailable(),
  });
}
