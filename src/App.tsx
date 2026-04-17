import { createHashRouter, RouterProvider } from "react-router-dom";

import { HomePage } from "@/routes/HomePage";
import { NewGamePage } from "@/routes/NewGamePage";
import { GameLayout } from "@/routes/GameLayout";
import { DashboardPage } from "@/routes/DashboardPage";
import { BusinessPage } from "@/routes/BusinessPage";
import { MarketPage } from "@/routes/MarketPage";
import { FinancePage } from "@/routes/FinancePage";
import { FamilyPage } from "@/routes/FamilyPage";
import { RivalsPage } from "@/routes/RivalsPage";
import { SettingsPage } from "@/routes/SettingsPage";

// HashRouter keeps deep-links (#/dashboard, #/business, ...) working on any
// dumb static host — GitHub Pages, S3, Cloudflare Pages, Vercel — with no
// server-side rewrite config. The in-game pages share a single GameLayout
// parent route that renders the responsive nav shell + <Outlet/>.
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
      { path: "/family", element: <FamilyPage /> },
      { path: "/rivals", element: <RivalsPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
