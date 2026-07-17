import { Suspense } from "react";
import { TweetVideoStudio } from "./_components/TweetVideoStudio";

export default function TweetVideoPage() {
  return (
    <Suspense fallback={null}>
      <TweetVideoStudio />
    </Suspense>
  );
}
