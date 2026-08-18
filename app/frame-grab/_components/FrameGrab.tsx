"use client";

import { useCallback, useMemo, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Header } from "../../_components/Header";
import { FileBrowser } from "./FileBrowser";

type WindowResult = {
  startSec: number;
  count: number;
  frames: string[];
};

type FrameGrabResponse = {
  sourceId: string;
  title: string;
  channel: string;
  durationSec: number;
  intervalSec: number;
  mode: "full-bleed" | "letterboxed";
  windows: WindowResult[];
};

type WindowRow = { id: string; startStr: string; countStr: string };

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
};

function parseStart(input: string): number {
  const t = input.trim();
  if (!t) return 0;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    return Math.max(0, Number(m) * 60 + Number(s));
  }
  return Math.max(0, Number(t) || 0);
}

const newRow = (start = "0", count = "30"): WindowRow => ({
  id: Math.random().toString(36).slice(2, 9),
  startStr: start,
  countStr: count,
});

export function FrameGrab() {
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<WindowRow[]>([newRow()]);
  const [interval, setInterval] = useState(0.5);
  const [mode, setMode] = useState<"full-bleed" | "letterboxed">("full-bleed");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FrameGrabResponse | null>(null);
  const [zipping, setZipping] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

  const totalCount = useMemo(
    () => rows.reduce((a, r) => a + Math.max(0, Math.floor(Number(r.countStr) || 0)), 0),
    [rows],
  );

  const submit = useCallback(async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const windows = rows.map((r) => ({
        startSec: parseStart(r.startStr),
        count: Math.max(1, Math.min(120, Math.floor(Number(r.countStr) || 30))),
      }));
      const res = await fetch("/api/frame-grab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: source.trim(),
          intervalSec: interval,
          mode,
          windows,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      setResult(json as FrameGrabResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }, [source, rows, interval, mode]);

  const downloadZip = useCallback(async () => {
    if (!result) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const root = zip.folder(result.sourceId) ?? zip;
      for (let wi = 0; wi < result.windows.length; wi++) {
        const w = result.windows[wi];
        const folderName =
          result.windows.length > 1
            ? `w${String(wi + 1).padStart(2, "0")}_${Math.round(w.startSec)}s`
            : "";
        const folder = folderName ? (root.folder(folderName) ?? root) : root;
        await Promise.all(
          w.frames.map(async (path) => {
            const blob = await fetch(path).then((r) => r.blob());
            const name = path.split("/").pop() ?? "frame.jpg";
            folder.file(name, blob);
          }),
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${result.sourceId}-frames.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setZipping(false);
    }
  }, [result]);

  const patchRow = (id: string, patch: Partial<WindowRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Frame Grab</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Paste a YouTube URL <span className="text-neutral-600">or</span> local file path
          (e.g. <code className="text-neutral-300">C:\scenepacks\pack.mp4</code>). Extract N frames
          at a fixed interval, cropped 9:16 or letterboxed. Add multiple windows to pull from
          several ranges in one run. Total frames this run: {totalCount}.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…  OR  C:\path\to\scenepack.mp4"
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-neutral-600"
            />
            <Button variant="outline" onClick={() => setBrowseOpen(true)}>
              Browse…
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Interval (s)
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={interval}
                onChange={(e) => setInterval(Math.max(0.1, Number(e.target.value) || 0.5))}
                className="w-24 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              >
                <option value="full-bleed">Full-bleed 9:16 (crop)</option>
                <option value="letterboxed">Letterboxed 16:9 (fit)</option>
              </select>
            </label>
            <Button onClick={submit} disabled={loading || !source.trim()}>
              {loading ? "Grabbing…" : "Grab frames"}
            </Button>
            {result && (
              <Button variant="outline" onClick={downloadZip} disabled={zipping}>
                {zipping ? "Zipping…" : "Download .zip"}
              </Button>
            )}
          </div>

          <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                Windows ({rows.length})
              </div>
              <Button size="xs" variant="outline" onClick={addRow}>
                + Add window
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs tabular-nums text-neutral-500">
                    {i + 1}.
                  </span>
                  <label className="flex flex-col gap-1 text-[10px] text-neutral-500">
                    start (s or m:ss)
                    <input
                      type="text"
                      value={r.startStr}
                      onChange={(e) => patchRow(r.id, { startStr: e.target.value })}
                      className="w-28 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-neutral-500">
                    count
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={r.countStr}
                      onChange={(e) => patchRow(r.id, { countStr: e.target.value })}
                      className="w-20 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-neutral-600"
                    />
                  </label>
                  <span className="text-[11px] text-neutral-500">
                    → {fmtTime(parseStart(r.startStr))} · {(Math.max(1, Number(r.countStr) || 0) * interval).toFixed(1)}s
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => removeRow(r.id)}
                    disabled={rows.length <= 1}
                    className="ml-auto text-neutral-500 hover:text-neutral-200"
                  >
                    remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-8">
            <div className="mb-4 text-sm text-neutral-400">
              <span className="text-neutral-200">{result.title}</span>
              {result.channel ? <> · {result.channel}</> : null} · {result.mode} ·{" "}
              {result.windows.reduce((a, w) => a + w.frames.length, 0)} frames
            </div>
            <div className="flex flex-col gap-8">
              {result.windows.map((w, wi) => (
                <section key={wi}>
                  <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">
                    Window {wi + 1} · from {fmtTime(w.startSec)} · {w.frames.length} frames
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                    {w.frames.map((src, i) => (
                      <a
                        key={src}
                        href={src}
                        download
                        className="group relative block overflow-hidden rounded-md border border-neutral-800 bg-neutral-950"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`frame ${i + 1}`}
                          className="aspect-[9/16] w-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums">
                          {String(i + 1).padStart(2, "0")} ·{" "}
                          {fmtTime(w.startSec + i * result.intervalSec)}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </main>
      {browseOpen && (
        <FileBrowser
          onPick={(path) => {
            setSource(path);
            setBrowseOpen(false);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </div>
  );
}
