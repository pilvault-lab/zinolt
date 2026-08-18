"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
};

type ListResponse = {
  dir: string;
  parent: string | null;
  entries: Entry[];
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function FileBrowser({
  onPick,
  onClose,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState("");

  const load = useCallback(async (target: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const url = target
        ? `/api/frame-grab/browse?dir=${encodeURIComponent(target)}`
        : `/api/frame-grab/browse`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
        return;
      }
      const d = json as ListResponse;
      setData(d);
      setDir(d.dir);
      setPathInput(d.dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goto = () => {
    const t = pathInput.trim();
    if (t) void load(t);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-[min(900px,92vw)] flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="text-sm font-medium">Browse video files</div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
          <Button
            size="xs"
            variant="outline"
            disabled={!data?.parent}
            onClick={() => data?.parent && void load(data.parent)}
          >
            ↑ Up
          </Button>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goto();
            }}
            placeholder="C:\path\to\folder"
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs outline-none focus:border-neutral-600"
          />
          <Button size="xs" variant="outline" onClick={goto}>
            Go
          </Button>
        </div>

        {error && (
          <div className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-4 text-xs text-neutral-500">Loading…</div>
          )}
          {!loading && data && (
            <ul className="divide-y divide-neutral-900">
              {data.entries.length === 0 && (
                <li className="p-4 text-xs text-neutral-500">
                  No folders or video files here.
                </li>
              )}
              {data.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    onClick={() => {
                      if (entry.isDir) void load(entry.path);
                      else onPick(entry.path);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-neutral-900"
                  >
                    <span className="w-5 text-center text-neutral-500">
                      {entry.isDir ? "📁" : "🎞"}
                    </span>
                    <span className="flex-1 truncate">{entry.name}</span>
                    <span className="w-24 text-right text-[11px] tabular-nums text-neutral-500">
                      {entry.isDir ? "" : fmtSize(entry.size)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-500">
          Click a folder to open. Click a video file to select it. Set{" "}
          <code>FRAME_GRAB_BROWSE_ROOT</code> to change the default folder.
        </footer>
      </div>
    </div>
  );
}
