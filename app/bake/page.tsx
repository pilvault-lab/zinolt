"use client";

import { useCallback, useRef, useState } from "react";
import LightPillar from "@/remotion/effects/LightPillar";

const COMP_W = 1080;
const COMP_H = 1920;
const RECORD_SECONDS = 18; // record over composition length; trim to 15s via ffmpeg
const RECORD_FPS = 30;
const VIDEO_BITS_PER_SECOND = 16_000_000;

export default function BakePage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string>("idle");

  const record = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = stage.querySelector("canvas");
    if (!canvas) {
      setStatus("no canvas — wait a moment then retry");
      return;
    }
    setRecording(true);
    setStatus("recording…");

    const stream = canvas.captureStream(RECORD_FPS);
    const mimeCandidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "light-pillar.webm";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setRecording(false);
      setStatus("downloaded light-pillar.webm");
    };
    recorder.start();
    setTimeout(() => recorder.stop(), RECORD_SECONDS * 1000);
  }, []);

  return (
    <div
      style={{
        backgroundColor: "#0A0A0A",
        minHeight: "100vh",
        padding: 24,
        color: "#F5F5F5",
        fontFamily: "Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>/bake</h1>
        <button
          type="button"
          onClick={record}
          disabled={recording}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid #333",
            background: recording ? "#222" : "#F5F5F5",
            color: recording ? "#888" : "#0A0A0A",
            cursor: recording ? "default" : "pointer",
            fontFamily: "inherit",
            fontSize: 13,
          }}
        >
          {recording ? `Recording ${RECORD_SECONDS}s…` : `Record ${RECORD_SECONDS}s`}
        </button>
        <span style={{ fontSize: 12, color: "#888" }}>{status}</span>
      </div>

      <div
        ref={stageRef}
        style={{
          marginTop: 16,
          width: COMP_W,
          height: COMP_H,
          position: "relative",
          backgroundColor: "#0A0A0A",
          overflow: "hidden",
        }}
      >
        <LightPillar
          topColor="#F5F5F5"
          bottomColor="#9A9A9A"
          interactive={false}
          quality="high"
        />
      </div>
    </div>
  );
}
