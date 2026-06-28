import { Suspense } from "react";
import { WallStudio } from "./_components/WallStudio";

export default function WallPage() {
  return (
    <Suspense fallback={null}>
      <WallStudio />
    </Suspense>
  );
}
