import { Suspense } from "react";
import { BillboardStudio } from "./_components/BillboardStudio";

export default function BillboardPage() {
  return (
    <Suspense>
      <BillboardStudio />
    </Suspense>
  );
}
