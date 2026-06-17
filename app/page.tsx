import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { TEMPLATES } from "@/lib/templates";
import { Header } from "./_components/Header";

export default function Home() {
  return (
    <div
      className="flex min-h-screen flex-col md:h-screen md:min-h-0 md:overflow-hidden"
      style={{ backgroundColor: BRAND.colors.paper }}
    >
      <Header />

      <main className="flex flex-1 flex-col items-center px-6 py-12 md:min-h-0 md:py-6">
        {/* Hero */}
        <section className="mx-auto max-w-2xl text-center">
          <h1
            className="font-display text-5xl leading-[1.05] tracking-tight"
            style={{ color: BRAND.colors.ink }}
          >
            Present art in motion.
          </h1>
          <p
            className="mt-4 font-sans text-base"
            style={{ color: BRAND.colors.grey500 }}
          >
            Drop in a piece, pick a treatment, export a clean 9:16 reel.
            <br />
            No editing.
          </p>
        </section>

        {/* Template cards */}
        <section className="mt-10 grid w-full max-w-5xl grid-cols-1 gap-6 md:mt-6 md:min-h-0 md:flex-1 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <article
              key={t.id}
              className="flex flex-col gap-4 rounded-xl p-5 md:min-h-0 md:gap-3 md:p-4"
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
                  {t.label}
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
              <div className="flex justify-center md:min-h-0 md:flex-1">
                <div
                  className="w-full overflow-hidden rounded-lg aspect-[9/16] md:h-full md:w-auto"
                  style={{ backgroundColor: "#000" }}
                >
                  <video
                    src={t.preview}
                    muted
                    autoPlay
                    loop
                    playsInline
                    className="block h-full w-full object-cover"
                  />
                </div>
              </div>
              <Button asChild className="w-full rounded-full font-sans">
                <Link href={`/studio?template=${t.id}`}>Add your art →</Link>
              </Button>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
