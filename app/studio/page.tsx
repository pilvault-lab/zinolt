import { Suspense } from "react";
import { Studio } from "./_components/Studio";

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <Studio />
    </Suspense>
  );
}
