import { Suspense } from "react";
import { FrostedStudio } from "./_components/FrostedStudio";

export default function FrostedPage() {
  return (
    <Suspense fallback={null}>
      <FrostedStudio />
    </Suspense>
  );
}
