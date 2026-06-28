import { Suspense } from "react";
import { DangleStudio } from "./_components/DangleStudio";

export default function DanglePage() {
  return (
    <Suspense fallback={null}>
      <DangleStudio />
    </Suspense>
  );
}
