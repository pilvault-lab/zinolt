import Image from "next/image";
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
        <Image
          src={BRAND.iconSrc}
          alt=""
          aria-hidden
          width={28}
          height={28}
          priority
          style={{ borderRadius: 6, display: "block" }}
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
