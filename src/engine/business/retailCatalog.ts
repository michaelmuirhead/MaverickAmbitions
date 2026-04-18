/**
 * Retail family — 8 categories sharing the `retailBase.ts` engine.
 *
 * Each export is a ready-to-register BusinessTypeModule with its own
 * SKU catalog, rent, staffing, and per-category overlay (seasonality,
 * theft risk, perishability, returns).
 *
 * Progression ladder (by startup cost):
 *   florist       $55K
 *   bookstore     $75K
 *   clothing      $110K
 *   suit          $135K
 *   supermarket   $160K
 *   electronics   $180K
 *   furniture     $200K
 *   jewelry       $240K
 *
 * Each has a distinct flavor; all share the core tick loop. This is
 * where most of the v0.8 breadth comes from — one engine, eight UIs.
 */

import { dollars } from "@/lib/money";

import { makeRetailModule, type RetailCategoryConfig } from "./retailBase";

// ---------- Seasonality profiles ----------
// 12-month multiplier arrays (Jan..Dec). 1.0 = neutral.

const FLOWER_SEASONALITY = [
  0.9, // Jan
  1.6, // Feb — Valentine's
  1.0, // Mar
  1.1, // Apr — Easter
  1.5, // May — Mother's Day
  1.1, // Jun — weddings peak
  1.0, // Jul
  0.95, // Aug
  1.0, // Sep
  1.0, // Oct
  1.05, // Nov
  1.35, // Dec — holidays
];

const CLOTHING_SEASONALITY = [
  0.9, 0.9, 1.05, 1.1, 1.0, 0.95, 0.9, 1.1, 1.15, 1.0, 1.25, 1.5,
];
// Nov / Dec holidays drive clothing retail.

const SUIT_SEASONALITY = [
  0.8, 0.9, 1.0, 1.25, 1.35, 1.2, 1.0, 0.9, 1.2, 1.3, 1.15, 1.0,
];
// Wedding/graduation spring + prom + fall interview season.

const JEWELRY_SEASONALITY = [
  0.9, 1.7, 0.95, 0.95, 1.25, 1.05, 0.95, 0.9, 0.95, 1.0, 1.1, 1.65,
];
// Valentine's + Mother's Day + December engagements.

const FURNITURE_SEASONALITY = [
  1.1, 0.85, 0.95, 1.05, 1.1, 1.0, 1.05, 1.15, 1.0, 0.9, 1.2, 1.1,
];
// Spring move-in, Memorial Day / Labor Day sale humps.

// ---------- Bookstore ----------

const BOOKSTORE: RetailCategoryConfig = {
  id: "bookstore",
  label: "Bookstore",
  icon: "📚",
  startup: {
    startupCostCents: dollars(75_000),
    minimumCreditScore: 600,
    unlocksAt: { netWorthCents: dollars(50_000) },
  },
  rentMultiplier: 1.1,
  visitRateMul: 0.75, // lower impulse rate than a corner store
  elasticityBias: 0.85, // readers are somewhat price-tolerant on niche titles
  stockLabel: "Catalog Depth",
  startingCash: dollars(7_000),
  startingStaffCount: 2,
  weeklyEventTrafficBump: 0.04, // author-night flavor
  skus: [
    { id: "hardcover",    name: "Hardcover New Release", cost: 1500, price: 3200, restockBatch: 40, popularity: 1.1 },
    { id: "paperback",    name: "Paperback Fiction",     cost: 600,  price: 1800, restockBatch: 80, popularity: 1.3 },
    { id: "classic",      name: "Classic / Backlist",    cost: 500,  price: 1400, restockBatch: 60, popularity: 0.9 },
    { id: "kids",         name: "Kids' Picture Book",    cost: 700,  price: 1700, restockBatch: 50, popularity: 1.0 },
    { id: "cookbook",     name: "Cookbook",              cost: 1100, price: 2900, restockBatch: 30, popularity: 0.7 },
    { id: "magazine",     name: "Magazine",              cost: 150,  price: 650,  restockBatch: 100, popularity: 0.8 },
    { id: "rare",         name: "Rare / Signed",         cost: 4500, price: 12000, restockBatch: 5,  popularity: 0.4 },
    { id: "stationery",   name: "Stationery",            cost: 200,  price: 750,  restockBatch: 60,  popularity: 0.8 },
  ],
};

// ---------- Electronics ----------

const ELECTRONICS: RetailCategoryConfig = {
  id: "electronics_store",
  label: "Electronics Store",
  icon: "📱",
  startup: {
    startupCostCents: dollars(180_000),
    minimumCreditScore: 640,
    unlocksAt: { netWorthCents: dollars(120_000) },
  },
  rentMultiplier: 1.6,
  visitRateMul: 0.95,
  elasticityBias: 1.15, // shoppers comparison-shop hard
  startingCash: dollars(18_000),
  startingStaffCount: 3,
  wageMultiplier: 1.15,
  theftChancePerHour: 0.015,
  avgTheftLoss: dollars(600),
  returnRate: 0.05,
  skus: [
    { id: "phone_flagship", name: "Flagship Smartphone",  cost: 60000, price: 109000, restockBatch: 12, popularity: 1.0 },
    { id: "phone_mid",      name: "Mid-range Phone",      cost: 25000, price: 45000,  restockBatch: 20, popularity: 1.2 },
    { id: "laptop",         name: "Laptop",               cost: 75000, price: 129000, restockBatch: 10, popularity: 0.9 },
    { id: "tv",             name: "4K TV",                cost: 45000, price: 82000,  restockBatch: 8,  popularity: 0.7 },
    { id: "headphones",     name: "Wireless Headphones",  cost: 5000,  price: 15000,  restockBatch: 30, popularity: 1.3 },
    { id: "tablet",         name: "Tablet",               cost: 30000, price: 55000,  restockBatch: 12, popularity: 0.8 },
    { id: "accessory",      name: "Charger / Cable",      cost: 200,   price: 1500,   restockBatch: 100, popularity: 1.5 },
    { id: "gaming_console", name: "Gaming Console",       cost: 35000, price: 59000,  restockBatch: 8,  popularity: 0.85 },
  ],
};

// ---------- Florist ----------

const FLORIST: RetailCategoryConfig = {
  id: "florist",
  label: "Florist",
  icon: "💐",
  startup: {
    startupCostCents: dollars(55_000),
    minimumCreditScore: 600,
    unlocksAt: { netWorthCents: dollars(30_000) },
  },
  rentMultiplier: 1.0,
  visitRateMul: 1.0,
  stockLabel: "Fresh Stock",
  startingCash: dollars(6_000),
  startingStaffCount: 2,
  wageMultiplier: 0.95,
  perishable: true,
  seasonality: FLOWER_SEASONALITY,
  skus: [
    { id: "roses_dozen",    name: "Roses (dozen)",        cost: 1500, price: 5500, restockBatch: 40, popularity: 1.5 },
    { id: "arrangement_sm", name: "Small Arrangement",    cost: 800,  price: 2800, restockBatch: 30, popularity: 1.1 },
    { id: "arrangement_lg", name: "Large Arrangement",    cost: 2500, price: 8500, restockBatch: 15, popularity: 0.6 },
    { id: "bouquet",        name: "Mixed Bouquet",        cost: 600,  price: 2200, restockBatch: 50, popularity: 1.3 },
    { id: "wedding",        name: "Wedding Order",        cost: 8000, price: 22000, restockBatch: 8, popularity: 0.3 },
    { id: "succulent",      name: "Potted Plant",         cost: 500,  price: 1800, restockBatch: 40, popularity: 0.9 },
  ],
};

// ---------- Supermarket ----------

const SUPERMARKET: RetailCategoryConfig = {
  id: "supermarket",
  label: "Supermarket",
  icon: "🛒",
  startup: {
    startupCostCents: dollars(160_000),
    minimumCreditScore: 620,
    unlocksAt: { netWorthCents: dollars(120_000) },
  },
  rentMultiplier: 2.2, // big-box footprint
  visitRateMul: 1.4, // huge natural draw
  elasticityBias: 1.3, // price-driven
  stockLabel: "Shelf Fill",
  startingCash: dollars(16_000),
  startingStaffCount: 5,
  wageMultiplier: 0.9,
  perishable: true,
  theftChancePerHour: 0.008,
  avgTheftLoss: dollars(120),
  skus: [
    { id: "produce",     name: "Produce (lb)",         cost: 120, price: 260,  restockBatch: 400, popularity: 1.4 },
    { id: "dairy",       name: "Dairy",                cost: 180, price: 340,  restockBatch: 300, popularity: 1.3 },
    { id: "meat",        name: "Meat / Poultry",       cost: 450, price: 850,  restockBatch: 150, popularity: 1.1 },
    { id: "bakery",      name: "Bakery",               cost: 150, price: 400,  restockBatch: 200, popularity: 1.1 },
    { id: "frozen",      name: "Frozen Meal",          cost: 250, price: 560,  restockBatch: 180, popularity: 1.0 },
    { id: "beverage",    name: "Beverage",             cost: 100, price: 280,  restockBatch: 250, popularity: 1.2 },
    { id: "household",   name: "Household Supply",     cost: 200, price: 540,  restockBatch: 150, popularity: 0.9 },
    { id: "snack",       name: "Snack / Candy",        cost: 75,  price: 220,  restockBatch: 250, popularity: 1.1 },
  ],
};

// ---------- Jewelry ----------

const JEWELRY: RetailCategoryConfig = {
  id: "jewelry_store",
  label: "Jewelry Store",
  icon: "💎",
  startup: {
    startupCostCents: dollars(240_000),
    minimumCreditScore: 680,
    unlocksAt: { netWorthCents: dollars(180_000) },
  },
  rentMultiplier: 1.8,
  visitRateMul: 0.35, // heavily considered purchase
  elasticityBias: 0.7, // luxury — price matters less than brand/quality
  startingCash: dollars(22_000),
  startingStaffCount: 3,
  wageMultiplier: 1.25,
  theftChancePerHour: 0.004,
  avgTheftLoss: dollars(1_800),
  seasonality: JEWELRY_SEASONALITY,
  skus: [
    { id: "ring_eng",    name: "Engagement Ring",  cost: 180000, price: 350000, restockBatch: 6,  popularity: 0.8 },
    { id: "wedding_set", name: "Wedding Set",      cost: 120000, price: 240000, restockBatch: 8,  popularity: 0.7 },
    { id: "necklace",    name: "Diamond Necklace", cost: 80000,  price: 160000, restockBatch: 10, popularity: 1.0 },
    { id: "bracelet",    name: "Bracelet",         cost: 25000,  price: 55000,  restockBatch: 20, popularity: 1.1 },
    { id: "earrings",    name: "Earrings",         cost: 12000,  price: 28000,  restockBatch: 30, popularity: 1.3 },
    { id: "watch",       name: "Luxury Watch",     cost: 120000, price: 240000, restockBatch: 6,  popularity: 0.6 },
    { id: "repair",      name: "Repair Service",   cost: 500,    price: 3500,   restockBatch: 60, popularity: 1.4 },
  ],
};

// ---------- Clothing retail ----------

const CLOTHING: RetailCategoryConfig = {
  id: "clothing_retail",
  label: "Clothing Store",
  icon: "👕",
  startup: {
    startupCostCents: dollars(110_000),
    minimumCreditScore: 620,
    unlocksAt: { netWorthCents: dollars(80_000) },
  },
  rentMultiplier: 1.5,
  visitRateMul: 1.1,
  elasticityBias: 1.1,
  startingCash: dollars(12_000),
  startingStaffCount: 3,
  wageMultiplier: 1.0,
  returnRate: 0.08,
  seasonality: CLOTHING_SEASONALITY,
  skus: [
    { id: "tee",      name: "T-Shirt",          cost: 600,  price: 2200, restockBatch: 80, popularity: 1.3 },
    { id: "jeans",    name: "Jeans",            cost: 1800, price: 6500, restockBatch: 50, popularity: 1.2 },
    { id: "dress",    name: "Dress",            cost: 2500, price: 9500, restockBatch: 40, popularity: 1.0 },
    { id: "jacket",   name: "Jacket",           cost: 3500, price: 12500, restockBatch: 30, popularity: 0.9 },
    { id: "hoodie",   name: "Hoodie",           cost: 1500, price: 5500, restockBatch: 60, popularity: 1.2 },
    { id: "accessory",name: "Accessory",        cost: 400,  price: 1800, restockBatch: 100, popularity: 1.1 },
    { id: "shoes",    name: "Shoes",            cost: 2800, price: 8500, restockBatch: 50, popularity: 1.1 },
  ],
};

// ---------- Suit store ----------

const SUIT: RetailCategoryConfig = {
  id: "suit_store",
  label: "Men's Suit Shop",
  icon: "🕴️",
  startup: {
    startupCostCents: dollars(135_000),
    minimumCreditScore: 640,
    unlocksAt: { netWorthCents: dollars(100_000) },
  },
  rentMultiplier: 1.4,
  visitRateMul: 0.45,
  elasticityBias: 0.9,
  startingCash: dollars(14_000),
  startingStaffCount: 3,
  wageMultiplier: 1.2,
  returnRate: 0.03,
  seasonality: SUIT_SEASONALITY,
  skus: [
    { id: "suit_entry", name: "Entry Suit",     cost: 12000, price: 34000, restockBatch: 25, popularity: 1.2 },
    { id: "suit_mid",   name: "Mid Suit",       cost: 25000, price: 62000, restockBatch: 20, popularity: 1.0 },
    { id: "suit_hi",    name: "Premium Suit",   cost: 55000, price: 129000, restockBatch: 10, popularity: 0.6 },
    { id: "shirt",      name: "Dress Shirt",    cost: 1500,  price: 5500,  restockBatch: 60, popularity: 1.3 },
    { id: "tie",        name: "Tie / Bow Tie",  cost: 600,   price: 2800,  restockBatch: 80, popularity: 1.1 },
    { id: "shoes",      name: "Dress Shoes",    cost: 4500,  price: 13500, restockBatch: 30, popularity: 0.9 },
    { id: "tailoring",  name: "Tailoring Service", cost: 800, price: 4500, restockBatch: 50, popularity: 1.1 },
  ],
};

// ---------- Furniture ----------

const FURNITURE: RetailCategoryConfig = {
  id: "furniture_store",
  label: "Furniture Showroom",
  icon: "🛋️",
  startup: {
    startupCostCents: dollars(200_000),
    minimumCreditScore: 640,
    unlocksAt: { netWorthCents: dollars(150_000) },
  },
  rentMultiplier: 2.0, // big showroom
  visitRateMul: 0.30,
  elasticityBias: 0.8,
  startingCash: dollars(20_000),
  startingStaffCount: 4,
  wageMultiplier: 1.1,
  returnRate: 0.04,
  seasonality: FURNITURE_SEASONALITY,
  skus: [
    { id: "sofa",         name: "Sofa",               cost: 65000,  price: 149000, restockBatch: 8,  popularity: 1.0 },
    { id: "sectional",    name: "Sectional",          cost: 110000, price: 249000, restockBatch: 5,  popularity: 0.7 },
    { id: "dining",       name: "Dining Set",         cost: 85000,  price: 189000, restockBatch: 6,  popularity: 0.8 },
    { id: "bed",          name: "Bed / Mattress",     cost: 60000,  price: 139000, restockBatch: 10, popularity: 1.1 },
    { id: "coffee_table", name: "Coffee Table",       cost: 15000,  price: 38000,  restockBatch: 15, popularity: 1.0 },
    { id: "chair_accent", name: "Accent Chair",       cost: 20000,  price: 45000,  restockBatch: 12, popularity: 0.9 },
    { id: "rug",          name: "Area Rug",           cost: 9000,   price: 25000,  restockBatch: 20, popularity: 1.0 },
    { id: "lamp",         name: "Lamp",               cost: 4000,   price: 12000,  restockBatch: 30, popularity: 1.1 },
  ],
};

// ---------- Exports ----------

export const bookstoreModule = makeRetailModule(BOOKSTORE);
export const electronicsStoreModule = makeRetailModule(ELECTRONICS);
export const floristModule = makeRetailModule(FLORIST);
export const supermarketModule = makeRetailModule(SUPERMARKET);
export const jewelryStoreModule = makeRetailModule(JEWELRY);
export const clothingRetailModule = makeRetailModule(CLOTHING);
export const suitStoreModule = makeRetailModule(SUIT);
export const furnitureStoreModule = makeRetailModule(FURNITURE);
