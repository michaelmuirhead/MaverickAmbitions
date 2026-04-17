/**
 * Registry of business-type modules.
 *
 * Adding a new industry = create a module in this folder and register
 * it here. The rest of the game reads via `getBusinessModule(type)`.
 *
 * MVP registers only the corner store. Other types are listed as
 * TODO placeholders so it's obvious where to plug in.
 */

import type { BusinessTypeId } from "@/types/game";

import { barModule } from "./bar";
import { cafeModule } from "./cafe";
import { restaurantModule } from "./restaurant";
import { cornerStoreModule } from "./retail";
import type { BusinessTypeModule } from "./types";

const registry: Partial<Record<BusinessTypeId, BusinessTypeModule>> = {
  corner_store: cornerStoreModule,
  cafe: cafeModule,
  bar: barModule,
  restaurant: restaurantModule,
  // TODO: food_truck: foodTruckModule,
  // TODO: clothing_retail: clothingRetailModule,
  // TODO: tech_startup: techStartupModule,
  // TODO: gaming_studio: gamingStudioModule,
  // TODO: oil_gas: oilGasModule,
  // TODO: real_estate_firm: realEstateFirmModule,
  // TODO: military_tech: militaryTechModule,
  // TODO: sports_team: sportsTeamModule,
  // TODO: city: cityModule,
  // TODO: state: stateModule,
  // TODO: nation: nationModule,
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
