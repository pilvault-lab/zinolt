import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const Header: React.FC<{ right?: React.ReactNode }> = ({ right }) => {
  return (
    <header
      className="flex shrink-0 items-center justify-between px-6"
      style={{
        backgroundColor: BRAND.colors.paper,
        borderBottom: `1px solid ${BRAND.colors.grey200}`,
        height: 64,
      }}
    >
      <Link href="/" className="flex items-center gap-2 no-underline">
        <span
          aria-hidden
          style={{
            width: 16,
            height: 16,
            backgroundColor: BRAND.colors.ink,
            borderRadius: 3,
            display: "inline-block",
          }}
        />
        <span
          className="font-display text-2xl tracking-tight"
          style={{ color: BRAND.colors.ink }}
        >
          zinolt
        </span>
      </Link>
      {right}
    </header>
  );
};
