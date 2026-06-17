import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { Header } from "./_components/Header";

export default function Home() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      {/* Hero */}
      <section className="px-6 pt-20 md:pt-32">
        <div className="mx-auto max-w-2xl">
          <h1
            className="font-display text-5xl leading-[1.05] tracking-tight md:text-6xl"
            style={{ color: BRAND.colors.ink }}
          >
            Present art in motion.
          </h1>
          <p
            className="mt-6 font-sans text-base md:text-lg"
            style={{ color: BRAND.colors.grey500 }}
          >
            Drop in a piece, pick a treatment, export a clean 9:16 reel.
            <br />
            No editing.
          </p>
        </div>
      </section>

      {/* Template cards */}
      <section className="px-6 pt-16 pb-24 md:pt-24">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
          {/* Card 1 — Light Ray */}
          <article
            className="flex flex-col gap-5 rounded-xl p-6"
            style={{
              backgroundColor: "#FFFFFF",
              border: `1px solid ${BRAND.colors.grey200}`,
            }}
          >
            <div className="flex flex-col items-center gap-2">
              <h2
                className="font-display text-2xl tracking-tight"
                style={{ color: BRAND.colors.ink }}
              >
                Light Ray
              </h2>
              <span
                className="rounded-full px-2 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wider"
                style={{
                  backgroundColor: BRAND.colors.ink,
                  color: BRAND.colors.paper,
                }}
              >
                Beta
              </span>
            </div>
            <div
              className="overflow-hidden rounded-lg"
              style={{ aspectRatio: "9 / 16", backgroundColor: "#000" }}
            >
              <video
                src="/rays/light-ray-white.mp4"
                muted
                autoPlay
                loop
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
            <Button asChild className="w-full rounded-full font-sans">
              <Link href="/studio">Add your art →</Link>
            </Button>
          </article>

          {/* Card 2 — Coming soon */}
          <article
            className="flex flex-col gap-5 rounded-xl p-6"
            style={{
              backgroundColor: "#FFFFFF",
              border: `1px solid ${BRAND.colors.grey200}`,
            }}
          >
            <div className="flex flex-col items-center gap-2">
              <h2
                className="font-display text-2xl tracking-tight"
                style={{ color: BRAND.colors.grey500 }}
              >
                Coming soon
              </h2>
              <span
                className="rounded-full px-2 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wider"
                style={{
                  backgroundColor: BRAND.colors.grey500,
                  color: BRAND.colors.paper,
                }}
              >
                Coming soon
              </span>
            </div>
            <div
              className="rounded-lg"
              style={{ aspectRatio: "9 / 16", backgroundColor: "#1F1F1F" }}
              aria-hidden
            />
            <Button disabled className="w-full rounded-full font-sans">
              Add your art
            </Button>
          </article>
        </div>
      </section>
    </div>
  );
}
