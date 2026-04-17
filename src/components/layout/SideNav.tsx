"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav-items";

/**
 * Side nav used on iPad and Desktop. Real multi-column layout — not
 * the iPhone tab bar stretched sideways.
 */
export function SideNav({ expanded = false }: { expanded?: boolean }) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "sticky top-0 h-screen border-r border-ink-800 bg-ink-950",
        expanded ? "w-60" : "w-20",
      )}
    >
      <div className="flex flex-col h-full">
        <div className="px-4 py-5">
          <div className="text-accent font-bold tracking-tight text-base leading-tight">
            Maverick
          </div>
          {expanded && (
            <div className="text-ink-400 text-xs mt-0.5">Ambitions</div>
          )}
        </div>
        <ul className="flex-1 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    active
                      ? "bg-ink-800 text-accent"
                      : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-50",
                  )}
                >
                  <span aria-hidden className="text-xl leading-none">
                    {item.icon}
                  </span>
                  {expanded && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
