// ─── Pheromone Grid ────────────────────────────────────────────────────────
// 2D grid of pheromone concentrations, rendered as a heatmap texture
// for the 3D ground plane.

export class PheromoneGrid {
  private _grid: Float32Array;
  private _blur: Float32Array;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
    this._grid = new Float32Array(size * size);
    this._blur = new Float32Array(size * size);
  }

  /** Read-only access to the current grid data (for rendering). */
  get grid(): Float32Array {
    return this._grid;
  }

  get(x: number, y: number): number {
    const ix = this._clamp(Math.floor(x));
    const iy = this._clamp(Math.floor(y));
    return this._grid[iy * this.size + ix];
  }

  /** Bilinear-add: deposit `amount` spread across the 4 nearest cells. */
  add(x: number, y: number, amount: number): void {
    const sx = x - 0.5;
    const sy = y - 0.5;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = sx - ix;
    const fy = sy - iy;

    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        if (cx < 0 || cx >= this.size || cy < 0 || cy >= this.size) continue;
        const w = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy);
        const idx = cy * this.size + cx;
        this._grid[idx] = Math.min(1, this._grid[idx] + amount * w);
      }
    }
  }

  /** Decay + 3×3 box blur in one pass. */
  step(decay: number): void {
    const { size, _grid: grid, _blur: blur } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let n = 0;
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(size - 1, y + 1);
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(size - 1, x + 1);
        for (let cy = y0; cy <= y1; cy++) {
          const row = cy * size;
          for (let cx = x0; cx <= x1; cx++) {
            sum += grid[row + cx];
            n++;
          }
        }
        blur[y * size + x] = (sum / n) * decay;
      }
    }
    // Swap arrays
    this._grid = this._blur;
    this._blur = grid;
  }

  /** Render the current grid as a heatmap onto a canvas. */
  renderToCanvas(ctx: CanvasRenderingContext2D): void {
    const { size, _grid: grid } = this;
    const imgData = ctx.createImageData(size, size);
    const d = imgData.data;

    // Auto-range for dynamic contrast
    let pMax = 0.001;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > pMax) pMax = grid[i];
    }
    const invMax = 1 / pMax;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = grid[y * size + x] * invMax;
        const idx = (y * size + x) << 2;
        d[idx]     = 60   + v * 195;  // R: dark purple → orange
        d[idx + 1] = 40   + v * 160;  // G
        d[idx + 2] = 80   + v * 60;   // B
        d[idx + 3] = 200;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /** Manually clear area (e.g. around moved nest). */
  clearCircle(cx: number, cy: number, radius: number): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.size, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.size, Math.ceil(cy + radius));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < r2) {
          this._grid[y * this.size + x] = 0;
        }
      }
    }
  }

  private _clamp(v: number): number {
    return v < 0 ? 0 : v >= this.size ? this.size - 1 : v;
  }
}
