export interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: "📊" },
  { href: "/business", label: "Business", shortLabel: "Biz", icon: "🏪" },
  { href: "/market", label: "Market", shortLabel: "Market", icon: "🗺️" },
  { href: "/finance", label: "Finance", shortLabel: "Finance", icon: "🏦" },
  { href: "/rivals", label: "Rivals", shortLabel: "Rivals", icon: "⚔️" },
  { href: "/family", label: "Family", shortLabel: "Family", icon: "👪" },
  { href: "/settings", label: "Settings", shortLabel: "More", icon: "⚙️" },
];
