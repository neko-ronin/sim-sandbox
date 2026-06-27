// ─── Simulation Parameters ─────────────────────────────────────────────────

export interface SimParams {
  antCount: number;
  speed: number;
  senseRadius: number;
  turnRate: number;
  pheromoneDecay: number;
  depositAmount: number;
  nestRadius: number;
  foodRadius: number;
  cubeSize: number;
}

export const PARAMS: SimParams = {
  antCount: 400,
  speed: 0.05,
  senseRadius: 2.5,
  turnRate: 0.5,
  pheromoneDecay: 0.96,
  depositAmount: 0.15,
  nestRadius: 2.5,
  foodRadius: 3,
  cubeSize: 50,
};
