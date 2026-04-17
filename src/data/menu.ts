/**
 * Cafe menu items. Cents.
 *
 * Unlike the corner store's SKU list (packaged goods), cafe items have
 * a `craftCost` baseline that scales with the cafe's quality tier, and
 * a `prepSeconds` field that gates throughput when the line gets long.
 */

import type { Cents } from "@/types/game";

export type MenuItemId =
  | "drip_coffee"
  | "espresso"
  | "latte"
  | "cappuccino"
  | "cold_brew"
  | "matcha_latte"
  | "tea"
  | "croissant"
  | "muffin"
  | "bagel"
  | "panini"
  | "cookie";

export type MenuItemCategory = "drink" | "pastry" | "food";

export interface MenuItemDef {
  id: MenuItemId;
  category: MenuItemCategory;
  /** Wholesale / ingredient cost at 'craft' tier. Basic tier ≈ 0.75×, premium ≈ 1.35×. */
  baseCost: Cents;
  /** Suggested retail price at 'craft' tier. */
  basePrice: Cents;
  /** Daily par stock (units restocked each morning). */
  dailyPar: number;
  /** Seconds for a mid-skill barista to prep one. Gates throughput. */
  prepSeconds: number;
}

export const CAFE_MENU: MenuItemDef[] = [
  { id: "drip_coffee",   category: "drink",  baseCost: 40,  basePrice: 300,  dailyPar: 80, prepSeconds: 20 },
  { id: "espresso",      category: "drink",  baseCost: 55,  basePrice: 325,  dailyPar: 40, prepSeconds: 25 },
  { id: "latte",         category: "drink",  baseCost: 90,  basePrice: 525,  dailyPar: 60, prepSeconds: 60 },
  { id: "cappuccino",    category: "drink",  baseCost: 85,  basePrice: 500,  dailyPar: 50, prepSeconds: 55 },
  { id: "cold_brew",     category: "drink",  baseCost: 75,  basePrice: 525,  dailyPar: 40, prepSeconds: 15 },
  { id: "matcha_latte",  category: "drink",  baseCost: 120, basePrice: 600,  dailyPar: 30, prepSeconds: 65 },
  { id: "tea",           category: "drink",  baseCost: 25,  basePrice: 350,  dailyPar: 30, prepSeconds: 30 },
  { id: "croissant",     category: "pastry", baseCost: 110, basePrice: 425,  dailyPar: 30, prepSeconds: 5  },
  { id: "muffin",        category: "pastry", baseCost: 85,  basePrice: 375,  dailyPar: 30, prepSeconds: 5  },
  { id: "bagel",         category: "pastry", baseCost: 75,  basePrice: 350,  dailyPar: 25, prepSeconds: 15 },
  { id: "panini",        category: "food",   baseCost: 325, basePrice: 950,  dailyPar: 20, prepSeconds: 180 },
  { id: "cookie",        category: "pastry", baseCost: 50,  basePrice: 275,  dailyPar: 40, prepSeconds: 5  },
];

export const MENU_LABELS: Record<MenuItemId, string> = {
  drip_coffee: "Drip Coffee",
  espresso: "Espresso",
  latte: "Latte",
  cappuccino: "Cappuccino",
  cold_brew: "Cold Brew",
  matcha_latte: "Matcha Latte",
  tea: "Tea",
  croissant: "Croissant",
  muffin: "Muffin",
  bagel: "Bagel",
  panini: "Panini",
  cookie: "Cookie",
};
