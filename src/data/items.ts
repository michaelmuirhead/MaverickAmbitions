/**
 * Starter SKUs for the corner store. Cents.
 */

import type { Cents } from "@/types/game";

export type SkuId =
  | "cola_12oz"
  | "water_bottle"
  | "chips_snack"
  | "candy_bar"
  | "energy_drink"
  | "cigarettes"
  | "lottery_ticket"
  | "bread_loaf"
  | "milk_gallon"
  | "ice_cream_pint"
  | "batteries_aa"
  | "gum_pack"
  | "instant_coffee"
  | "ramen_pack"
  | "detergent_pod"
  | "coffee_cup"
  | "snack_mix"
  | "soda_2l"
  | "jerky"
  | "paper_towel";

export interface SkuDef {
  id: SkuId;
  category: string;
  baseCost: Cents;
  basePrice: Cents;
  initialStock: number;
}

export const STARTER_SKUS: SkuDef[] = [
  { id: "cola_12oz", category: "drinks", baseCost: 45, basePrice: 175, initialStock: 120 },
  { id: "water_bottle", category: "drinks", baseCost: 30, basePrice: 150, initialStock: 120 },
  { id: "chips_snack", category: "snacks", baseCost: 80, basePrice: 250, initialStock: 80 },
  { id: "candy_bar", category: "snacks", baseCost: 50, basePrice: 175, initialStock: 100 },
  { id: "energy_drink", category: "drinks", baseCost: 125, basePrice: 325, initialStock: 60 },
  { id: "cigarettes", category: "tobacco", baseCost: 650, basePrice: 1125, initialStock: 40 },
  { id: "lottery_ticket", category: "lottery", baseCost: 180, basePrice: 200, initialStock: 200 },
  { id: "bread_loaf", category: "essentials", baseCost: 150, basePrice: 399, initialStock: 30 },
  { id: "milk_gallon", category: "essentials", baseCost: 275, basePrice: 549, initialStock: 25 },
  { id: "ice_cream_pint", category: "snacks", baseCost: 260, basePrice: 599, initialStock: 30 },
  { id: "batteries_aa", category: "essentials", baseCost: 225, basePrice: 699, initialStock: 20 },
  { id: "gum_pack", category: "snacks", baseCost: 40, basePrice: 175, initialStock: 80 },
  { id: "instant_coffee", category: "essentials", baseCost: 520, basePrice: 899, initialStock: 15 },
  { id: "ramen_pack", category: "essentials", baseCost: 65, basePrice: 199, initialStock: 80 },
  { id: "detergent_pod", category: "essentials", baseCost: 450, basePrice: 799, initialStock: 15 },
  { id: "coffee_cup", category: "drinks", baseCost: 85, basePrice: 325, initialStock: 60 },
  { id: "snack_mix", category: "snacks", baseCost: 95, basePrice: 275, initialStock: 45 },
  { id: "soda_2l", category: "drinks", baseCost: 110, basePrice: 325, initialStock: 40 },
  { id: "jerky", category: "snacks", baseCost: 275, basePrice: 599, initialStock: 30 },
  { id: "paper_towel", category: "essentials", baseCost: 235, basePrice: 549, initialStock: 20 },
];

export const SKU_LABELS: Record<SkuId, string> = {
  cola_12oz: "Cola (12oz)",
  water_bottle: "Water (bottle)",
  chips_snack: "Chips",
  candy_bar: "Candy Bar",
  energy_drink: "Energy Drink",
  cigarettes: "Cigarettes",
  lottery_ticket: "Lottery Ticket",
  bread_loaf: "Bread Loaf",
  milk_gallon: "Milk (gallon)",
  ice_cream_pint: "Ice Cream (pint)",
  batteries_aa: "Batteries (AA)",
  gum_pack: "Gum",
  instant_coffee: "Instant Coffee",
  ramen_pack: "Ramen",
  detergent_pod: "Detergent Pods",
  coffee_cup: "Coffee",
  snack_mix: "Snack Mix",
  soda_2l: "Soda (2L)",
  jerky: "Jerky",
  paper_towel: "Paper Towels",
};
