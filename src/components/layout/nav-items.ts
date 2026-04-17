import type { Route } from "next";

export interface NavItem {
  href: Route;
  label: string;
  shortLabel: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard" as Route, label: "Dashboard", shortLabel: "Home", icon: "📊" },
  { href: "/business" as Route, label: "Business", shortLabel: "Biz", icon: "🏪" },
  { href: "/market" as Route, label: "Market", shortLabel: "Market", icon: "🗺️" },
  { href: "/finance" as Route, label: "Finance", shortLabel: "Finance", icon: "🏦" },
  { href: "/rivals" as Route, label: "Rivals", shortLabel: "Rivals", icon: "⚔️" },
  { href: "/family" as Route, label: "Family", shortLabel: "Family", icon: "👪" },
  { href: "/settings" as Route, label: "Settings", shortLabel: "More", icon: "⚙️" },
];
