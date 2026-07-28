import { Suspense } from "react";
import { WireCarouselStudio } from "./_components/WireCarouselStudio";

export default function WireCarouselPage() {
  return (
    <Suspense fallback={null}>
      <WireCarouselStudio />
    </Suspense>
  );
}
