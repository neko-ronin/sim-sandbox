# Pheromone Trail Mechanism — Diagnosis (handoff)

Status: **FIXED 2026-06-26.** The diagnosis below was confirmed and the
mechanism now works — the colony cycles in steady state. See the resolution
box immediately below; the original diagnosis is preserved underneath.

## ✅ Resolution (2026-06-26)

Four changes, all validated with `bun probe.ts`:

| # | Change | File |
|---|--------|------|
| 1 | `trailDecay` 0.985 → **0.997** (half-life ~6 → ~33 world units, so a deposit survives the full nest↔food trip and the field forms a gradient across the whole distance) | `params.ts` |
| 2 | Follow gate `peak > 0.02` → **`peak > followThreshold` (0.004)**, a new tunable param. The old gate was above mid-trail signal so following almost never fired | `params.ts`, `ants.ts` |
| 3 | Unified `add()` to the same integer-centred cell convention as `get()` (was offset by half a cell, smearing the gradient) | `pheromone.ts` |

Before → after (steady state, per 1000 steps):

```
              HOMEmax   deliveries   foraging/returning
shipped       ~1e-6     ~5-13        runs away 14→136 (pileup)
fixed         ~0.78     ~1040        stable ~200/200 (balanced cycle)
```

`deliveries ≈ pickups` holds indefinitely (no returner pileup), HOME profile is
high→low and FOOD low→high across the mid-trail stretch. The endpoint cells dip
slightly below mid-trail, which is harmless: both endpoints sit inside
`visionRadius=7`, so near-sight handles the final approach while the trail
carries the long haul (mid-trail cells at t=0.5 are ~14 units from either end,
far outside vision, and still navigate correctly — proving the trails, not
vision, do the work).

`visionRadius` was left at 7: it is the *discovery* radius (seeds the first FOOD
trail). Dropping it starves the bootstrap (nobody stumbles onto a radius-3 food
in a 50-unit cube) without changing the steady-state mechanism.

Repro harness committed as `probe.ts` (param overrides via env, e.g.
`TRAILDECAY=0.985 bun probe.ts` reproduces the original failure).

---

## Original diagnosis (preserved)

Status: **diagnosed, not yet fixed.** Written end of session 2026-06-26.
Investigated blind/fresh at the user's request; the user agreed this writeup is
the complete picture. Pick up here next session.

## TL;DR verdict

The dual-pheromone logic is wired to the **correct fields in the correct
directions**, but the trail mechanism is effectively **inert** — the ants
navigate almost entirely by short-range vision (`visionRadius=7`) + random
wander. Three things make the pheromones decorative, plus one minor bug:

1. **HOME field never forms** — `trailDecay` is far too aggressive, so the
   homing field stays at ~1e-6 and returners can't get home (they pile up).
   *This is the primary failure.*
2. **Sense threshold is mis-scaled** — steering only fires above `peak > 0.02`,
   but the fields rarely exceed ~0.02 except right at a source.
3. **Structural**: "deposit decays from source" makes each field weakest at the
   *origin* of the trip that needs it → gradient ascent only helps near the
   destination; prone to a returner-pileup / forager-starvation collapse.
4. **Minor**: `add()`/`get()` half-cell coordinate offset.

## How it was measured

`ants.ts` + `pheromone.ts` + `params.ts` are pure logic (no THREE), so they run
headless in Bun. Harness probes the fields directly. Reproduce with
`bun probe.ts` (script at the bottom of this file).

### Run 1 — shipped params (`trailDecay = 0.985`)

```
step 1000  foraging=379 returning=21   pickups=21 deliveries=0
  HOMEmax = 0.000001   FOODmax = 0.019
  HOME profile nest→food (t=0,.25,.5,.75,1): 0.0000 0.0000 0.0000 0.0000 0.0000
  FOOD profile:                              0.0001 0.0004 0.0015 0.0084 0.0122
step 2000  foraging=346 returning=54   pickups=35 deliveries=2
step 3000  foraging=325 returning=75   pickups=27 deliveries=6
step 4000  foraging=292 returning=108  pickups=37 deliveries=4
  HOMEmax = 0.004      FOODmax = 0.025
```

Reading the data:
- **HOMEmax ~1e-6** → homing field is dead. HOME profile is all zeros: returners
  have no gradient to follow home.
- **Returning count climbs 21→54→75→108 while deliveries stay ≈0** → returners
  are stranded, can't deliver. The colony never cycles. Smoking gun.
- FOOD direction is correct (low→high toward food) but **max ~0.02 ≈ the
  `0.02` follow-threshold**, so even FOOD-following barely fires except adjacent
  to the food.

### Run 2 — causal confirmation (`trailDecay = 0.999`, one constant changed)

```
step 1000  foraging=392 returning=8    pickups=22 deliveries=14
  HOMEmax = 0.62   FOODmax = 0.10
  HOME profile: 0.0740 0.0543 0.0369 0.0224 0.0146   (correct high→low!)
  FOOD profile: 0.0036 0.0079 0.0059 0.0057 0.0025
```

HOMEmax jumps `1e-6 → 0.62` with the correct nest-ward gradient, and deliveries
go `0 → 14`. **Proves the decay rate is what kills the HOME field.** (Note: by
step 3000–4000 returning still runs away to 243 — the structural issue #3 — so
slow decay alone is necessary but not sufficient.)

## Root causes in detail

### 1. `trail` decay half-life ≈ 6 world units (PRIMARY)
`ants.ts`: every step `a.trail *= PARAMS.trailDecay` (0.985). Half-life =
`ln2 / -ln(0.985) ≈ 46 steps`; at `speed=0.14` that's **~6.4 world units**. The
nest→food distance in the test is ~28 units, so a deposit is at ~5% strength by
the far end. A forager only lays meaningful HOME pheromone in a small bubble
around the nest, and only re-anchors `trail=1` by completing a round trip — but
round trips are rare at first (deliveries=0 for 1000 steps), so HOME never
builds. FOOD survives better only because returners re-anchor `trail=1` at the
food on *every* pickup and pickups are frequent.

### 2. Follow-threshold mismatch
`ants.ts` (both branches): `if (peak > 0.02) { steer... }`. Field magnitudes
live around 0.001–0.025, so this gate is almost never cleared off-source.
Either lower it substantially or normalize the fields.

### 3. Fields weakest at each trip's origin (structural)
"Decays from source" makes HOME weakest at the food (where homing starts) and
FOOD weakest at the nest (where hunting starts). Gradient ascent only helps near
the destination; the origin half of each trip is signal-poor → reliance on
wander → returner pileup feedback collapse.

### 4. `add()`/`get()` half-cell offset (minor)
`pheromone.ts`: `add()` centers on `floor(x - 0.5)`, `get()` on `floor(x)`.
Deposits and reads are misaligned by half a cell (~0.78 world units), smearing
the gradient. Pick one convention for both.

## Candidate fixes (next session — discuss before implementing)

- **Decouple the two roles of `trail`.** Direction info shouldn't come from
  per-agent deposit decay at all. Options:
  - Lay a **constant-strength** deposit and let *temporal evaporation +
    reinforcement* build the gradient (classic ACO), with the dual-field scheme
    giving direction. Tune `pheromoneDecay` / blur for a stable trail.
  - Or keep deposit-decay but make it **much** slower (≥0.997) AND seed homing
    so it doesn't depend on the first round trips.
- **Fix/auto-scale the sense threshold** (e.g., relative to field max, like the
  trail viz already auto-ranges) so following actually fires.
- **Make the `3×3×3` blur less aggressive** (it's a strong diffuser every frame
  in 3D) or run it every N frames, to keep gradients sharp.
- **Reconsider `visionRadius=7`** — it's currently doing the navigation the
  pheromones are supposed to do; lower it once trails work, or it'll keep
  masking the mechanism.
- **Unify `add`/`get` cell convention.**
- Validate every change by re-running `probe.ts` and watching: HOMEmax > ~0.05
  with a high→low profile, FOOD low→high, and **deliveries ≈ pickups** in
  steady state (no returner pileup).

## Repro harness (`bun probe.ts` from anywhere)

```ts
const DIR = "./projects/agent-colony";
const { PheromoneVolume } = await import(`${DIR}/pheromone.ts`);
const { createAgents, updateAgents, STATE_FORAGING, STATE_RETURNING } = await import(`${DIR}/ants.ts`);
const { PARAMS } = await import(`${DIR}/params.ts`);
// PARAMS.trailDecay = 0.999; // <- run 2

const GRID = 32, CUBE = PARAMS.cubeSize, HALF = CUBE / 2;
const toGrid = (w: number) => (w + HALF) * (GRID / CUBE);
const home = new PheromoneVolume(GRID), food = new PheromoneVolume(GRID);
const nest = { x: -8, y: 4, z: -8 };
const foods = [{ x: 12, y: 4, z: 12, radius: PARAMS.foodRadius, value: 1e9, capacity: 1e9 }];
let agents = createAgents(PARAMS.antCount, nest.x, nest.y, nest.z);
let pickups = 0, deliveries = 0;
const stats = (f: any) => { const g = f.grid; let m = 0, s = 0; for (let i = 0; i < g.length; i++) { if (g[i] > m) m = g[i]; s += g[i]; } return { max: m, mean: s / g.length }; };
const prof = (f: any) => [0, .25, .5, .75, 1].map(t => { const wx = nest.x + (foods[0].x - nest.x) * t, wy = nest.y + (foods[0].y - nest.y) * t, wz = nest.z + (foods[0].z - nest.z) * t; return f.get(toGrid(wx), toGrid(wy), toGrid(wz)).toFixed(4); }).join("  ");
for (let s = 1; s <= 4000; s++) {
  const prev = agents.map(a => a.state);
  updateAgents(agents, home, food, foods as any, nest.x, nest.y, nest.z, CUBE);
  home.step(PARAMS.pheromoneDecay); food.step(PARAMS.pheromoneDecay);
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
```

## Repo state at handoff

- On `main`. The **pheromone trail visualization** (auto-ranged amber→yellow
  glowing Points in `main.ts` + `updateTrail`) is **committed? NO — uncommitted**
  working-tree changes. Decide whether to commit the viz before or alongside the
  mechanism fix. (Everything before the trail viz — stigmergy rewrite, glass
  orbs, volumetric cloud, cloud-density slider, depletable food, nest glow — is
  committed: `d65641a` is the latest.)
- No code fix to the mechanism has been made yet — analysis only.
