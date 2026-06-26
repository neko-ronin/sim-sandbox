// ─── HUD: FPS, agent count, debug panel ────────────────────────────────────

import { PARAMS } from "./params";

export class HUD {
  private fpsEl: HTMLSpanElement;
  private countEl: HTMLSpanElement;
  private fpsSamples: number[] = [];
  private panelEl: HTMLDivElement | null = null;
  private panelVisible = false;
  private readonly panelKey: string;

  constructor() {
    this.fpsEl = document.getElementById("fps") as HTMLSpanElement;
    this.countEl = document.getElementById("count") as HTMLSpanElement;
    this.panelKey = "agent-colony-debug-panel";

    this._buildDebugPanel();

    // Toggle panel with backtick
    window.addEventListener("keydown", (e) => {
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        this._togglePanel();
      }
    });
  }

  /** Call every frame with the current agent count. */
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

  private _buildDebugPanel(): void {
    this.panelEl = document.createElement("div");
    this.panelEl.id = "debug-panel";
    this.panelEl.style.cssText = `
      position: fixed;
      top: 14px;
      left: 18px;
      z-index: 20;
      background: rgba(5, 6, 15, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(88, 93, 138, 0.2);
      border-radius: 8px;
      padding: 16px 18px;
      font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.7rem;
      color: #c8cbe0;
      min-width: 220px;
      display: none;
      user-select: none;
    `;

    const title = document.createElement("div");
    title.textContent = "⚙ SIM PARAMETERS";
    title.style.cssText = "font-size: 0.75rem; color: #7a7fba; letter-spacing: 0.05em; margin-bottom: 10px;";
    this.panelEl.appendChild(title);

    // Build slider for each param
    const configs: Array<{
      key: keyof typeof PARAMS;
      label: string;
      min: number;
      max: number;
      step: number;
    }> = [
      { key: "antCount", label: "Agent Count", min: 10, max: 2000, step: 10 },
      { key: "speed", label: "Speed", min: 0.1, max: 5, step: 0.1 },
      { key: "senseRadius", label: "Sense Radius", min: 0.5, max: 6, step: 0.25 },
      { key: "turnRate", label: "Turn Rate", min: 0.05, max: 1.5, step: 0.05 },
      { key: "pheromoneDecay", label: "Decay", min: 0.9, max: 0.999, step: 0.001 },
      { key: "depositAmount", label: "Deposit Amt", min: 0.01, max: 0.5, step: 0.01 },
      { key: "nestRadius", label: "Nest Radius", min: 1, max: 10, step: 0.5 },
      { key: "foodRadius", label: "Food Radius", min: 0.5, max: 10, step: 0.5 },
    ];

    for (const cfg of configs) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom: 6px; display: flex; flex-direction: column; gap: 2px;";

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
      // Thumb styling
      slider.style.setProperty("--thumb-color", "#7a7fba");
      const thumbCss = `
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #7a7fba;
          border: 1px solid rgba(200, 203, 224, 0.2);
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #7a7fba;
          border: 1px solid rgba(200, 203, 224, 0.2);
          cursor: pointer;
        }
      `;
      // Inject thumb styles once
      if (!document.getElementById("debug-slider-styles")) {
        const style = document.createElement("style");
        style.id = "debug-slider-styles";
        style.textContent = thumbCss;
        document.head.appendChild(style);
      }

      slider.addEventListener("input", () => {
        const raw = parseFloat(slider.value);
        const clamped = cfg.step >= 1 ? Math.round(raw) : raw;

        (PARAMS[cfg.key] as number) = clamped;
        value.textContent = String(clamped);

        // Dispatch event so main.ts can react (e.g., recreate ants on count change)
        window.dispatchEvent(new CustomEvent("param-change", {
          detail: { key: cfg.key, value: clamped },
        }));
      });

      row.appendChild(labelRow);
      row.appendChild(slider);
      this.panelEl.appendChild(row);
    }

    document.body.appendChild(this.panelEl);
  }

  private _togglePanel(): void {
    if (!this.panelEl) return;
    this.panelVisible = !this.panelVisible;
    this.panelEl.style.display = this.panelVisible ? "block" : "none";
  }
}
