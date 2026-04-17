import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

import { ResponsiveShell } from "@/components/layout/ResponsiveShell";
import { Tutorial } from "@/components/game/Tutorial";

import { useGameStore } from "@/state/store";

/**
 * Layout route for every /game screen. Hydrates from the autosave slot
 * on first mount; if no save exists, bounces back to the landing page.
 *
 * This is the Vite/React Router port of the former Next App Router
 * `src/app/(game)/layout.tsx`. Functionally identical — just uses
 * `useNavigate()` + `<Outlet />` instead of `useRouter()` + `children`.
 */
export function GameLayout() {
  const navigate = useNavigate();
  const game = useGameStore((s) => s.game);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!game) {
      const ok = loadSlot();
      if (!ok) {
        navigate("/", { replace: true });
        return;
      }
    }
    setHydrated(true);
  }, [game, loadSlot, navigate]);

  if (!hydrated || !game) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <ResponsiveShell>
      <Outlet />
      <Tutorial />
    </ResponsiveShell>
  );
}
