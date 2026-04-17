"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav-items";

/**
 * iPhone-primary bottom tab bar. Only renders on phone bucket.
 * Uses iOS-style safe-area padding.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-6 max-w-screen-sm mx-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-full py-2 text-[10px] font-medium",
                  active ? "text-accent" : "text-ink-400 hover:text-ink-100",
                )}
              >
                <span aria-hidden className="text-lg leading-none">
                  {item.icon}
                </span>
                <span>{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
