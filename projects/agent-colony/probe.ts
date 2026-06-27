// Headless probe for the pheromone trail mechanism. Run: bun probe.ts
// Optional param overrides via env, e.g. TRAILDECAY=0.997 PHDECAY=0.995 bun probe.ts
import { PheromoneVolume } from "./pheromone";
import { createAgents, updateAgents, STATE_FORAGING, STATE_RETURNING } from "./ants";
import { PARAMS } from "./params";

const ov = (k: string, p: keyof typeof PARAMS) => {
  const v = process.env[k];
  if (v !== undefined) (PARAMS as any)[p] = parseFloat(v);
};
ov("TRAILDECAY", "trailDecay");
ov("PHDECAY", "pheromoneDecay");
ov("HOMEDEP", "homeDeposit");
ov("FOODDEP", "foodDeposit");
ov("VISION", "visionRadius");
ov("BLURMIX", "blurMix");
ov("FOLLOW", "followThreshold");
ov("WANDER", "wander");

const GRID = 32, CUBE = PARAMS.cubeSize, HALF = CUBE / 2;
const toGrid = (w: number) => (w + HALF) * (GRID / CUBE);
const home = new PheromoneVolume(GRID), food = new PheromoneVolume(GRID);
const nest = { x: -8, y: 4, z: -8 };
const foods = [{ x: 12, y: 4, z: 12, radius: PARAMS.foodRadius, value: 1e9, capacity: 1e9 }];
let agents = createAgents(PARAMS.antCount, nest.x, nest.y, nest.z);
let pickups = 0, deliveries = 0;
const stats = (f: any) => { const g = f.grid; let m = 0, s = 0; for (let i = 0; i < g.length; i++) { if (g[i] > m) m = g[i]; s += g[i]; } return { max: +m.toFixed(4), mean: +(s / g.length).toFixed(5) }; };
const prof = (f: any) => [0, .25, .5, .75, 1].map(t => { const wx = nest.x + (foods[0].x - nest.x) * t, wy = nest.y + (foods[0].y - nest.y) * t, wz = nest.z + (foods[0].z - nest.z) * t; return f.get(toGrid(wx), toGrid(wy), toGrid(wz)).toFixed(4); }).join("  ");

console.log(`trailDecay=${PARAMS.trailDecay} pheromoneDecay=${PARAMS.pheromoneDecay} vision=${PARAMS.visionRadius}`);
for (let s = 1; s <= 6000; s++) {
  const prev = agents.map(a => a.state);
  updateAgents(agents, home, food, foods as any, nest.x, nest.y, nest.z, CUBE);
  home.step(PARAMS.pheromoneDecay, PARAMS.blurMix); food.step(PARAMS.pheromoneDecay, PARAMS.blurMix);
  for (let i = 0; i < agents.length; i++) { if (prev[i] === STATE_FORAGING && agents[i].state === STATE_RETURNING) pickups++; if (prev[i] === STATE_RETURNING && agents[i].state === STATE_FORAGING) deliveries++; }
  if (s % 1000 === 0) {
    const fr = agents.filter(a => a.state === STATE_FORAGING).length;
    console.log(`step ${s}  foraging=${fr} returning=${agents.length - fr}  pickups=${pickups} deliveries=${deliveries}`);
    console.log(`  HOME ${JSON.stringify(stats(home))}  FOOD ${JSON.stringify(stats(food))}`);
    console.log(`  HOME ${prof(home)}  (want high→low)`);
    console.log(`  FOOD ${prof(food)}  (want low→high)`);
    pickups = 0; deliveries = 0;
  }
}
