// ─── Simulation Parameters (shared config) ─────────────────────────────────
// Exported as a mutable singleton so the debug panel can adjust them live.

export interface SimParams {
  antCount: number;
  speed: number;
  senseRadius: number;
  turnRate: number;
  pheromoneDecay: number;
  depositAmount: number;
  nestRadius: number;
  foodRadius: number;
}

export const PARAMS: SimParams = {
  antCount: 400,
  speed: 1.2,
  senseRadius: 2,
  turnRate: 0.45,
  pheromoneDecay: 0.97,
  depositAmount: 0.12,
  nestRadius: 3,
  foodRadius: 4,
};
