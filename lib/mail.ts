/**
 * Email provider abstraction. Currently uses Resend's REST API (no SDK,
 * plain fetch). Swap the guts of this file to replace the provider without
 * touching callers.
 *
 * Required env vars:
 *   RESEND_API_KEY — get one at https://resend.com/api-keys
 *   EMAIL_FROM     — verified sender (e.g. onboarding@resend.dev while testing,
 *                    or noreply@yourdomain.com once a domain is verified)
 *   EMAIL_TO       — default recipient (can be overridden per-send)
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type EmailAttachment = {
  filename: string;
  /** Base64-encoded contents. */
  content: string;
  contentType?: string;
};

export type SendEmailOptions = {
  to?: string;                    // defaults to EMAIL_TO env
  from?: string;                  // defaults to EMAIL_FROM env
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
};

const RESEND_URL = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = opts.from ?? process.env.EMAIL_FROM;
  const to = opts.to ?? process.env.EMAIL_TO;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("EMAIL_FROM not set (verified sender required)");
  if (!to) throw new Error("EMAIL_TO not set (pass to: or set env var)");

  const body = {
    from,
    to: [to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType,
    })),
  };

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`resend_${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id: string };
  return { id: json.id };
}

/** Convenience: load a file from disk and package it as an EmailAttachment. */
export function fileAsAttachment(
  filePath: string,
  contentType?: string,
): EmailAttachment {
  const buf = readFileSync(filePath);
  return {
    filename: basename(filePath),
    content: buf.toString("base64"),
    contentType,
  };
}
