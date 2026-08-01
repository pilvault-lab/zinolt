import { ClipStudio } from "./_components/ClipStudio";

export const metadata = {
  title: "Clip Studio — Zinolt",
  description:
    "Paste a YouTube URL, get the auto-transcript + most-replayed heatmap, hand off to Claude, paste back timestamps, cut the clips.",
};

export default function ClipStudioPage() {
  return <ClipStudio />;
}
