// ─── Simulation Parameters ─────────────────────────────────────────────────

export interface SimParams {
  antCount: number;
  /** World units travelled per simulation step. */
  speed: number;
  /** Near-sight perception distance (world units). Agents can only "see"
   *  food / nest within this radius — outside it they rely on pheromone trails. */
  visionRadius: number;
  /** Pheromone sampling distance (grid cells) when reading the gradient. */
  senseRadius: number;
  /** Random heading jitter applied each step (radians-ish blend factor). */
  wander: number;
  /** Per-step multiplier applied to every pheromone cell (evaporation). */
  pheromoneDecay: number;
  /** Strength of the HOME trail laid by outbound foragers. */
  homeDeposit: number;
  /** Strength of the FOOD trail laid by returning carriers. */
  foodDeposit: number;
  /** Per-step falloff of an agent's own trail strength as it travels from
   *  its last anchor (nest or food) — produces a gradient that points back. */
  trailDecay: number;
  nestRadius: number;
  foodRadius: number;
  cubeSize: number;
  /** Opacity/thickness of the volumetric cloud (0 = off). */
  cloudDensity: number;
}

export const PARAMS: SimParams = {
  antCount: 400,
  speed: 0.14,
  visionRadius: 7,
  senseRadius: 2.0,
  wander: 0.32,
  pheromoneDecay: 0.985,
  homeDeposit: 0.2,
  foodDeposit: 0.2,
  trailDecay: 0.985,
  nestRadius: 2.5,
  foodRadius: 3,
  cubeSize: 50,
  cloudDensity: 0.95,
};
