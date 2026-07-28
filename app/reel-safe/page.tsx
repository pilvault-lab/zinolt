import { Suspense } from "react";
import { ReelSafeForm } from "./_components/ReelSafeForm";

export default function ReelSafePage() {
  return (
    <Suspense fallback={null}>
      <ReelSafeForm />
    </Suspense>
  );
}
