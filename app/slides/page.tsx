import { Suspense } from "react";
import { SlideStudio } from "./_components/SlideStudio";

export default function SlidesPage() {
  return (
    <Suspense fallback={null}>
      <SlideStudio />
    </Suspense>
  );
}
