import { Suspense } from "react";
import { StoryCardStudio } from "./_components/StoryCardStudio";

export const metadata = {
  title: "Story Card — Zinolt",
  description:
    "Multi-paragraph text over a dark ambient loop. Finance, tech, business. 1080×1920 MP4.",
};

export default function StoryCardPage() {
  return (
    <Suspense>
      <StoryCardStudio />
    </Suspense>
  );
}
