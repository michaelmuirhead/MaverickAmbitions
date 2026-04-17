"use client";

import type { ReactNode } from "react";

import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useGameTick } from "@/hooks/useGameTick";

import { BottomNav } from "./BottomNav";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";

/**
 * The single source of truth for app chrome.
 *
 * Three distinct layouts:
 *  - phone   — top bar + bottom nav, single column
 *  - tablet  — side nav + main column, no bottom nav
 *  - desktop — expanded side nav + main column (wider max width)
 *
 * The body `children` never changes — it's the content block. This
 * shell picks the right navigation arrangement. That way opening the
 * app on iPad or Desktop gives a real multi-column layout, not a
 * centered phone strip.
 */
export function ResponsiveShell({ children }: { children: ReactNode }) {
  const bucket = useBreakpoint();
  useGameTick();

  if (bucket === "phone") {
    return (
      <div className="min-h-screen">
        <TopBar bucket="phone" />
        <main className="px-3 sm:px-5 pt-3 pb-28 max-w-screen-sm mx-auto">
          {children}
        </main>
        <BottomNav />
      </div>
    );
  }

  if (bucket === "tablet") {
    return (
      <div className="min-h-screen grid grid-cols-[5rem_minmax(0,1fr)]">
        <SideNav expanded={false} />
        <div>
          <TopBar bucket="tablet" />
          <main className="px-6 py-6 max-w-5xl">{children}</main>
        </div>
      </div>
    );
  }

  // desktop
  return (
    <div className="min-h-screen grid grid-cols-[15rem_minmax(0,1fr)]">
      <SideNav expanded />
      <div>
        <TopBar bucket="desktop" />
        <main className="px-8 py-8 max-w-[1600px]">{children}</main>
      </div>
    </div>
  );
}
