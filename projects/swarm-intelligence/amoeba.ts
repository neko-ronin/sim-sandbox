// ─── Amoeba / Euglena — cellular body with leading-edge dot ────────────────
// The body is a sphere deformed in the vertex shader:
//
//   • A tiny bright dot sits at the leading edge.
//   • The dot protrudes ~30% of body radius in the direction of travel.
//   • The dot's freedom is a 45° cone from the body's centre axis.
//   • The body surface curves/bends toward the dot based on its angle.
//
// The `a_dotWeight` vertex attribute gives the vertex shader a per-vertex
// blend factor for the deformation: high at the front pole, zero at the
// equator and rear hemisphere.

import * as THREE from "three";

export interface AmoebaGeometryOptions {
  /** Body radius at rest (a perfect sphere before deformation). */
  radius: number;
  /** Number of latitude rings. */
  rings: number;
  /** Number of longitudinal segments per ring. */
  segments: number;
}

const DEFAULT_OPTS: AmoebaGeometryOptions = {
  radius: 0.55,
  rings: 14,
  segments: 12,
};

/**
 * Build a UV sphere with an `a_dotWeight` vertex attribute:
 *
 *   dotWeight = max(0, dot(normal, +Z))   — 1 at the front pole,
 *                                             0 across the equator and rear.
 *
 * The vertex shader uses this to blend the protrusion + bend deformation so
 * the front of the body stretches toward the dot while the back stays fixed.
 */
export function createBodyGeometry(opts?: Partial<AmoebaGeometryOptions>): THREE.BufferGeometry {
  const { radius, rings, segments } = { ...DEFAULT_OPTS, ...opts };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const dotWeights: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= rings; j++) {
    const theta = (j / rings) * Math.PI;            // 0 at north pole, π at south
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let i = 0; i <= segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      const x = radius * sinT * Math.cos(phi);
      const y = radius * sinT * Math.sin(phi);
      const z = radius * cosT;

      positions.push(x, y, z);

      // Normal = normalized position (unit sphere)
      const nl = 1 / radius;
      normals.push(x * nl, y * nl, z * nl);

      uvs.push(i / segments, 1 - j / rings);

      // dotWeight: 1 at front pole (+Z), smoothly falls to 0 at equator,
      // stays 0 for the rear hemisphere.
      dotWeights.push(Math.max(0, cosT));
    }
  }

  // Triangles (two per quad strip)
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = (j + 1) * (segments + 1) + i;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("a_dotWeight", new THREE.Float32BufferAttribute(dotWeights, 1));
  geo.setIndex(indices);

  return geo;
}

/**
 * Create a glow texture for the leading-edge dot.
 */
export function makeDotTexture(): THREE.Texture {
  const size = 16;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.8)");
  g.addColorStop(0.7, "rgba(200,200,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
