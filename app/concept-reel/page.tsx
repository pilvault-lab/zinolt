import { Suspense } from "react";
import { ConceptReelStudio } from "./_components/ConceptReelStudio";

export const metadata = {
  title: "Concept Reel — Zinolt",
  description:
    "Type a concept excerpt, get a 9:16 narrated explainer reel. 1080×1920 MP4.",
};

export default function ConceptReelPage() {
  return (
    <Suspense>
      <ConceptReelStudio />
    </Suspense>
  );
}
