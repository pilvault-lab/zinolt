"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ReelSafeJobStatus,
  ReelSafeResult,
  WatermarkCorner,
} from "@/lib/reelsafe-types";

const CORNERS: { value: WatermarkCorner; label: string }[] = [
  { value: "top-left", label: "Top-Left" },
  { value: "top-right", label: "Top-Right" },
  { value: "bottom-left", label: "Bottom-Left" },
  { value: "bottom-right", label: "Bottom-Right" },
];

type Phase = "idle" | "uploading" | "submitting" | "polling" | "done" | "error";

type UploadProgress = { name: string; loaded: number; total: number };

export function ReelSafeForm() {
  const [source, setSource] = useState<File | null>(null);
  const [brolls, setBrolls] = useState<File[]>([]);
  const [watermark, setWatermark] = useState<File | null>(null);
  const [corner, setCorner] = useState<WatermarkCorner>("top-right");
  const [speed, setSpeed] = useState(1.05);

  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ReelSafeJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReelSafeResult | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const poll = useCallback(async (id: string) => {
    cancelled.current = false;
    while (!cancelled.current) {
      try {
        const res = await fetch(`/api/reel-safe?jobId=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const s = (await res.json()) as ReelSafeJobStatus;
        if (cancelled.current) return;
        setStatus(s);
        if (s.state === "done") {
          setResult(s.result);
          setPhase("done");
          return;
        }
        if (s.state === "error") {
          setError(s.error);
          setPhase("error");
          return;
        }
      } catch (err) {
        if (cancelled.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
        return;
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  }, []);

  const uploadOne = useCallback(
    async (file: File, kind: "main" | "broll" | "watermark") => {
      // Track progress in a stable slot per filename so re-renders don't wipe
      // it. Multiple files with the same name are rare here but harmless.
      const key = `${kind}:${file.name}`;
      setUploadProgress((prev) => {
        if (prev.some((p) => p.name === key)) return prev;
        return [...prev, { name: key, loaded: 0, total: file.size }];
      });
      const blob = await upload(`reel-safe/uploads/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/reel-safe/upload",
        clientPayload: JSON.stringify({ kind }),
        onUploadProgress: ({ loaded, total }) => {
          setUploadProgress((prev) =>
            prev.map((p) => (p.name === key ? { ...p, loaded, total } : p)),
          );
        },
      });
      return blob.url;
    },
    [],
  );

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!source) return;
    setPhase("uploading");
    setUploadProgress([]);
    setError(null);
    setResult(null);
    setStatus(null);

    try {
      // Upload in parallel — Blob's client SDK handles chunking and retries.
      const [sourceUrl, brollUrls, watermarkUrl] = await Promise.all([
        uploadOne(source, "main"),
        Promise.all(brolls.map((b) => uploadOne(b, "broll"))),
        watermark ? uploadOne(watermark, "watermark") : Promise.resolve(null),
      ]);

      setPhase("submitting");
      const res = await fetch("/api/reel-safe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          brollUrls,
          watermarkUrl,
          corner,
          speed,
        }),
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        let detail = "";
        if (contentType.includes("application/json")) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
          };
          detail = body.message ?? body.error ?? "";
        } else {
          const text = await res.text().catch(() => "");
          detail = text.trim().slice(0, 240);
        }
        throw new Error(detail || `Submit failed (${res.status} ${res.statusText || ""})`.trim());
      }
      const { jobId: id } = (await res.json()) as { jobId: string };
      setJobId(id);
      setPhase("polling");
      void poll(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const reset = () => {
    cancelled.current = true;
    setPhase("idle");
    setStatus(null);
    setResult(null);
    setError(null);
    setJobId(null);
    setUploadProgress([]);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-ds-on-surface-muted hover:underline">
          ← Home
        </Link>
        <h1 className="type-display-serif text-2xl">Reel-Safe</h1>
        <span className="w-16" />
      </div>

      {phase === "done" && result ? (
        <ResultPanel result={result} onReset={reset} />
      ) : phase === "polling" || phase === "submitting" || phase === "uploading" ? (
        <ProgressPanel
          phase={phase}
          status={status}
          jobId={jobId}
          uploads={uploadProgress}
          onReset={reset}
        />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Card padding="comfortable" className="flex flex-col gap-4">
            <FileField
              label="Main video"
              accept="video/*"
              file={source}
              onChange={setSource}
              hint="MP4, MOV, WebM up to 2 GB. Uploads directly to storage."
              required
            />
            <FileField
              label={`B-roll clips (${brolls.length})`}
              accept="video/*"
              multiple
              files={brolls}
              onMultiChange={setBrolls}
              hint="Up to 10 clips, 500 MB each. Spliced between speech chunks."
            />
            <FileField
              label="Watermark PNG (optional)"
              accept="image/png"
              file={watermark}
              onChange={setWatermark}
              hint="PNG only for now. Placed in the chosen corner with a small random offset."
            />
          </Card>

          <Card padding="comfortable" className="flex flex-col gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Watermark corner</label>
              <div className="flex flex-wrap gap-2">
                {CORNERS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCorner(c.value)}
                    aria-pressed={corner === c.value}
                    className={
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors " +
                      (corner === c.value
                        ? "border-ds-primary bg-ds-primary/10"
                        : "border-ds-border-hairline hover:bg-ds-surface-raised")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Speed <span className="text-ds-on-surface-muted">({speed.toFixed(2)}x)</span>
              </label>
              <input
                type="range"
                min={0.9}
                max={1.3}
                step={0.01}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-ds-on-surface-muted">
                Applied to both video and audio. 1.05x is a safe default.
              </p>
            </div>
          </Card>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="pill-primary"
            size="pill"
            disabled={!source}
            className="w-full"
          >
            Make it reel-safe →
          </Button>
        </form>
      )}
    </div>
  );
}

function FileField(props: {
  label: string;
  accept: string;
  hint?: string;
  required?: boolean;
} & (
  | { file: File | null; onChange: (f: File | null) => void; multiple?: false; files?: undefined; onMultiChange?: undefined }
  | { multiple: true; files: File[]; onMultiChange: (fs: File[]) => void; file?: undefined; onChange?: undefined }
)) {
  const { label, accept, hint, required, multiple } = props;
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </label>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (multiple) {
            props.onMultiChange(files.slice(0, 10));
          } else {
            props.onChange(files[0] ?? null);
          }
        }}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ds-primary file:px-3 file:py-1.5 file:text-ds-on-primary hover:file:bg-ds-primary/90"
      />
      {multiple && props.files.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-ds-on-surface-muted">
          {props.files.map((f, i) => (
            <li key={i}>
              {i + 1}. {f.name} ({fmtBytes(f.size)})
            </li>
          ))}
        </ul>
      ) : null}
      {!multiple && props.file ? (
        <p className="mt-2 text-xs text-ds-on-surface-muted">
          {props.file.name} ({fmtBytes(props.file.size)})
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-ds-on-surface-muted">{hint}</p> : null}
    </div>
  );
}

function ProgressPanel(props: {
  phase: Phase;
  status: ReelSafeJobStatus | null;
  jobId: string | null;
  uploads: UploadProgress[];
  onReset: () => void;
}) {
  const { status, phase, jobId, uploads, onReset } = props;

  // While uploading, show aggregate byte progress across all files.
  let pct = 0;
  let note = "Starting…";
  if (phase === "uploading") {
    const total = uploads.reduce((s, u) => s + u.total, 0);
    const loaded = uploads.reduce((s, u) => s + u.loaded, 0);
    pct = total > 0 ? loaded / total : 0;
    note = `Uploading ${uploads.length} file${uploads.length === 1 ? "" : "s"}…`;
  } else if (phase === "submitting") {
    pct = 0.01;
    note = "Queueing render…";
  } else if (status) {
    pct = status.progress;
    note = "note" in status && status.note ? status.note : status.state;
  }

  return (
    <Card padding="comfortable" className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">
          {phase === "uploading" ? "Uploading" : "Processing"}
        </p>
        <p className="mt-1 text-xs text-ds-on-surface-muted">
          {jobId ? <>Job {jobId.slice(0, 8)}… — </> : null}
          {note}
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ds-border-hairline">
        <div
          className="h-full bg-ds-primary transition-all"
          style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
        />
      </div>
      {phase === "uploading" && uploads.length > 1 ? (
        <ul className="flex flex-col gap-1 text-xs text-ds-on-surface-muted">
          {uploads.map((u) => (
            <li key={u.name} className="flex justify-between gap-4">
              <span className="truncate">{u.name.split(":").slice(1).join(":")}</span>
              <span className="tabular-nums">
                {u.total > 0 ? `${Math.round((u.loaded / u.total) * 100)}%` : "…"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onReset}
        className="self-start text-xs text-ds-on-surface-muted hover:underline"
      >
        Cancel
      </button>
    </Card>
  );
}

function ResultPanel({ result, onReset }: { result: ReelSafeResult; onReset: () => void }) {
  return (
    <Card padding="comfortable" className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">Done</p>
        <p className="mt-1 text-xs text-ds-on-surface-muted">
          {result.duration.toFixed(1)}s · {result.brollUsed} b-roll insert
          {result.brollUsed === 1 ? "" : "s"} · {result.silencesTrimmed} silence
          {result.silencesTrimmed === 1 ? "" : "s"} trimmed
        </p>
      </div>
      <video
        src={result.outputUrl}
        controls
        playsInline
        className="mx-auto w-full max-w-[360px] rounded-ds-md bg-black"
        style={{ aspectRatio: "9 / 16" }}
      />
      <div className="flex gap-2">
        <Button asChild variant="pill-primary" size="pill" className="flex-1">
          <a href={result.outputUrl} download={`reel-safe-${result.jobId}.mp4`}>
            Download MP4
          </a>
        </Button>
        <Button
          type="button"
          variant="pill-secondary"
          size="pill"
          className="flex-1"
          onClick={onReset}
        >
          Make another
        </Button>
      </div>
    </Card>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
