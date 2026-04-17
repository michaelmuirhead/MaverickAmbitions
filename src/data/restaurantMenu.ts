/**
 * Restaurant menu catalog. Cents.
 *
 * Restaurants differ from cafes in two ways: (1) covers are table-based,
 * not cup-based, so the unit economics are per-cover not per-item, and
 * (2) drinks (beer/wine) matter — a beer-and-wine carve-out is a huge
 * margin lever. We model a handful of archetypal dishes so the UI has
 * something to show, but the sim itself works off a "menu mix" weighted
 * average cost + price.
 */

import type { Cents } from "@/types/game";

export type DishId =
  | "appetizer"
  | "soup_salad"
  | "pasta"
  | "chicken"
  | "burger"
  | "fish"
  | "steak"
  | "dessert"
  | "beer"
  | "wine_glass"
  | "soft_drink";

export type DishCategory = "starter" | "main" | "dessert" | "beverage";

export interface DishDef {
  id: DishId;
  category: DishCategory;
  /** Ingredient / prep cost at 'bistro' program. Diner ≈ 0.8×, chef-driven ≈ 1.4×. */
  baseCost: Cents;
  /** Menu price at 'bistro' program. */
  basePrice: Cents;
  /** Weighted popularity — sums across category should roughly equal 1. */
  popularity: number;
  /** Seconds on the line for a mid-skill cook. Pulls table turn time. */
  lineSeconds: number;
}

export const RESTAURANT_MENU: DishDef[] = [
  { id: "appetizer",   category: "starter",  baseCost: 220, basePrice: 900,  popularity: 0.4, lineSeconds: 300 },
  { id: "soup_salad",  category: "starter",  baseCost: 180, basePrice: 800,  popularity: 0.3, lineSeconds: 180 },
  { id: "pasta",       category: "main",     baseCost: 420, basePrice: 1800, popularity: 0.25, lineSeconds: 500 },
  { id: "chicken",     category: "main",     baseCost: 520, basePrice: 2200, popularity: 0.2, lineSeconds: 600 },
  { id: "burger",      category: "main",     baseCost: 380, basePrice: 1700, popularity: 0.18, lineSeconds: 420 },
  { id: "fish",        category: "main",     baseCost: 680, basePrice: 2600, popularity: 0.12, lineSeconds: 650 },
  { id: "steak",       category: "main",     baseCost: 950, basePrice: 3800, popularity: 0.1, lineSeconds: 750 },
  { id: "dessert",     category: "dessert",  baseCost: 180, basePrice: 850,  popularity: 0.3, lineSeconds: 120 },
  { id: "beer",        category: "beverage", baseCost: 110, basePrice: 650,  popularity: 0.4, lineSeconds: 15 },
  { id: "wine_glass",  category: "beverage", baseCost: 240, basePrice: 1100, popularity: 0.5, lineSeconds: 10 },
  { id: "soft_drink",  category: "beverage", baseCost: 40,  basePrice: 350,  popularity: 0.3, lineSeconds: 10 },
];

export const DISH_LABELS: Record<DishId, string> = {
  appetizer: "Appetizer",
  soup_salad: "Soup or Salad",
  pasta: "Pasta",
  chicken: "Chicken Plate",
  burger: "Burger",
  fish: "Fish",
  steak: "Steak",
  dessert: "Dessert",
  beer: "Beer",
  wine_glass: "Wine by the Glass",
  soft_drink: "Soft Drink",
};
