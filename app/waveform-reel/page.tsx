import { Suspense } from "react";
import { WaveformReelStudio } from "./_components/WaveformReelStudio";

export const metadata = {
  title: "Waveform Reel — Zinolt",
  description:
    "Turn audio (or a YouTube clip) into a faceless 9:16 waveform reel. 1080×1920 MP4.",
};

export default function WaveformReelPage() {
  return (
    <Suspense>
      <WaveformReelStudio />
    </Suspense>
  );
}
