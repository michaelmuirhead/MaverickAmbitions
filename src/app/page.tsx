"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";

import { useGameStore } from "@/state/store";

/**
 * Landing / splash page. Auto-redirects to /dashboard if a save exists.
 */
export default function Home() {
  const router = useRouter();
  const loadSlot = useGameStore((s) => s.loadSlot);

  useEffect(() => {
    const ok = loadSlot();
    if (ok) router.replace("/dashboard");
  }, [loadSlot, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="max-w-md">
        <div className="text-accent text-sm font-semibold uppercase tracking-[0.2em] mb-2">
          Maverick
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-ink-50">
          Ambitions
        </h1>
        <p className="mt-4 text-ink-300 text-sm sm:text-base leading-relaxed">
          Start with a single corner store. Build an empire across industries.
          Marry, raise heirs, outlast your rivals — across generations.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/new-game" className="contents">
            <Button size="lg">New Game</Button>
          </Link>
          <Link href="/dashboard" className="contents">
            <Button size="lg" variant="secondary">
              Continue
            </Button>
          </Link>
        </div>
        <p className="mt-8 text-xs text-ink-500">v0.1 — architectural scaffold</p>
      </div>
    </main>
  );
}
