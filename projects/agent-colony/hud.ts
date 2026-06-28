// ─── HUD: FPS, agent count, debug panel (with visible toggle) ──────────────

import { PARAMS } from "./params";

export class HUD {
  private fpsEl: HTMLSpanElement;
  private countEl: HTMLSpanElement;
  private fpsSamples: number[] = [];
  private panelEl: HTMLDivElement | null = null;
  private panelVisible = false;

  constructor() {
    this.fpsEl = document.getElementById("fps") as HTMLSpanElement;
    this.countEl = document.getElementById("count") as HTMLSpanElement;

    this._buildPanel();
    this._buildToggle();

    // Backtick toggle as secondary
    window.addEventListener("keydown", (e) => {
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        this._toggle();
      }
    });
  }

  tick(agentCount: number): void {
    this.fpsSamples.push(performance.now());
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    if (this.fpsSamples.length >= 2) {
      const dt =
        (this.fpsSamples[this.fpsSamples.length - 1] - this.fpsSamples[0]) /
        (this.fpsSamples.length - 1);
      if (dt > 0) {
        this.fpsEl.textContent = `${Math.round(1000 / dt)} FPS`;
      }
    }
    this.countEl.textContent = `${agentCount} agents`;
  }

  private _buildToggle(): void {
    const btn = document.createElement("button");
    btn.id = "panel-toggle";
    btn.innerHTML = "⚙";
    btn.title = "Toggle debug panel";
    btn.setAttribute("aria-label", "Toggle debug panel");
    btn.addEventListener("click", () => this._toggle());
    document.body.appendChild(btn);
  }

  private _toggle(): void {
    this.panelVisible = !this.panelVisible;
    if (this.panelEl) {
      this.panelEl.style.display = this.panelVisible ? "block" : "none";
    }
  }

  private _buildPanel(): void {
    this.panelEl = document.createElement("div");
    this.panelEl.id = "debug-panel";
    this.panelEl.style.cssText = `
      display: none;
      position: fixed;
      top: 14px;
      left: 54px;
      z-index: 20;
      background: rgba(5, 6, 15, 0.88);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(88, 93, 138, 0.2);
      border-radius: 10px;
      padding: 16px 18px;
      font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.7rem;
      color: #c8cbe0;
      min-width: 230px;
      user-select: none;
    `;

    const title = document.createElement("div");
    title.textContent = "⚙ PARAMETERS";
    title.style.cssText = "font-size: 0.75rem; color: #7a7fba; letter-spacing: 0.05em; margin-bottom: 10px;";
    this.panelEl.appendChild(title);

    const configs: Array<{
      key: keyof typeof PARAMS;
      label: string;
      min: number;
      max: number;
      step: number;
    }> = [
      { key: "antCount", label: "Agent Count", min: 10, max: 2000, step: 10 },
      { key: "speed", label: "Speed", min: 0.02, max: 0.6, step: 0.02 },
      { key: "visionRadius", label: "Vision (near-sight)", min: 2, max: 18, step: 0.5 },
      { key: "senseRadius", label: "Pheromone Sense", min: 0.5, max: 6, step: 0.25 },
      { key: "wander", label: "Wander", min: 0.05, max: 0.8, step: 0.05 },
      { key: "pheromoneDecay", label: "Decay", min: 0.9, max: 0.999, step: 0.001 },
      { key: "homeDeposit", label: "Home Deposit", min: 0.01, max: 0.5, step: 0.01 },
      { key: "foodDeposit", label: "Food Deposit", min: 0.01, max: 0.5, step: 0.01 },
      { key: "nestRadius", label: "Nest Radius", min: 1, max: 10, step: 0.5 },
      { key: "foodRadius", label: "Food Radius", min: 0.5, max: 10, step: 0.5 },
      { key: "foodValue", label: "Food Value", min: 5, max: 200, step: 5 },
      { key: "cloudDensity", label: "Cloud Density", min: 0, max: 3, step: 0.05 },
    ];

    for (const cfg of configs) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom: 5px; display: flex; flex-direction: column; gap: 2px;";

      const labelRow = document.createElement("div");
      labelRow.style.cssText = "display: flex; justify-content: space-between;";
      const label = document.createElement("span");
      label.textContent = cfg.label;
      const value = document.createElement("span");
      value.style.cssText = "color: #585d8a;";
      value.textContent = String(PARAMS[cfg.key]);

      labelRow.appendChild(label);
      labelRow.appendChild(value);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(cfg.min);
      slider.max = String(cfg.max);
      slider.step = String(cfg.step);
      slider.value = String(PARAMS[cfg.key]);
      slider.style.cssText = `
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(88, 93, 138, 0.25);
        border-radius: 2px;
        outline: none;
      `;
      if (!document.getElementById("dbg-slider-css")) {
        const st = document.createElement("style");
        st.id = "dbg-slider-css";
        st.textContent = `
          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #7a7fba;
            border: 1px solid rgba(200,203,224,0.2);
            cursor: pointer;
          }
          input[type="range"]::-moz-range-thumb {
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #7a7fba;
            border: 1px solid rgba(200,203,224,0.2);
            cursor: pointer;
          }
        `;
        document.head.appendChild(st);
      }

      slider.addEventListener("input", () => {
        const raw = parseFloat(slider.value);
        const clamped = cfg.step >= 1 ? Math.round(raw) : raw;
        (PARAMS[cfg.key] as number) = clamped;
        value.textContent = String(clamped);
        window.dispatchEvent(new CustomEvent("param-change", {
          detail: { key: cfg.key, value: clamped },
        }));
      });

      row.appendChild(labelRow);
      row.appendChild(slider);
      this.panelEl.appendChild(row);
    }

    this._buildCameraToggle();
    this._buildTrailToggle();

    document.body.appendChild(this.panelEl);
  }

  // Pheromone-trail visibility toggle. Dispatches `trail-visible-change` with
  // `{ visible }`; main.ts owns the mesh. Visible is the default.
  private _buildTrailToggle(): void {
    if (!this.panelEl) return;

    const row = document.createElement("div");
    row.style.cssText =
      "margin-top: 6px; display: flex; justify-content: space-between; align-items: center;";

    const label = document.createElement("span");
    label.textContent = "Pheromone Trail";

    const btn = document.createElement("button");
    let visible = true;
    const paint = () => {
      btn.textContent = visible ? "SHOWN" : "HIDDEN";
      btn.style.color = visible ? "#9fe0c8" : "#585d8a";
      btn.style.borderColor = visible
        ? "rgba(159, 224, 200, 0.4)"
        : "rgba(88, 93, 138, 0.3)";
    };
    btn.style.cssText = `
      background: rgba(88, 93, 138, 0.12);
      border: 1px solid rgba(88, 93, 138, 0.3);
      border-radius: 5px;
      padding: 3px 10px;
      font: inherit;
      font-size: 0.65rem;
      letter-spacing: 0.05em;
      cursor: pointer;
    `;
    paint();
    btn.addEventListener("click", () => {
      visible = !visible;
      paint();
      window.dispatchEvent(
        new CustomEvent("trail-visible-change", { detail: { visible } }),
      );
    });

    row.appendChild(label);
    row.appendChild(btn);
    this.panelEl.appendChild(row);
  }

  // Static-vs-rotating camera toggle. Dispatches `camera-rotate-change` with
  // `{ rotating }`; main.ts owns the actual orbit. Static is the default.
  private _buildCameraToggle(): void {
    if (!this.panelEl) return;

    const row = document.createElement("div");
    row.style.cssText =
      "margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(88, 93, 138, 0.2); display: flex; justify-content: space-between; align-items: center;";

    const label = document.createElement("span");
    label.textContent = "Camera Rotation";

    const btn = document.createElement("button");
    let rotating = false;
    const paint = () => {
      btn.textContent = rotating ? "ROTATING" : "STATIC";
      btn.style.color = rotating ? "#9fe0c8" : "#585d8a";
      btn.style.borderColor = rotating
        ? "rgba(159, 224, 200, 0.4)"
        : "rgba(88, 93, 138, 0.3)";
    };
    btn.style.cssText = `
      background: rgba(88, 93, 138, 0.12);
      border: 1px solid rgba(88, 93, 138, 0.3);
      border-radius: 5px;
      padding: 3px 10px;
      font: inherit;
      font-size: 0.65rem;
      letter-spacing: 0.05em;
      cursor: pointer;
    `;
    paint();
    btn.addEventListener("click", () => {
      rotating = !rotating;
      paint();
      window.dispatchEvent(
        new CustomEvent("camera-rotate-change", { detail: { rotating } }),
      );
    });

    row.appendChild(label);
    row.appendChild(btn);
    this.panelEl.appendChild(row);

    // Orbit speed (radians/sec). Dispatches `camera-speed-change` with `{ value }`.
    const speedRow = document.createElement("div");
    speedRow.style.cssText = "margin-top: 6px; display: flex; flex-direction: column; gap: 2px;";

    const speedLabelRow = document.createElement("div");
    speedLabelRow.style.cssText = "display: flex; justify-content: space-between;";
    const speedLabel = document.createElement("span");
    speedLabel.textContent = "Rotation Speed";
    const speedValue = document.createElement("span");
    speedValue.style.cssText = "color: #585d8a;";
    speedValue.textContent = "0.05";
    speedLabelRow.appendChild(speedLabel);
    speedLabelRow.appendChild(speedValue);

    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "0";
    speedSlider.max = "0.4";
    speedSlider.step = "0.01";
    speedSlider.value = "0.05";
    speedSlider.style.cssText = `
      width: 100%;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(88, 93, 138, 0.25);
      border-radius: 2px;
      outline: none;
    `;
    speedSlider.addEventListener("input", () => {
      const v = parseFloat(speedSlider.value);
      speedValue.textContent = v.toFixed(2);
      window.dispatchEvent(
        new CustomEvent("camera-speed-change", { detail: { value: v } }),
      );
    });

    speedRow.appendChild(speedLabelRow);
    speedRow.appendChild(speedSlider);
    this.panelEl.appendChild(speedRow);
  }
}
