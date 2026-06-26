import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";
import { TEMPLATES } from "@/lib/templates";
import { Header } from "./_components/Header";

export default function Home() {
  return (
    <div
      className="flex min-h-screen flex-col md:h-screen md:min-h-0 md:overflow-hidden bg-ds-surface text-ds-on-surface"
    >
      <Header />

      <main className="flex flex-1 flex-col items-center px-6 md:min-h-0">
        {/* Hero — spacing-token vertical rhythm. */}
        <section className="mx-auto max-w-2xl text-center pt-(--ds-space-xl) pb-(--ds-space-lg) md:pt-20 md:pb-(--ds-space-md)">
          <h1
            className="type-display-serif text-5xl leading-[1.05] tracking-tight"
            style={{ color: BRAND.colors.ink }}
          >
            Present art in motion.
          </h1>
          <p className="type-body-lg mt-(--ds-space-md) text-ds-on-surface-muted">
            Drop in a piece, pick a treatment, export a clean 9:16 reel.
            <br />
            No editing.
          </p>
        </section>

        {/* Template grid */}
        <section className="grid w-full max-w-5xl grid-cols-1 gap-(--ds-space-md) md:min-h-0 md:flex-1 md:grid-cols-3 pb-(--ds-space-lg)">
          {TEMPLATES.map((t) => (
            <Card
              key={t.id}
              className="flex flex-col gap-(--ds-space-sm) p-5 md:min-h-0 md:gap-(--ds-space-sm) md:p-4"
            >
              <div className="flex flex-col items-center gap-(--ds-space-xs)">
                <h2 className="type-headline-md">{t.label}</h2>
                <span
                  className="type-label-sm rounded-ds-full px-2 py-0.5 text-[11px] uppercase tracking-wider"
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
                  className="w-full overflow-hidden rounded-ds-md aspect-[9/16] md:h-full md:w-auto"
                  style={{ backgroundColor: "#000" }}
                >
                  {/\.(png|jpe?g|webp|avif|svg)$/i.test(t.preview) ? (
                    <img
                      src={t.preview}
                      alt={t.label}
                      className="block h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      src={t.preview}
                      muted
                      autoPlay
                      loop
                      playsInline
                      className="block h-full w-full object-cover"
                      suppressHydrationWarning
                    />
                  )}
                </div>
              </div>
              <Button
                asChild
                variant="pill-primary"
                size="pill"
                className="w-full"
              >
                <Link href={t.href ?? `/studio?template=${t.id}`}>
                  Add your art →
                </Link>
              </Button>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
