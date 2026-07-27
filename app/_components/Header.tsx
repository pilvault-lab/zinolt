import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const Header: React.FC<{ right?: React.ReactNode }> = ({ right }) => {
  return (
    <header
      className="flex shrink-0 items-center justify-between bg-ds-surface px-(--ds-space-md)"
      style={{
        borderBottom: `1px solid var(--ds-border-hairline)`,
        height: 64,
      }}
    >
      <div className="flex items-center gap-(--ds-space-md)">
        <Link
          href="/"
          className="flex items-center gap-(--ds-space-xs) no-underline"
        >
          <Image
            src={BRAND.iconSrc}
            alt=""
            aria-hidden
            width={26}
            height={26}
            priority
            style={{ borderRadius: 6, display: "block" }}
          />
          <span
            className="type-label-lg tracking-tight"
            style={{ color: BRAND.colors.ink }}
          >
            zinolt
          </span>
        </Link>
        <nav className="flex items-center gap-(--ds-space-sm)">
          <Link
            href="/wire"
            className="type-label-sm text-ds-on-surface-muted hover:text-ds-on-surface no-underline"
          >
            Wire
          </Link>
          <Link
            href="/sourcing"
            className="type-label-sm text-ds-on-surface-muted hover:text-ds-on-surface no-underline"
          >
            Sourcing
          </Link>
        </nav>
      </div>
      {right}
    </header>
  );
};
