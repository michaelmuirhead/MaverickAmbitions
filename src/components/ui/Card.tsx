"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, subtitle, trailing, className, children }: CardProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-ink-800 bg-ink-900/70 shadow-card p-4 sm:p-5",
        className,
      )}
    >
      {(title || trailing) && (
        <header className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-ink-400 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
