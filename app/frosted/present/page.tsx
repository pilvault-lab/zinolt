import { Suspense } from "react";
import { FrostedPresenter } from "./FrostedPresenter";

export default function FrostedPresentPage() {
  return (
    <Suspense fallback={null}>
      <FrostedPresenter />
    </Suspense>
  );
}
