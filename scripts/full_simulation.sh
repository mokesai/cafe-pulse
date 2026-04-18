#! /bin/bash

SIMULATION_MODE=true npx tsx scripts/cleanup-simulation.ts
SIMULATION_MODE=true npx tsx scripts/seed-drink-ingredients.ts
npx tsx scripts/seed-drink-products.ts
npx tsx scripts/seed-sim-recipes.ts
SIMULATION_MODE=true npx tsx scripts/simulate-operations.ts
SIMULATION_MODE=true npx tsx scripts/simulate-sales.ts
SIMULATION_MODE=true npx tsx scripts/close-cogs-periods.ts
npx tsx scripts/validate-simulation.ts


