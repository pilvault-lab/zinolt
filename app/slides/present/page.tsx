import { Suspense } from "react";
import { PresenterView } from "./PresenterView";

export default function PresenterPage() {
  return (
    <Suspense fallback={null}>
      <PresenterView />
    </Suspense>
  );
}
