/**
 * Registry of business-type modules.
 *
 * Adding a new industry = create a module in this folder and register
 * it here. The rest of the game reads via `getBusinessModule(type)`.
 */

import type { BusinessTypeId } from "@/types/game";

import { barModule } from "./bar";
import { cafeModule } from "./cafe";
import { cinemaModule } from "./cinema";
import { constructionModule } from "./construction";
import { foodTruckModule } from "./foodTruck";
import { gamingStudioModule } from "./gamingStudio";
import { hospitalClinicModule } from "./hospitalClinic";
import { militaryTechModule } from "./militaryTech";
import { movieStudioModule } from "./movieStudio";
import { nightclubModule } from "./nightclub";
import { oilGasModule } from "./oilGas";
import { pizzaShopModule } from "./pizzaShop";
import { realEstateFirmModule } from "./realEstateFirm";
import { restaurantModule } from "./restaurant";
import { cornerStoreModule } from "./retail";
import {
  bookstoreModule,
  clothingRetailModule,
  electronicsStoreModule,
  floristModule,
  furnitureStoreModule,
  jewelryStoreModule,
  suitStoreModule,
  supermarketModule,
} from "./retailCatalog";
import { techStartupModule } from "./techStartup";
import type { BusinessTypeModule } from "./types";

const registry: Partial<Record<BusinessTypeId, BusinessTypeModule>> = {
  // Food & hospitality
  corner_store: cornerStoreModule,
  cafe: cafeModule,
  bar: barModule,
  restaurant: restaurantModule,
  food_truck: foodTruckModule,
  pizza_shop: pizzaShopModule,
  nightclub: nightclubModule,

  // Retail family
  bookstore: bookstoreModule,
  electronics_store: electronicsStoreModule,
  florist: floristModule,
  supermarket: supermarketModule,
  jewelry_store: jewelryStoreModule,
  clothing_retail: clothingRetailModule,
  suit_store: suitStoreModule,
  furniture_store: furnitureStoreModule,

  // Entertainment
  cinema: cinemaModule,
  movie_studio: movieStudioModule,

  // Project-based / knowledge work
  tech_startup: techStartupModule,
  gaming_studio: gamingStudioModule,
  construction: constructionModule,

  // Services
  hospital_clinic: hospitalClinicModule,
  real_estate_firm: realEstateFirmModule,

  // Heavy industry
  oil_gas: oilGasModule,
  military_tech: militaryTechModule,
};

export function getBusinessModule(type: BusinessTypeId): BusinessTypeModule {
  const mod = registry[type];
  if (!mod) {
    throw new Error(
      `Business type '${type}' is not yet implemented. Register a module in engine/business/registry.ts.`,
    );
  }
  return mod;
}

export function getAvailableBusinessTypes(): BusinessTypeId[] {
  return Object.keys(registry) as BusinessTypeId[];
}

/**
 * Hierarchical grouping for UI. Keeps the MarketPage button grid
 * scannable now that there are 20+ business types.
 */
export const BUSINESS_TYPE_CATEGORIES: Array<{
  label: string;
  types: BusinessTypeId[];
}> = [
  {
    label: "Food & Hospitality",
    types: ["corner_store", "cafe", "bar", "restaurant", "pizza_shop", "food_truck", "nightclub"],
  },
  {
    label: "Retail",
    types: [
      "bookstore",
      "electronics_store",
      "florist",
      "supermarket",
      "jewelry_store",
      "clothing_retail",
      "suit_store",
      "furniture_store",
    ],
  },
  {
    label: "Entertainment",
    types: ["cinema", "movie_studio"],
  },
  {
    label: "Services",
    types: ["hospital_clinic", "real_estate_firm"],
  },
  {
    label: "Project-based",
    types: ["tech_startup", "gaming_studio", "construction"],
  },
  {
    label: "Heavy Industry",
    types: ["oil_gas", "military_tech"],
  },
];
