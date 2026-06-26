// ─── Agent Colony: Main Entry ──────────────────────────────────────────────
// Three.js 3D scene with interactive food placement, draggable nest, and
// real-time pheromone-trail simulation.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { PheromoneGrid } from "./pheromone";
import { createAnts, updateAnts, FoodSource2D, ANT_STATE_FORAGING } from "./ants";
import { MouseHandler } from "./interaction";
import { HUD } from "./hud";
import { PARAMS } from "./params";

// ─── Constants ─────────────────────────────────────────────────────────────
const GRID_SIZE = 128;
const WORLD_SIZE = 128; // ground plane matches grid 1:1
const HALF = WORLD_SIZE / 2;
const ANT_SCALE = 0.25;

// ─── Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060f, 0.003);

// ─── Three.js Setup ────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x05060f);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);
camera.position.set(50, 60, 70);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.target.set(0, 0, 0);
controls.update();

// ─── Lights ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x222244, 0.6));

const dirLight = new THREE.DirectionalLight(0xffeedd, 2.5);
dirLight.position.set(40, 80, 30);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
fillLight.position.set(-30, 20, -40);
scene.add(fillLight);

// ─── Pheromone texture (dynamic canvas) ────────────────────────────────────
const pheromoneCanvas = document.createElement("canvas");
pheromoneCanvas.width = GRID_SIZE;
pheromoneCanvas.height = GRID_SIZE;
const pheromoneCtx = pheromoneCanvas.getContext("2d")!;
const pheromoneTex = new THREE.CanvasTexture(pheromoneCanvas);
pheromoneTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const pheromones = new PheromoneGrid(GRID_SIZE);

// ─── Ground plane ──────────────────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
const groundMat = new THREE.MeshStandardMaterial({
  map: pheromoneTex,
  emissiveMap: pheromoneTex,
  emissive: new THREE.Color(0xffffff),
  emissiveIntensity: 0.6,
  roughness: 0.9,
  metalness: 0.0,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.1, 0);
scene.add(ground);

// Subtle grid helper
const gridHelper = new THREE.GridHelper(WORLD_SIZE, 32, 0x1a1e3a, 0x0d0f1a);
gridHelper.position.y = -0.05;
scene.add(gridHelper);

// ─── Nest ──────────────────────────────────────────────────────────────────
let nestPos = new THREE.Vector3(HALF, 0, HALF); // grid coords

const nestSphereGeo = new THREE.SphereGeometry(
  1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2,
);
const nestMat = new THREE.MeshStandardMaterial({
  color: 0x4466cc,
  emissive: 0x4466cc,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.7,
  roughness: 0.3,
  metalness: 0.1,
});
const nestMesh = new THREE.Mesh(nestSphereGeo, nestMat);

const nestRingGeo = new THREE.RingGeometry(1.2, 3, 32);
const nestRingMat = new THREE.MeshBasicMaterial({
  color: 0x4466cc,
  transparent: true,
  opacity: 0.15,
  side: THREE.DoubleSide,
});
const nestRing = new THREE.Mesh(nestRingGeo, nestRingMat);
nestRing.rotation.x = -Math.PI / 2;

scene.add(nestMesh);
scene.add(nestRing);

function updateNestVisuals(): void {
  const scale = PARAMS.nestRadius;
  nestMesh.position.set(nestPos.x - HALF, 0.2, nestPos.z - HALF);
  nestMesh.scale.set(scale, scale, scale);
  nestRing.position.set(nestPos.x - HALF, 0.05, nestPos.z - HALF);
  nestRing.scale.set(scale, scale, scale);
}
updateNestVisuals();

// ─── Food sources ──────────────────────────────────────────────────────────
const foodSources2D: FoodSource2D[] = [];
const foodMeshes: THREE.Mesh[] = [];

const initialFood: Array<[number, number]> = [
  [HALF - 35, HALF - 35],
  [HALF + 35, HALF - 35],
  [HALF + 35, HALF + 35],
  [HALF - 35, HALF + 35],
];

const foodRingGeo = new THREE.RingGeometry(0.8, 2, 20);
const foodMat = new THREE.MeshBasicMaterial({
  color: 0x44cc66,
  transparent: true,
  opacity: 0.3,
  side: THREE.DoubleSide,
});

function addFood(worldX: number, worldZ: number): void {
  const gx = worldX + HALF;
  const gz = worldZ + HALF;
  if (gx < 0 || gx > GRID_SIZE || gz < 0 || gz > GRID_SIZE) return;

  foodSources2D.push({ x: gx, y: gz, radius: PARAMS.foodRadius });

  const mesh = new THREE.Mesh(foodRingGeo.clone(), foodMat.clone());
  mesh.position.set(worldX, 0.1, worldZ);
  const scale = PARAMS.foodRadius / 2;
  mesh.scale.set(scale, scale, scale);
  scene.add(mesh);
  foodMeshes.push(mesh);
}

for (const [fx, fz] of initialFood) {
  addFood(fx - HALF, fz - HALF);
}

// ─── Ants ──────────────────────────────────────────────────────────────────
let ants = createAnts(PARAMS.antCount, GRID_SIZE, HALF, HALF);

let antGeo = new THREE.SphereGeometry(ANT_SCALE, 6, 4);
let antMat = new THREE.MeshStandardMaterial({
  roughness: 0.2,
  metalness: 0.0,
});
let antMesh = new THREE.InstancedMesh(antGeo, antMat, ants.length);
antMesh.instanceColor = new THREE.InstancedBufferAttribute(
  new Float32Array(ants.length * 3), 3,
);
antMesh.count = ants.length;
scene.add(antMesh);

// Temp objects for matrix/color computation
const tmpVec = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const FORAGE_COLOR = new THREE.Color(0x36f9c0);
const RETURN_COLOR = new THREE.Color(0xff8c00);

function rebuildAnts(): void {
  scene.remove(antMesh);
  antGeo.dispose();
  antMat.dispose();

  ants = createAnts(PARAMS.antCount, GRID_SIZE, HALF, HALF);
  antGeo = new THREE.SphereGeometry(ANT_SCALE, 6, 4);
  antMat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.0 });
  antMesh = new THREE.InstancedMesh(antGeo, antMat, ants.length);
  antMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(ants.length * 3), 3,
  );
  antMesh.count = ants.length;
  scene.add(antMesh);
}

function updateAntMeshes(): void {
  const colorArr = antMesh.instanceColor!.array as Float32Array;
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    const wx = ant.x - HALF;
    const wz = ant.y - HALF;
    tmpVec.set(wx, 0.15, wz);
    tmpMat.identity();
    tmpMat.setPosition(tmpVec);
    antMesh.setMatrixAt(i, tmpMat);

    const c =
      ant.state === ANT_STATE_FORAGING ? FORAGE_COLOR : RETURN_COLOR;
    tmpColor.copy(c);
    // Per-ant brightness pulse
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300 + i * 0.1);
    tmpColor.multiplyScalar(pulse);
    colorArr[i * 3] = tmpColor.r;
    colorArr[i * 3 + 1] = tmpColor.g;
    colorArr[i * 3 + 2] = tmpColor.b;
  }
  antMesh.instanceMatrix.needsUpdate = true;
  antMesh.instanceColor!.needsUpdate = true;
}

// ─── Mouse Interaction ─────────────────────────────────────────────────────
const mouseHandler = new MouseHandler(
  camera,
  renderer.domElement,
  {
    onPlaceFood: (x, z) => addFood(x, z),
    onStartNestDrag: () => { /* could show indicator */ },
    onDragNest: (x, z) => {
      nestPos.set(x + HALF, 0, z + HALF);
      nestPos.x = Math.max(2, Math.min(GRID_SIZE - 2, nestPos.x));
      nestPos.z = Math.max(2, Math.min(GRID_SIZE - 2, nestPos.z));
      updateNestVisuals();
      pheromones.clearCircle(nestPos.x, nestPos.z, PARAMS.nestRadius + 2);
    },
    onEndNestDrag: () => { /* could hide indicator */ },
  },
  () => new THREE.Vector3(nestPos.x - HALF, 0, nestPos.z - HALF),
  () => PARAMS.nestRadius,
);

// ─── Resize ────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ─── HUD ───────────────────────────────────────────────────────────────────
const hud = new HUD();

// ─── Debug panel → react to param changes ──────────────────────────────────
window.addEventListener("param-change", ((e: CustomEvent) => {
  if (e.detail.key === "antCount") {
    rebuildAnts();
  }
}) as EventListener);

// ─── Main Loop ─────────────────────────────────────────────────────────────
let animTime = 0;

function frame(): void {
  requestAnimationFrame(frame);
  animTime += 0.016;

  // 1. Update simulation
  updateAnts(
    ants,
    GRID_SIZE,
    pheromones,
    foodSources2D,
    nestPos.x,
    nestPos.z,
  );

  // 2. Step pheromone grid (decay + blur)
  pheromones.step(PARAMS.pheromoneDecay);

  // 3. Render pheromone heatmap to canvas → update GPU texture
  pheromones.renderToCanvas(pheromoneCtx);
  pheromoneTex.needsUpdate = true;

  // 4. Update ant 3D positions
  updateAntMeshes();

  // 5. Animate food patches (pulse + rotation)
  const foodPulse = 0.5 + 0.5 * Math.sin(animTime * 1.5);
  for (const fm of foodMeshes) {
    const mat = fm.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.15 + 0.2 * foodPulse;
    fm.rotation.z = animTime * 0.3;
  }

  // 6. Animate nest glow
  const nestPulse = 0.5 + 0.5 * Math.sin(animTime * 0.8);
  nestMat.emissiveIntensity = 0.15 + 0.3 * nestPulse;
  nestRingMat.opacity = 0.1 + 0.15 * nestPulse;

  // 7. Render
  controls.update();
  renderer.render(scene, camera);

  // 8. HUD
  hud.tick(ants.length);
}

frame();
