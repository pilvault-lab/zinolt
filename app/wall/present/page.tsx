import { Suspense } from "react";
import { WallPresenter } from "./WallPresenter";

export default function WallPresentPage() {
  return (
    <Suspense fallback={null}>
      <WallPresenter />
    </Suspense>
  );
}
