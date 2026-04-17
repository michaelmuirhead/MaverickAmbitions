import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A grid that naturally goes 1 column on phone, 2 on tablet, 3 on
 * desktop. Works with any card-style children.
 */
export function ContentGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
