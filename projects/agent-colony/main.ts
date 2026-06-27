// ─── Agent Colony: 3D Vivarium ─────────────────────────────────────────────
// Free-floating 3D agents in a cubic volume.  Static camera, no ground plane.
// Click to place food; drag the nest sphere.  Debug panel toggled via ⚙ button.

import * as THREE from "three";

import { PheromoneVolume } from "./pheromone";
import { createAgents, updateAgents, FoodSource3D, STATE_FORAGING } from "./ants";
import { MouseHandler } from "./interaction";
import { HUD } from "./hud";
import { PARAMS } from "./params";

// ─── Constants ─────────────────────────────────────────────────────────────
const GRID_SIZE = 32; // pheromone volume resolution (32×32×32)
const HALF = PARAMS.cubeSize / 2;
const WORLD_TO_GRID = GRID_SIZE / PARAMS.cubeSize;
const NEST_START = new THREE.Vector3(-8, 4, -8);

// ─── Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060f);
scene.fog = new THREE.FogExp2(0x05060f, 0.012);

// ─── Renderer ──────────────────────────────────────────────────────────────
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  });
} catch (e) {
  const msg = document.createElement("div");
  msg.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "font-family:'SF Mono',monospace;color:#585d8a;background:#05060f;" +
    "text-align:center;padding:2rem;line-height:1.6";
  msg.textContent =
    "A WebGL context could not be created.\n" +
    "Close other 3D tabs and reload.\n" +
    "If the problem persists, check GPU drivers.";
  document.body.appendChild(msg);
  throw e;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x05060f);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
document.body.appendChild(renderer.domElement);

// WebGL context loss recovery
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  if (document.querySelector("#webgl-loss")) return;
  const b = document.createElement("div");
  b.id = "webgl-loss";
  b.textContent = "⚠ WebGL context lost — reload the page.";
  b.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:999;" +
    "background:#ff4444;color:#fff;padding:8px;text-align:center;" +
    "font-family:'SF Mono',monospace;font-size:0.8rem;";
  document.body.prepend(b);
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
  document.querySelector("#webgl-loss")?.remove();
});

// ─── Camera (static) ──────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  40, window.innerWidth / window.innerHeight, 0.1, 150,
);
camera.position.set(40, 28, 45);
camera.lookAt(0, 0, 0);

// ─── Lights ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x1a1a3a, 0.4));

// Colored point lights for atmosphere
const lightPositions: Array<[number, number, number, number, string]> = [
  [-15, 10, -15, 1.5, "#66aaff"],
  [15, -5, 15, 1.2, "#ff66aa"],
  [-10, -15, 12, 1.0, "#aaff66"],
  [12, 15, -10, 0.8, "#ffaa44"],
];
for (const [lx, ly, lz, intensity, color] of lightPositions) {
  const pl = new THREE.PointLight(color, intensity, 60);
  pl.position.set(lx, ly, lz);
  scene.add(pl);
}

// Subtle top fill
const topLight = new THREE.DirectionalLight(0x8888ff, 0.3);
topLight.position.set(0, 30, 0);
scene.add(topLight);

// ─── Ambient dust particles ────────────────────────────────────────────────
const DUST_COUNT = 800;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustSizes = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * PARAMS.cubeSize;
  dustPos[i * 3 + 1] = (Math.random() - 0.5) * PARAMS.cubeSize;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * PARAMS.cubeSize;
  dustSizes[i] = 0.2 + Math.random() * 0.6;
}
dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dustPos, 3));
dustGeo.setAttribute("size", new THREE.Float32BufferAttribute(dustSizes, 1));

const dustMat = new THREE.PointsMaterial({
  color: 0x5566aa,
  size: 0.3,
  transparent: true,
  opacity: 0.15,
  sizeAttenuation: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const dustPoints = new THREE.Points(dustGeo, dustMat);
scene.add(dustPoints);

// ─── Pheromone volume ─────────────────────────────────────────────────────
const pheromones = new PheromoneVolume(GRID_SIZE);

// ─── Nest ──────────────────────────────────────────────────────────────────
let nestPos = NEST_START.clone();
const nestGeo = new THREE.SphereGeometry(1, 28, 20);
const nestMat = new THREE.MeshStandardMaterial({
  color: 0x6688ff,
  emissive: 0x6688ff,
  emissiveIntensity: 0.5,
  transparent: true,
  opacity: 0.75,
  roughness: 0.2,
  metalness: 0.0,
});
const nestMesh = new THREE.Mesh(nestGeo, nestMat);

// Nest glow aura (transparent sphere)
const auraGeo = new THREE.SphereGeometry(1.3, 20, 16);
const auraMat = new THREE.MeshBasicMaterial({
  color: 0x6688ff,
  transparent: true,
  opacity: 0.1,
  side: THREE.BackSide,
  blending: THREE.AdditiveBlending,
});
const auraMesh = new THREE.Mesh(auraGeo, auraMat);

scene.add(nestMesh);
scene.add(auraMesh);

// Nest light
const nestLight = new THREE.PointLight(0x6688ff, 2.0, 30);
scene.add(nestLight);

function updateNestVisuals(): void {
  const s = PARAMS.nestRadius;
  nestMesh.position.copy(nestPos);
  nestMesh.scale.set(s, s, s);
  auraMesh.position.copy(nestPos);
  auraMesh.scale.set(s * 1.3, s * 1.3, s * 1.3);
  nestLight.position.copy(nestPos);
}
updateNestVisuals();

// ─── Food sources ──────────────────────────────────────────────────────────
const foodSources3D: FoodSource3D[] = [];
const foodMeshes: THREE.Mesh[] = [];

const initialFood: Array<[number, number, number]> = [
  [HALF - 8, 6, HALF - 8],
  [HALF - 8, -4, -HALF + 8],
  [-HALF + 8, 10, HALF - 8],
  [-HALF + 8, -8, -HALF + 8],
];

const foodSphereGeo = new THREE.SphereGeometry(1, 16, 12);
const foodMat = new THREE.MeshStandardMaterial({
  color: 0x44dd88,
  emissive: 0x44dd88,
  emissiveIntensity: 0.4,
  transparent: true,
  opacity: 0.7,
  roughness: 0.3,
  metalness: 0.1,
});

function addFood(wx: number, wy: number, wz: number): void {
  if (
    wx < -HALF || wx > HALF ||
    wy < -HALF || wy > HALF ||
    wz < -HALF || wz > HALF
  ) return;

  foodSources3D.push({ x: wx, y: wy, z: wz, radius: PARAMS.foodRadius });

  const mesh = new THREE.Mesh(foodSphereGeo.clone(), foodMat.clone());
  mesh.position.set(wx, wy, wz);
  const s = PARAMS.foodRadius / 2;
  mesh.scale.set(s, s, s);
  scene.add(mesh);
  foodMeshes.push(mesh);

  // Food light
  const foodLight = new THREE.PointLight(0x44dd88, 1.5, 20);
  foodLight.position.set(wx, wy, wz);
  scene.add(foodLight);
}

// Also add food-aura ring effect
for (const [fx, fy, fz] of initialFood) {
  addFood(fx, fy, fz);
}

// ─── Agents ────────────────────────────────────────────────────────────────
let agents = createAgents(PARAMS.antCount, NEST_START.x, NEST_START.y, NEST_START.z);

// Glass/orb ShaderMaterial — Three.js injects instanceMatrix and instanceColor
// automatically for InstancedMesh, so we don't declare them here.
const agentUniforms = {
  uTime: { value: 0 },
};

const agentVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vColor;
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = instanceMatrix * vec4(position, 1.0);
    vec3 worldNormal = normalize((instanceMatrix * vec4(normal, 0.0)).xyz);

    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;
    vNormal = normalize(normalMatrix * worldNormal);
    vWorldPos = worldPos.xyz;
    vColor = instanceColor;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const agentFragmentShader = `
  uniform float uTime;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vColor;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);

    // Fresnel rim (bright at glancing angles, transparent at centre)
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 2.6);

    // Caustic shimmer — 3D position-based animated noise
    float caustic = sin(vWorldPos.x * 10.0 + uTime * 0.9)
                  * cos(vWorldPos.y * 9.0  + uTime * 0.7)
                  * sin(vWorldPos.z * 11.0 + uTime * 1.1);
    caustic = caustic * 0.5 + 0.5;

    // Core glow
    float ndotl = max(0.0, dot(normal, viewDir));
    float core = pow(ndotl, 0.6);

    // Glass-like inner refraction sparkle
    float sparkle = pow(caustic, 4.0) * 0.5;

    vec3 col = vColor * (0.25 + 0.45 * core + 0.55 * fresnel + 0.20 * caustic + sparkle);

    float alpha = 0.35 + 0.65 * fresnel;

    gl_FragColor = vec4(col, alpha);
  }
`;

let agentGeo = new THREE.IcosahedronGeometry(0.5, 2);
let agentMat = new THREE.ShaderMaterial({
  uniforms: agentUniforms,
  vertexShader: agentVertexShader,
  fragmentShader: agentFragmentShader,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
let agentMesh = new THREE.InstancedMesh(agentGeo, agentMat, agents.length);
agentMesh.instanceColor = new THREE.InstancedBufferAttribute(
  new Float32Array(agents.length * 3), 3,
);
agentMesh.count = agents.length;
scene.add(agentMesh);

const tmpVec = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const FORAGE_COLOR = new THREE.Color(0x44f9e0);
const RETURN_COLOR = new THREE.Color(0xff8c44);

function rebuildAgents(): void {
  scene.remove(agentMesh);
  agentGeo.dispose();
  agentMat.dispose();

  agents = createAgents(PARAMS.antCount, nestPos.x, nestPos.y, nestPos.z);
  agentGeo = new THREE.IcosahedronGeometry(0.5, 2);
  agentMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: agentUniforms.uTime.value } },
    vertexShader: agentVertexShader,
    fragmentShader: agentFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  agentMesh = new THREE.InstancedMesh(agentGeo, agentMat, agents.length);
  agentMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(agents.length * 3), 3,
  );
  agentMesh.count = agents.length;
  scene.add(agentMesh);
}

function updateAgentMeshes(): void {
  const colorArr = agentMesh.instanceColor!.array as Float32Array;
  const now = Date.now();
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    tmpVec.set(a.x, a.y, a.z);
    tmpMat.identity();
    tmpMat.setPosition(tmpVec);
    agentMesh.setMatrixAt(i, tmpMat);

    const isReturning = a.state === STATE_FORAGING;
    const c = isReturning ? FORAGE_COLOR : RETURN_COLOR;
    tmpColor.copy(c);
    const pulse = 0.6 + 0.4 * Math.sin(now / 250 + i * 0.15);
    tmpColor.multiplyScalar(pulse);
    colorArr[i * 3] = tmpColor.r;
    colorArr[i * 3 + 1] = tmpColor.g;
    colorArr[i * 3 + 2] = tmpColor.b;
  }
  agentMesh.instanceMatrix.needsUpdate = true;
  agentMesh.instanceColor!.needsUpdate = true;
}

// ─── Mouse Interaction ─────────────────────────────────────────────────────
const mouseHandler = new MouseHandler(
  camera,
  renderer.domElement,
  {
    onPlaceFood: (x, y, z) => addFood(x, y, z),
    onStartNestDrag: () => {
      nestMat.emissiveIntensity = 1.0;
    },
    onDragNest: (x, y, z) => {
      nestPos.set(x, y, z);
      nestPos.x = Math.max(-HALF + 2, Math.min(HALF - 2, nestPos.x));
      nestPos.y = Math.max(-HALF + 2, Math.min(HALF - 2, nestPos.y));
      nestPos.z = Math.max(-HALF + 2, Math.min(HALF - 2, nestPos.z));
      updateNestVisuals();
      // Clear pheromones near new nest position
      const gx = (nestPos.x + HALF) * WORLD_TO_GRID;
      const gy = (nestPos.y + HALF) * WORLD_TO_GRID;
      const gz = (nestPos.z + HALF) * WORLD_TO_GRID;
      pheromones.clearSphere(gx, gy, gz, PARAMS.nestRadius * WORLD_TO_GRID + 2);
    },
    onEndNestDrag: () => {
      nestMat.emissiveIntensity = 0.5;
    },
  },
  () => nestPos.clone(),
  nestMesh,
  () => HALF,
  () => PARAMS.nestRadius,
);

// ─── Resize ────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── HUD ───────────────────────────────────────────────────────────────────
const hud = new HUD();

// ─── Param changes ─────────────────────────────────────────────────────────
window.addEventListener("param-change", ((e: CustomEvent) => {
  if (e.detail.key === "antCount") {
    rebuildAgents();
  }
}) as EventListener);

// ─── Main Loop ─────────────────────────────────────────────────────────────
let animTime = 0;
const dustVelocities: Float32Array = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT * 3; i++) {
  dustVelocities[i] = (Math.random() - 0.5) * 0.02;
}

function frame(): void {
  requestAnimationFrame(frame);
  animTime += 0.016;

  // 1. Update agents
  updateAgents(agents, pheromones, foodSources3D, nestPos.x, nestPos.y, nestPos.z, PARAMS.cubeSize);

  // 2. Step pheromone volume
  pheromones.step(PARAMS.pheromoneDecay);

  // 3. Update agent mesh positions
  updateAgentMeshes();

  // 4. Advance shader uniforms
  agentUniforms.uTime.value = animTime;

  // 5. Animate dust particles (slow drift)
  const dPos = dustPoints.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < DUST_COUNT; i++) {
    const i3 = i * 3;
    dPos[i3] += dustVelocities[i3];
    dPos[i3 + 1] += dustVelocities[i3 + 1];
    dPos[i3 + 2] += dustVelocities[i3 + 2];
    // Wrap
    if (dPos[i3] > HALF) dPos[i3] = -HALF;
    if (dPos[i3] < -HALF) dPos[i3] = HALF;
    if (dPos[i3 + 1] > HALF) dPos[i3 + 1] = -HALF;
    if (dPos[i3 + 1] < -HALF) dPos[i3 + 1] = HALF;
    if (dPos[i3 + 2] > HALF) dPos[i3 + 2] = -HALF;
    if (dPos[i3 + 2] < -HALF) dPos[i3 + 2] = HALF;
  }
  dustPoints.geometry.attributes.position.needsUpdate = true;

  // 5. Animate food patches
  const foodPulse = 0.5 + 0.5 * Math.sin(animTime * 1.2);
  for (const fm of foodMeshes) {
    const mat = fm.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.2 + 0.5 * foodPulse;
    const s = (PARAMS.foodRadius / 2) * (0.9 + 0.1 * foodPulse);
    fm.scale.set(s, s, s);
  }

  // 6. Animate nest glow
  const nestPulse = 0.5 + 0.5 * Math.sin(animTime * 0.6);
  nestMat.emissiveIntensity = 0.3 + 0.4 * nestPulse;
  auraMat.opacity = 0.06 + 0.1 * nestPulse;
  const as = PARAMS.nestRadius * (1.2 + 0.15 * nestPulse);
  auraMesh.scale.set(as, as, as);

  // 7. Render
  renderer.render(scene, camera);

  // 8. HUD
  hud.tick(agents.length);
}

frame();
