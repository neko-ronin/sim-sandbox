// ─── Pheromone Volume ──────────────────────────────────────────────────────
// 3D scalar field of pheromone concentrations, with decay and 3×3×3 blur.

export class PheromoneVolume {
  private _grid: Float32Array;
  private _blur: Float32Array;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this._grid = new Float32Array(size * size * size);
    this._blur = new Float32Array(size * size * size);
  }

  /** Read-only access to current grid data. */
  get grid(): Float32Array {
    return this._grid;
  }

  /** Trilinear interpolation. */
  get(x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;

    let sum = 0;
    for (let dz = 0; dz < 2; dz++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          if (
            cx < 0 || cx >= this.size ||
            cy < 0 || cy >= this.size ||
            cz < 0 || cz >= this.size
          ) continue;
          const w =
            (dx === 0 ? 1 - fx : fx) *
            (dy === 0 ? 1 - fy : fy) *
            (dz === 0 ? 1 - fz : fz);
          sum += this._grid[(cz * this.size + cy) * this.size + cx] * w;
        }
      }
    }
    return sum;
  }

  /** Trilinear-add: deposit `amount` across nearby cells. */
  add(x: number, y: number, z: number, amount: number): void {
    const ix = Math.floor(x - 0.5);
    const iy = Math.floor(y - 0.5);
    const iz = Math.floor(z - 0.5);
    const fx = x - 0.5 - ix;
    const fy = y - 0.5 - iy;
    const fz = z - 0.5 - iz;

    for (let dz = 0; dz < 2; dz++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          if (
            cx < 0 || cx >= this.size ||
            cy < 0 || cy >= this.size ||
            cz < 0 || cz >= this.size
          ) continue;
          const w =
            (dx === 0 ? 1 - fx : fx) *
            (dy === 0 ? 1 - fy : fy) *
            (dz === 0 ? 1 - fz : fz);
          const idx = (cz * this.size + cy) * this.size + cx;
          this._grid[idx] = Math.min(1, this._grid[idx] + amount * w);
        }
      }
    }
  }

  /** Decay + 3×3×3 box blur in one pass. */
  step(decay: number): void {
    const s = this.size;
    const grid = this._grid;
    const blur = this._blur;

    for (let z = 0; z < s; z++) {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let sum = 0;
          let n = 0;
          const z0 = Math.max(0, z - 1);
          const z1 = Math.min(s - 1, z + 1);
          const y0 = Math.max(0, y - 1);
          const y1 = Math.min(s - 1, y + 1);
          const x0 = Math.max(0, x - 1);
          const x1 = Math.min(s - 1, x + 1);
          for (let cz = z0; cz <= z1; cz++) {
            const plane = cz * s * s;
            for (let cy = y0; cy <= y1; cy++) {
              const row = plane + cy * s;
              for (let cx = x0; cx <= x1; cx++) {
                sum += grid[row + cx];
                n++;
              }
            }
          }
          blur[(z * s + y) * s + x] = (sum / n) * decay;
        }
      }
    }

    // Swap buffers
    this._grid = this._blur;
    this._blur = grid;
  }

  /** Zero-out a spherical region (e.g. around moved nest). */
  clearSphere(cx: number, cy: number, cz: number, radius: number): void {
    const r2 = radius * radius;
    const s = this.size;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(s - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(s - 1, Math.ceil(cy + radius));
    const z0 = Math.max(0, Math.floor(cz - radius));
    const z1 = Math.min(s - 1, Math.ceil(cz + radius));

    for (let iz = z0; iz <= z1; iz++) {
      const plane = iz * s * s;
      for (let iy = y0; iy <= y1; iy++) {
        const row = plane + iy * s;
        for (let ix = x0; ix <= x1; ix++) {
          const dx = ix - cx;
          const dy = iy - cy;
          const dz = iz - cz;
          if (dx * dx + dy * dy + dz * dz < r2) {
            this._grid[row + ix] = 0;
          }
        }
      }
    }
  }
}
