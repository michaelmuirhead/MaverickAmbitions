"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ResponsiveShell } from "@/components/layout/ResponsiveShell";

import { useGameStore } from "@/state/store";

export default function GameGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const game = useGameStore((s) => s.game);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!game) {
      const ok = loadSlot();
      if (!ok) {
        router.replace("/");
        return;
      }
    }
    setHydrated(true);
  }, [game, loadSlot, router]);

  if (!hydrated || !game) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    );
  }

  return <ResponsiveShell>{children}</ResponsiveShell>;
}
