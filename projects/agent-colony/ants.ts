// ─── Ant Agent ─────────────────────────────────────────────────────────────
// 2D agent logic: foraging (random walk + pheromone gradient ascent) vs
// returning (steer to nest + deposit pheromone trail).

import { PheromoneGrid } from "./pheromone";

export const ANT_STATE_FORAGING = 0;
export const ANT_STATE_RETURNING = 1;

export interface AntAgent {
  x: number;
  y: number;
  angle: number;
  state: number; // 0 = foraging, 1 = returning
}

export interface FoodSource2D {
  x: number;
  y: number;
  radius: number;
}

export function createAnts(count: number, gridSize: number, nestX: number, nestY: number): AntAgent[] {
  const ants: AntAgent[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 3 * 0.8;
    ants.push({
      x: nestX + Math.cos(a) * r,
      y: nestY + Math.sin(a) * r,
      angle: Math.random() * Math.PI * 2,
      state: Math.random() < 0.5 ? ANT_STATE_FORAGING : ANT_STATE_RETURNING,
    });
  }
  return ants;
}

const SENSE_RADIUS = 2;     // grid cells
const TURN_RATE = 0.45;     // radians per frame
const SPEED = 1.2;          // grid cells per frame
const DEPOSIT_AMOUNT = 0.12;
const NEST_RADIUS = 3;      // grid cells

export function updateAnts(
  ants: AntAgent[],
  gridSize: number,
  pheromones: PheromoneGrid,
  foodSources: FoodSource2D[],
  nestX: number,
  nestY: number,
): void {
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    let { x, y, angle } = ant;
    const state = ant.state;

    if (state === ANT_STATE_FORAGING) {
      // ── Sense pheromone gradient ──
      let bestP = -Infinity;
      let bestA = angle;
      for (let da = -0.75; da <= 0.75; da += 0.375) {
        const sa = angle + da;
        const sx = x + Math.cos(sa) * SENSE_RADIUS;
        const sy = y + Math.sin(sa) * SENSE_RADIUS;
        const p = pheromones.get(sx, sy);
        if (p > bestP) {
          bestP = p;
          bestA = sa;
        }
      }

      if (bestP > 0.01) {
        angle += (bestA - angle) * 0.25;
      }
      angle += (Math.random() - 0.5) * TURN_RATE;

      x += Math.cos(angle) * SPEED;
      y += Math.sin(angle) * SPEED;

      // Wrap around world
      if (x < 0) x = gridSize;
      if (x > gridSize) x = 0;
      if (y < 0) y = gridSize;
      if (y > gridSize) y = 0;

      // Check for food
      for (const f of foodSources) {
        const dx = x - f.x;
        const dy = y - f.y;
        if (dx * dx + dy * dy < f.radius * f.radius) {
          ant.state = ANT_STATE_RETURNING;
          break;
        }
      }
    } else {
      // ── Returning: deposit pheromone, steer to nest ──
      pheromones.add(x, y, DEPOSIT_AMOUNT);

      const dx = nestX - x;
      const dy = nestY - y;
      const targetAngle = Math.atan2(dy, dx);

      let diff = targetAngle - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angle += diff * 0.15;
      angle += (Math.random() - 0.5) * 0.35;

      x += Math.cos(angle) * SPEED;
      y += Math.sin(angle) * SPEED;

      // Reached nest?
      const ndx = x - nestX;
      const ndy = y - nestY;
      if (ndx * ndx + ndy * ndy < NEST_RADIUS * NEST_RADIUS) {
        ant.state = ANT_STATE_FORAGING;
      }
    }

    ant.x = x;
    ant.y = y;
    ant.angle = angle;
  }
}
