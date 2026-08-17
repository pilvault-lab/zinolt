"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  canRenderMediaOnWeb,
  renderMediaOnWeb,
} from "@remotion/web-renderer";
import { stripVideoMetadata } from "@/lib/strip-video-metadata";
import {
  DEFAULT_SETTINGS,
  EMPTY_PROJECT,
  type HypeFrame,
  type HypeProject,
  type HypeSettings,
} from "@/lib/hype-edit/types";
import { loadProject, saveProject } from "@/lib/hype-edit/storage";
import { deleteBlob, putBlob } from "@/lib/hype-edit/blob-store";
import {
  HypeEditComposition,
  hypeEditDefaultProps,
  computeHypeDurationFrames,
  HE_FPS,
  HE_HEIGHT,
  HE_WIDTH,
  type HypeEditProps,
} from "@/remotion/hype-edit/HypeEdit";
import { TopBar } from "./TopBar";
import { LeftSidebar } from "./LeftSidebar";
import { RightPanel } from "./RightPanel";
import { Transport } from "./Transport";
import { UI } from "./ui";
import type { UITrack } from "./AudioPanel";

const DEFAULT_BPM = 120;

export const HypeEditStudio: React.FC = () => {
  /* ─── Project state ────────────────────────────────────────────────── */
  const [project, setProject] = useState<HypeProject>(EMPTY_PROJECT);
  useEffect(() => {
    void loadProject().then((loaded) => {
      if (loaded) setProject(loaded);
    });
  }, []);

  const updateProject = useCallback((patch: Partial<HypeProject>) => {
    setProject((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateSettings = useCallback((patch: Partial<HypeSettings>) => {
    setProject((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  }, []);

  /* ─── Audio catalog ────────────────────────────────────────────────── */
  const [presets, setPresets] = useState<UITrack[]>([]);
  const [custom, setCustom] = useState<UITrack[]>([]);
  useEffect(() => {
    fetch("/api/hype-edit/audio", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ presets: UITrack[]; custom: UITrack[] }>)
      .then((d) => {
        setPresets(d.presets ?? []);
        setCustom(d.custom ?? []);
      })
      .catch(() => {});
  }, []);

  const audioTrack = useMemo(() => {
    return (
      presets.find((p) => p.file === project.audioFile) ??
      custom.find((c) => c.file === project.audioFile) ??
      null
    );
  }, [presets, custom, project.audioFile]);

  const bpmEffective =
    project.bpmOverride ?? audioTrack?.bpm ?? DEFAULT_BPM;

  /* ─── Audio duration probe (drives composition length) ──────────────── */
  const [durationSec, setDurationSec] = useState(8);
  useEffect(() => {
    if (!project.audioFile) {
      setDurationSec(8); // silent preview length
      return;
    }
    const src = `/${project.audioFile}`;
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.src = src;
    const onMeta = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDurationSec(d);
    };
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [project.audioFile]);

  /* ─── Debounced persist ────────────────────────────────────────────── */
  useEffect(() => {
    const h = setTimeout(() => saveProject(project), 300);
    return () => clearTimeout(h);
  }, [project]);

  /* ─── Player wiring ────────────────────────────────────────────────── */
  const playerRef = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.addEventListener("frameupdate", onFrame as any);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p.removeEventListener("frameupdate", onFrame as any);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, []);

  const handlePlayPause = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else p.play();
  };

  const handleSeek = (sec: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(Math.max(0, Math.floor(sec * HE_FPS)));
  };

  /* ─── Composition props ────────────────────────────────────────────── */
  const inputProps: HypeEditProps = useMemo(
    () => ({
      frames: project.frames,
      audioSrc: project.audioFile,
      bpm: bpmEffective,
      durationSec,
      settings: project.settings,
      forRender: false,
    }),
    [project, bpmEffective, durationSec],
  );

  const durationFrames = computeHypeDurationFrames(durationSec, HE_FPS);

  /* ─── Player sizing ────────────────────────────────────────────────── */
  const stageRef = useRef<HTMLDivElement>(null);
  const [playerDims, setPlayerDims] = useState({ w: 320, h: 569 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const padX = 24;
      const padY = 24;
      const maxW = r.width - padX * 2;
      const maxH = r.height - padY * 2;
      const wByH = (maxH * HE_WIDTH) / HE_HEIGHT;
      const w = Math.min(maxW, wByH);
      const h = (w * HE_HEIGHT) / HE_WIDTH;
      setPlayerDims({ w: Math.floor(w), h: Math.floor(h) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  /* ─── Frames CRUD ──────────────────────────────────────────────────── */
  const addFrame = useCallback((f: HypeFrame) => {
    setProject((prev) => ({ ...prev, frames: [...prev.frames, f] }));
  }, []);
  const deleteFrame = (id: string) => {
    // Blob is only present for session frames; deleteBlob is a no-op otherwise.
    void deleteBlob(id);
    setProject((prev) => ({
      ...prev,
      frames: prev.frames.filter((f) => f.id !== id),
    }));
  };
  const reorderFrames = (n: HypeFrame[]) =>
    setProject((prev) => ({ ...prev, frames: n }));

  /* ─── Ingest files from upload / drag-drop / paste ─────────────────── */
  const ingestFiles = useCallback(
    (files: FileList | File[]) => {
      let added = 0;
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) continue;
        const id = crypto.randomUUID();
        // Persist the raw blob so a refresh can rebuild the ObjectURL.
        void putBlob(id, f);
        addFrame({
          id,
          kind: f.type.startsWith("video/") ? "video" : "image",
          src: URL.createObjectURL(f),
          label: f.name || undefined,
          session: true,
        });
        added++;
      }
      return added;
    },
    [addFrame],
  );

  /* ─── Global paste (Cmd/Ctrl+V) ────────────────────────────────────── */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack paste when the user is editing a text field.
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        ingestFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestFiles]);

  /* ─── Global drag-and-drop ────────────────────────────────────────── */
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Boolean(e.dataTransfer?.types?.includes("Files"));
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current++;
      setIsDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) ingestFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [ingestFiles]);

  /* ─── Save / Open (localStorage) ───────────────────────────────────── */
  const [savedNote, setSavedNote] = useState("");
  const handleSave = () => {
    saveProject(project);
    setSavedNote("Saved");
    setTimeout(() => setSavedNote(""), 1500);
  };
  const handleOpen = async () => {
    const loaded = await loadProject();
    if (loaded) {
      setProject(loaded);
      setSavedNote("Opened");
    } else {
      setSavedNote("Nothing to open");
    }
    setTimeout(() => setSavedNote(""), 1500);
  };

  /* ─── Export ───────────────────────────────────────────────────────── */
  const [canExport, setCanExport] = useState<boolean | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    canRenderMediaOnWeb({
      container: "mp4",
      videoCodec: "h264",
      width: HE_WIDTH,
      height: HE_HEIGHT,
    })
      .then((r) => setCanExport(r.canRender))
      .catch(() => setCanExport(false));
  }, []);

  const downloadDisabled =
    !project.audioFile || project.frames.length === 0 || canExport === false;

  const handleDownload = useCallback(async () => {
    if (downloadDisabled) return;
    setExportError("");
    setIsRendering(true);
    setProgress(0);
    try {
      const exportFps = project.settings.fps;
      const exportFrames = computeHypeDurationFrames(durationSec, exportFps);
      const render: HypeEditProps = {
        ...inputProps,
        forRender: true,
      };
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: "HypeEdit",
          component: HypeEditComposition,
          durationInFrames: exportFrames,
          fps: exportFps,
          width: HE_WIDTH,
          height: HE_HEIGHT,
          defaultProps: hypeEditDefaultProps,
          calculateMetadata: () => ({
            width: HE_WIDTH,
            height: HE_HEIGHT,
            durationInFrames: exportFrames,
            fps: exportFps,
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputProps: render as any,
        licenseKey: "free-license",
        videoCodec: "h264",
        videoBitrate: project.settings.bitrate,
        audioCodec: "aac",
        hardwareAcceleration: "prefer-hardware",
        keyframeIntervalInSeconds: 2,
        delayRenderTimeoutInMilliseconds: 180_000,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await stripVideoMetadata(await getBlob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hype-edit.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(
        msg && !msg.includes("[object")
          ? msg
          : "Export failed. Try Chrome or Edge on desktop.",
      );
    } finally {
      setIsRendering(false);
    }
  }, [downloadDisabled, project.settings, durationSec, inputProps]);

  /* ─── Render ───────────────────────────────────────────────────────── */
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        height: "100vh",
        background: UI.chrome,
        color: UI.ink,
      }}
    >
      <TopBar onOpen={handleOpen} onSave={handleSave} />
      {savedNote ? (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: UI.ink,
            color: "#FFF",
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: 999,
            zIndex: 100,
          }}
        >
          {savedNote}
        </div>
      ) : null}

      <main
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          minHeight: 0,
        }}
      >
        <LeftSidebar
          presets={presets}
          custom={custom}
          audioFile={project.audioFile}
          onAudioPick={(file) => updateProject({ audioFile: file })}
          bpmEffective={bpmEffective}
          bpmOverride={project.bpmOverride}
          onBpmOverride={(n) => updateProject({ bpmOverride: n })}
          settings={project.settings}
          onSettings={updateSettings}
        />

        <div
          ref={stageRef}
          style={{
            background: UI.stageBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: playerDims.w,
              height: playerDims.h,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              borderRadius: 4,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <Player
              ref={playerRef}
              component={HypeEditComposition}
              compositionWidth={HE_WIDTH}
              compositionHeight={HE_HEIGHT}
              durationInFrames={durationFrames}
              fps={HE_FPS}
              controls={false}
              loop
              inputProps={inputProps}
              style={{ width: playerDims.w, height: playerDims.h }}
              acknowledgeRemotionLicense
            />
          </div>
        </div>

        <RightPanel
          frames={project.frames}
          onReorder={reorderFrames}
          onDelete={deleteFrame}
          onAdd={addFrame}
          onIngestFiles={ingestFiles}
          onDownload={handleDownload}
          isRendering={isRendering}
          progress={progress}
          canExport={canExport}
          exportError={exportError}
          downloadDisabled={downloadDisabled}
        />
      </main>

      <Transport
        playing={playing}
        currentSec={currentFrame / HE_FPS}
        durationSec={durationSec}
        bpm={bpmEffective}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
      />

      {isDragging ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(19,19,22,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            color: "#FFF",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 0.4,
            border: `4px dashed rgba(255,255,255,0.55)`,
            boxSizing: "border-box",
          }}
        >
          Drop images / videos to add as frames
        </div>
      ) : null}
    </div>
  );
};
