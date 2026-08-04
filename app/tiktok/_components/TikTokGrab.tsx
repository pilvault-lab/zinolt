"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";

export const TikTokGrab: React.FC = () => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; downloadUrl: string } | null>(null);
  const [error, setError] = useState("");

  const doGrab = useCallback(async () => {
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tiktok/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = (await res.json()) as {
        error?: string;
        title?: string;
        downloadUrl?: string;
      };
      if (!res.ok) {
        setError(String(j.error ?? "download_failed"));
      } else {
        setResult({ title: j.title ?? url, downloadUrl: j.downloadUrl! });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: BRAND.colors.paper }}>
      <Header
        right={
          <Button asChild variant="outline" className="rounded-full font-sans">
            <Link href="/">Change style</Link>
          </Button>
        }
      />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-sans text-xl font-semibold" style={{ color: BRAND.colors.ink }}>
              TikTok Grab
            </h1>
            <p className="font-sans text-sm" style={{ color: BRAND.colors.grey500 }}>
              Paste a TikTok URL. Get a branded 1080×1920 MP4 with the Vernavle watermark.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doGrab();
              }}
              placeholder="https://www.tiktok.com/@user/video/..."
              className="min-w-0 flex-1 rounded-md border px-3 py-2 font-sans text-sm"
              style={{
                borderColor: BRAND.colors.grey200,
                backgroundColor: "#fff",
                color: BRAND.colors.ink,
              }}
            />
            <Button onClick={doGrab} disabled={loading || !url.trim()}>
              {loading ? "Processing…" : "Grab"}
            </Button>
          </div>

          {loading ? (
            <p className="font-sans text-xs" style={{ color: BRAND.colors.grey500 }}>
              Downloading and branding — this may take a minute…
            </p>
          ) : null}

          {error ? (
            <p className="font-sans text-xs" style={{ color: BRAND.colors.ink }} role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <div
              className="flex items-center justify-between gap-3 rounded-md border p-3 font-sans text-sm"
              style={{ borderColor: BRAND.colors.grey200 }}
            >
              <span
                className="truncate"
                style={{ color: BRAND.colors.grey500 }}
                title={result.title}
              >
                {result.title}
              </span>
              <a
                href={result.downloadUrl}
                download
                className="shrink-0 underline font-sans text-sm"
                style={{ color: BRAND.colors.ink }}
              >
                Download
              </a>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
};
