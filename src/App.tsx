import { createHashRouter, RouterProvider } from "react-router-dom";

import { HomePage } from "@/routes/HomePage";
import { NewGamePage } from "@/routes/NewGamePage";
import { GameLayout } from "@/routes/GameLayout";
import { DashboardPage } from "@/routes/DashboardPage";
import { BusinessPage } from "@/routes/BusinessPage";
import { MarketPage } from "@/routes/MarketPage";
import { FinancePage } from "@/routes/FinancePage";
import { RivalsPage } from "@/routes/RivalsPage";
import { FamilyPage } from "@/routes/FamilyPage";
import { SettingsPage } from "@/routes/SettingsPage";

/**
 * Router setup. We use HashRouter (not BrowserRouter) so that a plain
 * static host — GitHub Pages, S3, `vite preview`, nginx with no
 * rewrite rules — serves deep links like `#/dashboard` correctly on
 * refresh. No deploy-time URL-rewrite config needed anywhere.
 *
 * The `(game)` layout group from the Next App Router becomes a parent
 * route that renders a `GameLayout` containing the `<Outlet />`.
 */
const router = createHashRouter([
  { path: "/", element: <HomePage /> },
  { path: "/new-game", element: <NewGamePage /> },
  {
    element: <GameLayout />,
    children: [
      { path: "/dashboard", element: <DashboardPage /> },
      { path: "/business", element: <BusinessPage /> },
      { path: "/market", element: <MarketPage /> },
      { path: "/finance", element: <FinancePage /> },
      { path: "/rivals", element: <RivalsPage /> },
      { path: "/family", element: <FamilyPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
