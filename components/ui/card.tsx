import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — Linear-spec surface primitive.
 * - Raised surface (white in the warm palette; flips dark under future
 *   .dark-chrome scope)
 * - 1px hairline border, rgba(10,10,10,0.08)
 * - 8px radius (rounded-ds-md)
 * - No elevation by default — depth is implied by the border
 *
 * Pass `padding="content"` for the spec's 0/24/28 inner padding, or
 * `padding="comfortable"` for an even 24px on all sides, or omit and
 * style padding yourself.
 */
type Props = React.HTMLAttributes<HTMLDivElement> & {
  padding?: "none" | "content" | "comfortable";
};

export const Card = React.forwardRef<HTMLDivElement, Props>(
  function Card({ className, padding = "none", style, ...rest }, ref) {
    return (
      <div
        ref={ref}
        data-slot="card"
        className={cn(
          "bg-ds-surface-raised text-ds-on-surface rounded-ds-md border border-ds-border-hairline",
          padding === "content" && "px-6 pt-0 pb-7",
          padding === "comfortable" && "p-6",
          className,
        )}
        style={style}
        {...rest}
      />
    );
  },
);
