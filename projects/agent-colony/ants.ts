// ─── 3D Agent ──────────────────────────────────────────────────────────────
// Agents move freely through 3D space.  Foragers random-walk with bias toward
// pheromone gradients.  Returners steer to nest while depositing trail.

import { PheromoneVolume } from "./pheromone";
import { PARAMS } from "./params";

export const STATE_FORAGING = 0;
export const STATE_RETURNING = 1;

export interface Agent3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: number;
}

export interface FoodSource3D {
  x: number;
  y: number;
  z: number;
  radius: number;
}

const HALF = 25; // cube half-size (world units mapped to grid 0..32)
const GRID_TO_WORLD = 32 / (HALF * 2); // 0.64 — grid cells per world unit
const WORLD_TO_GRID = (HALF * 2) / 32; // ~1.5625 — world units per grid cell

function worldToGrid(w: number): number {
  return (w + HALF) / WORLD_TO_GRID;
}

function wrap(v: number): number {
  if (v < -HALF) return HALF - (-HALF - v);
  if (v > HALF) return -HALF + (v - HALF);
  return v;
}

export function createAgents(count: number, nx: number, ny: number, nz: number): Agent3D[] {
  const agents: Agent3D[] = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.random() * 3;
    agents.push({
      x: nx + Math.cos(theta) * Math.sin(phi) * r,
      y: ny + Math.sin(theta) * Math.sin(phi) * r,
      z: nz + Math.cos(phi) * r,
      vx: Math.random() - 0.5,
      vy: Math.random() - 0.5,
      vz: Math.random() - 0.5,
      state: Math.random() < 0.5 ? STATE_FORAGING : STATE_RETURNING,
    });
  }
  return agents;
}

export function updateAgents(
  agents: Agent3D[],
  pheromones: PheromoneVolume,
  foodSources: FoodSource3D[],
  nestX: number,
  nestY: number,
  nestZ: number,
  cubeSize: number,
): void {
  const half = cubeSize / 2;
  const speed = PARAMS.speed;
  const senseR = PARAMS.senseRadius;
  const turnRate = PARAMS.turnRate;
  const deposit = PARAMS.depositAmount;
  const nestR = PARAMS.nestRadius;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    let { x, y, z, vx, vy, vz } = a;

    // Normalise velocity
    let len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (len < 0.001) {
      vx = Math.random() - 0.5;
      vy = Math.random() - 0.5;
      vz = Math.random() - 0.5;
      len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    vx /= len;
    vy /= len;
    vz /= len;

    if (a.state === STATE_FORAGING) {
      // ── Sense pheromone gradient in 3D ──
      const gx = worldToGrid(x);
      const gy = worldToGrid(y);
      const gz = worldToGrid(z);

      // Sample a cone of directions around current heading in 3D
      let bestP = -Infinity;
      let bestVx = vx;
      let bestVy = vy;
      let bestVz = vz;

      for (let j = 0; j < 8; j++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = (Math.random() - 0.5) * Math.PI * 0.6; // ±54° cone

        // Rotate the base heading by theta around vertical, then by phi
        const svx = vx * Math.cos(phi) + (vy * Math.cos(theta) + vz * Math.sin(theta)) * Math.sin(phi);
        const svy = vy * Math.cos(phi) + (-vx * Math.cos(theta) + vz * Math.sin(theta)) * Math.sin(phi); // simplified rotation
        const svz = vz * Math.cos(phi) - (vx * Math.sin(theta) - vy * Math.cos(theta)) * Math.sin(phi); // another approx
        
        // Simpler approach: just sample random directions
        const st = Math.random() * Math.PI * 2;
        const sp = Math.acos(2 * Math.random() - 1);
        const sx = gx + Math.cos(st) * Math.sin(sp) * senseR;
        const sy = gy + Math.sin(st) * Math.sin(sp) * senseR;
        const sz = gz + Math.cos(sp) * senseR;
        const p = pheromones.get(sx, sy, sz);
        if (p > bestP) {
          bestP = p;
          const dx = sx - gx;
          const dy = sy - gy;
          const dz = sz - gz;
          const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dl > 0.001) {
            bestVx = dx / dl;
            bestVy = dy / dl;
            bestVz = dz / dl;
          }
        }
      }

      if (bestP > 0.01) {
        // Blend toward pheromone direction
        vx += (bestVx - vx) * 0.2;
        vy += (bestVy - vy) * 0.2;
        vz += (bestVz - vz) * 0.2;
      }

      // Random jitter
      vx += (Math.random() - 0.5) * turnRate * 0.5;
      vy += (Math.random() - 0.5) * turnRate * 0.5;
      vz += (Math.random() - 0.5) * turnRate * 0.5;

      // Re-normalise
      len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (len > 0.001) {
        vx /= len;
        vy /= len;
        vz /= len;
      }

      x += vx * speed;
      y += vy * speed;
      z += vz * speed;

      // Wrap within cube
      x = wrap(x);
      y = wrap(y);
      z = wrap(z);

      // Check for food
      for (const f of foodSources) {
        const dx = x - f.x;
        const dy = y - f.y;
        const dz = z - f.z;
        if (dx * dx + dy * dy + dz * dz < f.radius * f.radius) {
          a.state = STATE_RETURNING;
          break;
        }
      }
    } else {
      // ── Returning: deposit pheromone, steer to nest ──
      pheromones.add(worldToGrid(x), worldToGrid(y), worldToGrid(z), deposit);

      const dx = nestX - x;
      const dy = nestY - y;
      const dz = nestZ - z;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl > 0.001) {
        // Steer toward nest
        vx += (dx / dl - vx) * 0.08;
        vy += (dy / dl - vy) * 0.08;
        vz += (dz / dl - vz) * 0.08;
      }

      // Jitter
      vx += (Math.random() - 0.5) * 0.3;
      vy += (Math.random() - 0.5) * 0.3;
      vz += (Math.random() - 0.5) * 0.3;

      len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (len > 0.001) {
        vx /= len;
        vy /= len;
        vz /= len;
      }

      x += vx * speed;
      y += vy * speed;
      z += vz * speed;

      x = wrap(x);
      y = wrap(y);
      z = wrap(z);

      // Reached nest?
      const ndx = x - nestX;
      const ndy = y - nestY;
      const ndz = z - nestZ;
      if (ndx * ndx + ndy * ndy + ndz * ndz < nestR * nestR) {
        a.state = STATE_FORAGING;
      }
    }

    a.x = x;
    a.y = y;
    a.z = z;

    // Store normalised velocity
    len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (len > 0.001) {
      a.vx = vx / len;
      a.vy = vy / len;
      a.vz = vz / len;
    } else {
      a.vx = 0;
      a.vy = 0;
      a.vz = 0;
    }
  }
}
