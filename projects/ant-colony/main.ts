// ─── Ant Colony Pheromone Simulation ───────────────────────────────────────
// 2D Canvas fallback (WebGL version is the planned upgrade).
// Core mechanic: ants forage by random walk + pheromone gradient ascent.
// Returning ants deposit pheromones.  Pheromones decay and diffuse each frame.

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsEl = document.getElementById("fps") as HTMLSpanElement;
const countEl = document.getElementById("count") as HTMLSpanElement;

// ─── Grid ──────────────────────────────────────────────────────────────────
const GRID_SIZE = 64; // pheromone grid resolution (logical)
const VISUAL_SIZE = 512; // rendering reference size

let width = 0;
let height = 0;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.onresize = resize;
resize();

// ─── Pheromone grid ────────────────────────────────────────────────────────
class PheromoneGrid {
  readonly grid: Float32Array;
  readonly blur: Float32Array;
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.grid = new Float32Array(w * h);
    this.blur = new Float32Array(w * h);
  }

  get(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return 0;
    return this.grid[iy * this.w + ix];
  }

  add(x: number, y: number, amount: number) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return;
    this.grid[iy * this.w + ix] = Math.min(1, this.grid[iy * this.w + ix] + amount);
  }

  /** Decay + blur (3×3 box blur) in one pass into `blur`, then swap. */
  step(decay: number) {
    const { w, h, grid, blur } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
              sum += grid[cy * w + cx];
              n++;
            }
          }
        }
        // blur then decay
        blur[y * w + x] = (sum / n) * decay;
      }
    }
    // swap
    const tmp = this.grid;
    (this as { grid: Float32Array }).grid = blur;
    (this as { blur: Float32Array }).blur = tmp;
  }
}

const pheromones = new PheromoneGrid(GRID_SIZE, GRID_SIZE);

// ─── Ants ──────────────────────────────────────────────────────────────────
const ANT_COUNT = 400;
const SPEED = 1.2;
const SENSE_RADIUS = 1.5; // grid cells
const TURN_RATE = 0.4; // radians per step

const antsX = new Float32Array(ANT_COUNT);
const antsY = new Float32Array(ANT_COUNT);
const antsAngle = new Float32Array(ANT_COUNT);
const antsState = new Uint8Array(ANT_COUNT); // 0 = foraging, 1 = returning

// Nest centre in grid coords
const NEST_X = GRID_SIZE / 2;
const NEST_Y = GRID_SIZE / 2;
const NEST_RADIUS = 3; // grid cells — home zone

for (let i = 0; i < ANT_COUNT; i++) {
  // spawn near nest
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * NEST_RADIUS * 0.8;
  antsX[i] = NEST_X + Math.cos(a) * r;
  antsY[i] = NEST_Y + Math.sin(a) * r;
  antsAngle[i] = Math.random() * Math.PI * 2;
  antsState[i] = Math.random() < 0.5 ? 0 : 1;
}

// ─── Food sources ──────────────────────────────────────────────────────────
// Scattered food patches: { x, y, radius, amount }
interface FoodPatch {
  x: number;
  y: number;
  radius: number;
  amount: number;
}
const foodPatches: FoodPatch[] = [
  { x: 12, y: 12, radius: 4, amount: 20 },
  { x: 52, y: 14, radius: 5, amount: 25 },
  { x: 48, y: 52, radius: 3, amount: 15 },
  { x: 14, y: 50, radius: 4, amount: 18 },
];

function isInFood(ax: number, ay: number): boolean {
  for (const f of foodPatches) {
    const dx = ax - f.x;
    const dy = ay - f.y;
    if (dx * dx + dy * dy < f.radius * f.radius) return true;
  }
  return false;
}

function isInNest(ax: number, ay: number): boolean {
  const dx = ax - NEST_X;
  const dy = ay - NEST_Y;
  return dx * dx + dy * dy < NEST_RADIUS * NEST_RADIUS;
}

// ─── Update ────────────────────────────────────────────────────────────────
function update() {
  const DTL = SPEED; // per-frame distance (dt ~ 1)

  for (let i = 0; i < ANT_COUNT; i++) {
    let x = antsX[i];
    let y = antsY[i];
    let angle = antsAngle[i];
    const state = antsState[i];

    if (state === 0) {
      // ── Foraging ──────────────────────────────────────────────
      // Sense pheromones in nearby cells
      let bestP = -Infinity;
      let bestA = angle;
      for (let da = -1.0; da <= 1.0; da += 0.5) {
        const sa = angle + da;
        const sx = x + Math.cos(sa) * SENSE_RADIUS;
        const sy = y + Math.sin(sa) * SENSE_RADIUS;
        const p = pheromones.get(sx, sy);
        if (p > bestP) {
          bestP = p;
          bestA = sa;
        }
      }

      // Blend pheromone-aligned direction with random jitter
      if (bestP > 0.01) {
        // bias toward strongest pheromone signal
        angle = angle + (bestA - angle) * 0.3;
      }
      // random turn (wobble)
      angle += (Math.random() - 0.5) * TURN_RATE;

      const dx = Math.cos(angle) * DTL;
      const dy = Math.sin(angle) * DTL;
      x += dx;
      y += dy;

      // wrap around
      if (x < 0) x = GRID_SIZE;
      if (x > GRID_SIZE) x = 0;
      if (y < 0) y = GRID_SIZE;
      if (y > GRID_SIZE) y = 0;

      // Found food?
      if (isInFood(x, y)) {
        antsState[i] = 1; // switch to returning
      }
    } else {
      // ── Returning ─────────────────────────────────────────────
      // Deposit pheromone at current location
      pheromones.add(x, y, 0.12);

      // Head toward nest
      const dx = NEST_X - x;
      const dy = NEST_Y - y;
      const targetAngle = Math.atan2(dy, dx);

      // Smoothly steer toward nest with some jitter
      let diff = targetAngle - angle;
      // Normalise to [-PI, PI]
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angle += diff * 0.2;
      angle += (Math.random() - 0.5) * 0.3;

      x += Math.cos(angle) * DTL;
      y += Math.sin(angle) * DTL;

      // Reached nest?
      if (isInNest(x, y)) {
        antsState[i] = 0; // switch to foraging
      }
    }

    antsX[i] = x;
    antsY[i] = y;
    antsAngle[i] = angle;
  }
}

// ─── Render ────────────────────────────────────────────────────────────────
function render(ctx: CanvasRenderingContext2D) {
  const scaleX = width / GRID_SIZE;
  const scaleY = height / GRID_SIZE;

  // ── Background ───────────────────────────────────────────────
  ctx.fillStyle = "#0d0f1a";
  ctx.fillRect(0, 0, width, height);

  // ── Pheromone heatmap ────────────────────────────────────────
  const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  const d = imgData.data;
  const g = pheromones.grid;

  // Auto-range the pheromone grid so the heatmap always shows dynamic range
  let pMax = 0.001;
  for (let i = 0; i < g.length; i++) {
    if (g[i] > pMax) pMax = g[i];
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const v = g[y * GRID_SIZE + x] / pMax; // 0..1
      const idx = (y * GRID_SIZE + x) * 4;

      // deep purple → orange → white
      const r = 60 + v * 195;
      const gv = 40 + v * 160;
      const b = 80 + v * 60;

      d[idx] = r;
      d[idx + 1] = gv;
      d[idx + 2] = b;
      d[idx + 3] = 200;
    }
  }

  ctx.imageSmoothingEnabled = true;
  // drawImage with stretching — the grid gets scaled up to full canvas
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = GRID_SIZE;
  tempCanvas.height = GRID_SIZE;
  tempCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, width, height);

  // ── Food patches ─────────────────────────────────────────────
  for (const f of foodPatches) {
    const cx = f.x * scaleX;
    const cy = f.y * scaleY;
    const r = f.radius * scaleX;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(80, 200, 80, 0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(80, 200, 80, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Nest ─────────────────────────────────────────────────────
  const nx = NEST_X * scaleX;
  const ny = NEST_Y * scaleY;
  const nr = NEST_RADIUS * scaleX;
  ctx.beginPath();
  ctx.arc(nx, ny, nr, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(100, 120, 255, 0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(100, 120, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Ants (glow particles) ────────────────────────────────────
  ctx.shadowBlur = 6;
  for (let i = 0; i < ANT_COUNT; i++) {
    const px = antsX[i] * scaleX;
    const py = antsY[i] * scaleY;
    const isReturning = antsState[i] === 1;

    const color = isReturning ? "#ff8c00" : "#36f9c0";
    ctx.shadowColor = color;
    ctx.fillStyle = color;

    const pulse = 1 + 0.3 * Math.sin(Date.now() / 300 + i);
    const sz = Math.max(1.5, 3 * pulse);

    ctx.beginPath();
    ctx.arc(px, py, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// ─── FPS counter ───────────────────────────────────────────────────────────
let fpss: number[] = [];

function tickFps() {
  fpss.push(performance.now());
  if (fpss.length > 30) fpss.shift();
  if (fpss.length >= 2) {
    const dt = (fpss[fpss.length - 1] - fpss[0]) / (fpss.length - 1);
    if (dt > 0) {
      fpsEl.textContent = `${Math.round(1000 / dt)} FPS`;
    }
  }
  countEl.textContent = `${ANT_COUNT} ants`;
}

// ─── Main loop ─────────────────────────────────────────────────────────────
const ctx = canvas.getContext("2d")!;

function frame() {
  update();
  pheromones.step(0.97); // decay factor per frame
  render(ctx);
  tickFps();
  requestAnimationFrame(frame);
}

frame();
