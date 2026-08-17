import { Suspense } from "react";
import { HypeEditStudio } from "./_components/HypeEditStudio";

export const metadata = {
  title: "Hype Edit — Zinolt",
  description:
    "BPM-synced finance montage. Frames cut on the beat, letterboxed 16:9, 1080×1920 MP4.",
};

export default function HypeEditPage() {
  return (
    <Suspense>
      <HypeEditStudio />
    </Suspense>
  );
}
