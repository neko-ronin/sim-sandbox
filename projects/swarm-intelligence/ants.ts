// ─── 3D Ant Agent — stigmergic foraging ────────────────────────────────────
// Agents are near-sighted: they can only *see* food or the nest within
// `visionRadius`. Beyond that they navigate by two pheromone fields, exactly
// like real ants (stigmergy):
//
//   • Outbound FORAGERS lay a HOME trail and climb the FOOD trail to find food.
//   • Returning CARRIERS lay a FOOD trail and climb the HOME trail to get back.
//
// Each agent's own deposit strength decays as it travels from its last anchor
// (nest or food), so each field forms a gradient that points back to its
// source. Followers performing gradient-ascent are therefore funnelled toward
// the source — no agent ever needs global knowledge of where anything is.

import { PheromoneVolume } from "./pheromone";
import { PARAMS } from "./params";

export const STATE_FORAGING = 0; // searching for food, carrying nothing
export const STATE_RETURNING = 1; // carrying food back to the nest

export interface Agent3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: number;
  /** Remaining deposit strength, [0..1], reset to 1 at each anchor. */
  trail: number;
  /** Resource units this agent is carrying back to the nest (0 when foraging). */
  carrying: number;
  /** Body facing direction (smoothed velocity, lags behind actual vx/vy/vz). */
  smoothVx: number;
  smoothVy: number;
  smoothVz: number;
  /** Dot protrusion [0..1] — how far the leading-edge dot extends beyond the body surface. */
  protrusion: number;
}

export interface FoodSource3D {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Remaining resource units. Drained on pickup; food is deleted at 0. */
  value: number;
  /** Starting value, kept for the size-vs-state ratio. */
  capacity: number;
}

const GRID = 32; // must match the PheromoneVolume resolution in main.ts

/** Uniform random point on the unit sphere (Marsaglia). */
function randDir(out: { x: number; y: number; z: number }): void {
  let x: number, y: number, s: number;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    s = x * x + y * y;
  } while (s >= 1 || s === 0);
  const f = 2 * Math.sqrt(1 - s);
  out.x = x * f;
  out.y = y * f;
  out.z = 1 - 2 * s;
}

export function createAgents(count: number, nx: number, ny: number, nz: number): Agent3D[] {
  const agents: Agent3D[] = [];
  const d = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    randDir(d);
    const r = Math.random() * 2;
    agents.push({
      x: nx + d.x * r,
      y: ny + d.y * r,
      z: nz + d.z * r,
      vx: d.x,
      vy: d.y,
      vz: d.z,
      state: STATE_FORAGING, // everyone starts outbound from the nest
      trail: 1,
      carrying: 0,
      smoothVx: d.x,
      smoothVy: d.y,
      smoothVz: d.z,
      protrusion: 0,
    });
  }
  return agents;
}

// Scratch objects reused across the whole update to avoid per-agent allocation.
const _sample = { x: 0, y: 0, z: 0 };

/**
 * Sample a forward-biased cone of directions and return the unit vector that
 * points toward the highest concentration in `field`. `(gx,gy,gz)` is the
 * agent position in grid space; `(hx,hy,hz)` its current unit heading.
 * Returns the peak concentration found (so the caller can ignore empty space).
 */
function senseGradient(
  field: PheromoneVolume,
  gx: number, gy: number, gz: number,
  hx: number, hy: number, hz: number,
  senseR: number,
  best: { x: number; y: number; z: number },
): number {
  let bestVal = -1;
  best.x = hx; best.y = hy; best.z = hz;
  for (let j = 0; j < 7; j++) {
    randDir(_sample);
    // Bias toward current heading for coherent, non-jittery motion.
    let dx = hx * 0.55 + _sample.x * 0.45;
    let dy = hy * 0.55 + _sample.y * 0.45;
    let dz = hz * 0.55 + _sample.z * 0.45;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const v = field.get(gx + dx * senseR, gy + dy * senseR, gz + dz * senseR);
    if (v > bestVal) {
      bestVal = v;
      best.x = dx; best.y = dy; best.z = dz;
    }
  }
  return bestVal;
}

export function updateAgents(
  agents: Agent3D[],
  homeField: PheromoneVolume,
  foodField: PheromoneVolume,
  foodSources: FoodSource3D[],
  nestX: number,
  nestY: number,
  nestZ: number,
  cubeSize: number,
): void {
  const half = cubeSize / 2;
  const toGrid = GRID / cubeSize; // world units → grid cells
  const speed = PARAMS.speed;
  const senseR = PARAMS.senseRadius;
  const wander = PARAMS.wander;
  const vision2 = PARAMS.visionRadius * PARAMS.visionRadius;
  const nestR = PARAMS.nestRadius;
  const trailDecay = PARAMS.trailDecay;
  const followThreshold = PARAMS.followThreshold;
  const wallM = half - 0.5;

  const grad = { x: 0, y: 0, z: 0 };
  const wd = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    let { x, y, z, vx, vy, vz } = a;

    // Keep heading normalised.
    let len = Math.hypot(vx, vy, vz);
    if (len < 1e-4) { randDir(wd); vx = wd.x; vy = wd.y; vz = wd.z; len = 1; }
    vx /= len; vy /= len; vz /= len;

    const gx = (x + half) * toGrid;
    const gy = (y + half) * toGrid;
    const gz = (z + half) * toGrid;

    // Steering target this step (defaults to current heading).
    let tx = vx, ty = vy, tz = vz;
    let steer = 0; // blend weight toward target [0..1]

    if (a.state === STATE_FORAGING) {
      // Lay the HOME trail so we (and others) can navigate back. Strongest
      // near the nest, fading as we wander — this *is* the gradient home.
      homeField.add(gx, gy, gz, PARAMS.homeDeposit * a.trail);

      // ── Near-sight: can we SEE a food source? ──
      let seenDx = 0, seenDy = 0, seenDz = 0, seenBest = vision2;
      for (let f = 0; f < foodSources.length; f++) {
        const fs = foodSources[f];
        if (fs.value <= 0) continue; // don't chase a spent source
        const dx = fs.x - x, dy = fs.y - y, dz = fs.z - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < seenBest) { seenBest = d2; seenDx = dx; seenDy = dy; seenDz = dz; }
      }
      if (seenBest < vision2) {
        const l = Math.sqrt(seenBest) || 1;
        tx = seenDx / l; ty = seenDy / l; tz = seenDz / l;
        steer = 0.5; // lock on
      } else {
        // Can't see food — climb the FOOD trail left by successful carriers.
        const peak = senseGradient(foodField, gx, gy, gz, vx, vy, vz, senseR, grad);
        if (peak > followThreshold) {
          tx = grad.x; ty = grad.y; tz = grad.z;
          steer = 0.3;
        }
      }
    } else {
      // ── Returning: lay the FOOD trail (strongest at the food). ──
      foodField.add(gx, gy, gz, PARAMS.foodDeposit * a.trail);

      const dx = nestX - x, dy = nestY - y, dz = nestZ - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < vision2) {
        // Near-sight: nest is in view, head straight for it.
        const l = Math.sqrt(d2) || 1;
        tx = dx / l; ty = dy / l; tz = dz / l;
        steer = 0.6;
      } else {
        // Out of sight — climb the HOME trail back toward the nest.
        const peak = senseGradient(homeField, gx, gy, gz, vx, vy, vz, senseR, grad);
        if (peak > followThreshold) {
          tx = grad.x; ty = grad.y; tz = grad.z;
          steer = 0.35;
        }
      }
    }

    // Steer toward target, then add random wander for exploration.
    vx += (tx - vx) * steer;
    vy += (ty - vy) * steer;
    vz += (tz - vz) * steer;
    randDir(wd);
    vx += wd.x * wander;
    vy += wd.y * wander;
    vz += wd.z * wander;

    len = Math.hypot(vx, vy, vz) || 1;
    vx /= len; vy /= len; vz /= len;

    // Protrusion: dot extends when turning. Compute from angle between
    // the body's smoothed facing and the actual velocity.
    const smLen = Math.hypot(a.smoothVx, a.smoothVy, a.smoothVz) || 1;
    const dotDir = (a.smoothVx * vx + a.smoothVy * vy + a.smoothVz * vz) / smLen;
    a.protrusion += (Math.max(0, 1 - dotDir) * 1.5 - a.protrusion) * 0.15;
    a.protrusion = Math.min(1, Math.max(0, a.protrusion));

    // Integrate.
    x += vx * speed;
    y += vy * speed;
    z += vz * speed;

    // Bounce off the cube walls (keeps trails continuous, unlike wrapping).
    if (x > wallM) { x = wallM; vx = -Math.abs(vx); }
    else if (x < -wallM) { x = -wallM; vx = Math.abs(vx); }
    if (y > wallM) { y = wallM; vy = -Math.abs(vy); }
    else if (y < -wallM) { y = -wallM; vy = Math.abs(vy); }
    if (z > wallM) { z = wallM; vz = -Math.abs(vz); }
    else if (z < -wallM) { z = -wallM; vz = Math.abs(vz); }

    // Trail strength fades the longer it's been since the last anchor.
    a.trail *= trailDecay;

    // ── State transitions ──
    if (a.state === STATE_FORAGING) {
      for (let f = 0; f < foodSources.length; f++) {
        const fs = foodSources[f];
        if (fs.value <= 0) continue; // already spent — main will delete it
        const dx = x - fs.x, dy = y - fs.y, dz = z - fs.z;
        if (dx * dx + dy * dy + dz * dz < fs.radius * fs.radius) {
          // Resource transfer event: value leaves the food, onto the ant.
          const amount = Math.min(PARAMS.foodTransfer, fs.value);
          fs.value -= amount;
          a.carrying = amount;
          a.state = STATE_RETURNING; // teal → orange
          a.trail = 1;               // anchor the FOOD trail here
          break;
        }
      }
    } else {
      const dx = x - nestX, dy = y - nestY, dz = z - nestZ;
      if (dx * dx + dy * dy + dz * dz < nestR * nestR) {
        a.carrying = 0;            // delivered to the colony
        a.state = STATE_FORAGING;  // orange → teal
        a.trail = 1;               // anchor the HOME trail here
      }
    }

    a.x = x; a.y = y; a.z = z;
    a.vx = vx; a.vy = vy; a.vz = vz;
  }
}
