// ─── Swarm Intelligence: 3D Vivarium ────────────────────────────────────────
// Near-sighted agents forage through a cubic volume using two pheromone fields
// (HOME + FOOD — see ants.ts). Visuals are a glowing dark-room aesthetic with
// NO real scene lights — everything is self-lit and bloom carries the glow:
//
//   • Nest and food are emissive glowing orbs.
//   • Agents are a cheap additive instanced shader: a fresnel-rimmed core that
//     glows in its state colour AND picks up the nest/food orbs' colour nearby.
//   • A raymarched volumetric cloud fills the cube, lit by those orb colours.
//   • A bloom pass makes all of the above bleed light into a soft glow.
//
// No transmission, no per-instance PBR — the previous version's frame-killers.
//
// Interaction: left-click to place food · drag the blue nest · drag food.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { DepthOfFieldPass } from "./dof";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

import { PheromoneVolume } from "./pheromone";
import { createAgents, updateAgents, FoodSource3D, STATE_FORAGING } from "./ants";
import { createBodyGeometry, makeDotTexture } from "./amoeba";
import { MouseHandler } from "./interaction";
import { HUD } from "./hud";
import { PARAMS } from "./params";

// ─── Constants ─────────────────────────────────────────────────────────────
const GRID_SIZE = 32; // pheromone volume resolution (must match ants.ts GRID)
const HALF = PARAMS.cubeSize / 2;
const WORLD_TO_GRID = GRID_SIZE / PARAMS.cubeSize;
const NEST_START = new THREE.Vector3(-8, 4, -8);
const NEST_COLOR = 0x5b8cff;
// Food is the scarlet "station"; carriers (orange) sit ~100 RGB / ~31° off it,
// mirroring the cool nest→forager step (~104 / 48°). Food is the deeper anchor,
// the carrier the lighter agent — the warm-side mirror of nest→forager.
const FOOD_COLOR = 0xe63a33;
const NEST_GLOW = 1.7; // steady emissive; cooled to offset the lower bloom threshold
                       // reads dimmer than green at equal intensity
const MAX_AGENT_LIGHTS = 10; // glow sources sampled by the agent shader (fixed array)

// A glow source the volumetric fog + agent shader sample for colour. Not a real
// THREE.PointLight — just the nest and food orbs' own emitted colour. `pos` is
// a live reference (meshes mutate in place), so tinting tracks dragging.
interface SimLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
}
const simLights: SimLight[] = [];

// Shared light arrays uploaded to BOTH the agent shader and the volumetric fog
// each frame (premultiplied colour). One source of truth → update once.
const lightPosArr = Array.from({ length: MAX_AGENT_LIGHTS }, () => new THREE.Vector3(1e4, 1e4, 1e4));
const lightColArr = Array.from({ length: MAX_AGENT_LIGHTS }, () => new THREE.Vector3());

function updateLightUniforms(): void {
  for (let i = 0; i < MAX_AGENT_LIGHTS; i++) {
    if (i < simLights.length) {
      const L = simLights[i];
      lightPosArr[i].copy(L.pos);
      lightColArr[i].set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity);
    } else {
      lightPosArr[i].set(1e4, 1e4, 1e4);
      lightColArr[i].set(0, 0, 0);
    }
  }
}

// ─── Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050c);
scene.fog = new THREE.FogExp2(0x04050c, 0.006);

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
// Cap pixel ratio at 1.5 — retina 2× quadruples fill cost for no real gain here.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x04050c);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
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

// ─── Camera (static by default; optional slow auto-orbit) ────────────────────
// The static framing is the original view. When rotation is enabled, the camera
// orbits the Y axis: the world-space sim, the axis-aligned fog cube, and pointer
// raycasting all stay fixed, so the vivarium appears to turn without desyncing
// any of them. Toggle from the debug panel ("Camera Rotation").
const camera = new THREE.PerspectiveCamera(
  40, window.innerWidth / window.innerHeight, 0.1, 150,
);
const CAM_START = new THREE.Vector3(40, 28, 45);
const CAM_RADIUS = Math.hypot(CAM_START.x, CAM_START.z); // orbit radius in XZ
const CAM_HEIGHT = CAM_START.y;
let camOrbitSpeed = 0.05; // radians/sec — default a full turn every ~2 minutes
let camAngle = Math.atan2(CAM_START.z, CAM_START.x);
let cameraRotating = true; // orbiting by default
camera.position.copy(CAM_START);
camera.lookAt(0, 0, 0);

// ─── Volumetric cloud / fog pass ────────────────────────────────────────────
// Raymarched participating media confined to the vivarium cube. Density is
// domain-warped fractal noise (the swirling, flowing "fluid" look) and the
// medium is lit by the nest/food glow. Marched at HALF resolution and
// composited back at full res so it stays cheap.
const fogVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fogFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3  uCameraPos;
  uniform mat4  uInvProj;
  uniform mat4  uCamWorld;
  uniform float uHalf;
  uniform float uDensity;
  uniform vec3  uLightPos[${MAX_AGENT_LIGHTS}];
  uniform vec3  uLightCol[${MAX_AGENT_LIGHTS}];
  varying vec2 vUv;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  // Cloud density at a world point — domain-warped fbm carved into wisps.
  float clouds(vec3 wp) {
    vec3 q = wp * 0.06 + vec3(0.02, 0.0, 0.015) * uTime;
    vec3 w = vec3(fbm(q + 1.5), 0.0, fbm(q + 5.7));        // horizontal swirl
    float d = fbm(q + 1.4 * w + 0.03 * uTime);
    d = smoothstep(0.48, 1.0, d);
    // Fade toward the cube faces so the volume reads as a contained nebula.
    vec3 ap = abs(wp) / uHalf;
    float edge = (1.0 - smoothstep(0.65, 1.0, ap.x)) *
                 (1.0 - smoothstep(0.65, 1.0, ap.y)) *
                 (1.0 - smoothstep(0.65, 1.0, ap.z));
    return d * edge;
  }

  void main() {
    // Reconstruct a world-space ray through this pixel.
    vec4 clip = vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec4 view = uInvProj * clip; view /= view.w;
    vec3 rd = normalize(mat3(uCamWorld) * normalize(view.xyz));
    vec3 ro = uCameraPos;

    // Intersect the cube [-uHalf, uHalf].
    vec3 t1 = (vec3(-uHalf) - ro) / rd;
    vec3 t2 = (vec3( uHalf) - ro) / rd;
    vec3 tn = min(t1, t2), tf = max(t1, t2);
    float tNear = max(max(tn.x, tn.y), max(tn.z, 0.0));
    float tFar  = min(min(tf.x, tf.y), tf.z);
    if (tFar <= tNear) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    const int STEPS = 15;
    float stepLen = (tFar - tNear) / float(STEPS);
    float jitter = hash(vec3(vUv * 1024.0, uTime)) * stepLen; // dither out banding
    float t = tNear + jitter;

    float transmittance = 1.0;
    vec3 glow = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * t;
      float dens = clouds(p) * uDensity;
      if (dens > 0.002) {
        vec3 lit = vec3(0.015, 0.02, 0.04); // faint cool ambient in-scatter
        for (int l = 0; l < ${MAX_AGENT_LIGHTS}; l++) {
          vec3 toL = uLightPos[l] - p;
          lit += uLightCol[l] / (1.0 + 0.02 * dot(toL, toL));
        }
        float dT = exp(-dens * stepLen);
        glow += transmittance * (1.0 - dT) * lit;
        transmittance *= dT;
        if (transmittance < 0.02) break;
      }
      t += stepLen;
    }
    // rgb = in-scattered glow, a = transmittance of the scene behind the fog.
    gl_FragColor = vec4(glow, transmittance);
  }
`;

const fogComposite = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tFog;
  varying vec2 vUv;
  void main() {
    vec3 scene = texture2D(tScene, vUv).rgb;
    vec4 fog = texture2D(tFog, vUv);
    gl_FragColor = vec4(scene * fog.a + fog.rgb, 1.0);
  }
`;

class VolumetricFogPass extends Pass {
  private cam: THREE.PerspectiveCamera;
  private rt: THREE.WebGLRenderTarget;
  private fogMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  constructor(cam: THREE.PerspectiveCamera, lightPos: THREE.Vector3[], lightCol: THREE.Vector3[], half: number) {
    super();
    this.cam = cam;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.fogMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uHalf: { value: half },
        uDensity: { value: PARAMS.cloudDensity },
        uLightPos: { value: lightPos },
        uLightCol: { value: lightCol },
      },
      vertexShader: fogVert,
      fragmentShader: fogFrag,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tFog: { value: this.rt.texture } },
      vertexShader: fogVert,
      fragmentShader: fogComposite,
    });
    this.quad = new FullScreenQuad(this.fogMat);
  }

  setTime(t: number): void { this.fogMat.uniforms.uTime.value = t; }

  setDensity(d: number): void { this.fogMat.uniforms.uDensity.value = d; }

  setSize(w: number, h: number): void {
    this.rt.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.fogMat.uniforms;
    u.uCameraPos.value.copy(this.cam.position);
    u.uInvProj.value.copy(this.cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.cam.matrixWorld);

    // 1) March the volume into the half-res target (fog only).
    this.quad.material = this.fogMat;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    this.quad.render(renderer);

    // 2) Composite fog over the full-res scene.
    this.compMat.uniforms.tScene.value = readBuffer.texture;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }
}

// ─── Post-processing: fog + bloom ───────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const fogPass = new VolumetricFogPass(camera, lightPosArr, lightColArr, HALF);
composer.addPass(fogPass); // clouds first, so bloom blooms them too

// ─── Depth of field ──────────────────────────────────────────────────────────
// Focus is the focal-plane depth (view-space) in world units; ~66 is the scene
// centre. focusRadius is the fully-sharp band around it; falloff is how far the
// gradient ramps into full blur. All live-tunable via the debug panel.
//
// Ordered BEFORE bloom on purpose: DoF blurs by true geometry depth, then bloom
// glows the result. If bloom ran first, an in-focus subject's bright halo (which
// sits at background depth) would get smeared by DoF and the subject would read
// as out of focus even though its core pixels are sharp.
const dofPass = new DepthOfFieldPass(scene, camera, {
  focus: 40.0, focusRadius: 20.0, falloff: 5.0, maxblur: 0.003,
});
composer.addPass(dofPass);

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55, // strength
  0.5,  // radius
  0.35, // threshold — lowered so the deeper scarlet food blooms; emitters cooled to compensate
);
composer.addPass(bloom);

composer.addPass(new OutputPass());

// No scene lights: every surface is emissive (nest/food) or a self-lit shader
// (agents) and bloom carries the glow. Real THREE.PointLights were removed.

// ─── Pheromone volumes ─────────────────────────────────────────────────────
const homeField = new PheromoneVolume(GRID_SIZE);
const foodField = new PheromoneVolume(GRID_SIZE);

// ─── Nest ──────────────────────────────────────────────────────────────────
const nestPos = NEST_START.clone();
const nestGeo = new THREE.SphereGeometry(1, 32, 24);
const nestMat = new THREE.MeshStandardMaterial({
  color: NEST_COLOR, emissive: NEST_COLOR, emissiveIntensity: NEST_GLOW,
  roughness: 0.35, metalness: 0.0,
});
const nestMesh = new THREE.Mesh(nestGeo, nestMat);
scene.add(nestMesh);

simLights.push({ pos: nestPos, color: new THREE.Color(NEST_COLOR), intensity: 1.6 });

function updateNestVisuals(): void {
  const s = PARAMS.nestRadius;
  nestMesh.position.copy(nestPos);
  nestMesh.scale.set(s, s, s);
}
updateNestVisuals();

// ─── Food sources ──────────────────────────────────────────────────────────
// foodSources3D / foodMeshes / foodSimLights are kept index-aligned; removeFood
// splices all three together when a source is exhausted.
const foodSources3D: FoodSource3D[] = [];
const foodMeshes: THREE.Mesh[] = [];
const foodSimLights: SimLight[] = [];
const FOOD_BASE_SIZE = PARAMS.foodRadius * 0.55;

const initialFood: Array<[number, number, number]> = [
  [HALF - 8, 6, HALF - 8],
  [HALF - 8, -4, -HALF + 8],
  [-HALF + 8, 10, HALF - 8],
  [-HALF + 8, -8, -HALF + 8],
];

const foodSphereGeo = new THREE.SphereGeometry(1, 24, 18);

function addFood(wx: number, wy: number, wz: number): void {
  if (wx < -HALF || wx > HALF || wy < -HALF || wy > HALF || wz < -HALF || wz > HALF) return;

  foodSources3D.push({
    x: wx, y: wy, z: wz, radius: PARAMS.foodRadius,
    value: PARAMS.foodValue, capacity: PARAMS.foodValue,
  });

  const mesh = new THREE.Mesh(
    foodSphereGeo,
    new THREE.MeshStandardMaterial({
      color: FOOD_COLOR, emissive: FOOD_COLOR, emissiveIntensity: 2.4,
      roughness: 0.35, metalness: 0.0,
    }),
  );
  mesh.position.set(wx, wy, wz);
  mesh.scale.setScalar(FOOD_BASE_SIZE);
  scene.add(mesh);
  foodMeshes.push(mesh);

  // The food orb tints nearby agents + fog via its emitted colour.
  const light: SimLight = { pos: mesh.position, color: new THREE.Color(FOOD_COLOR), intensity: 1.2 };
  simLights.push(light);
  foodSimLights.push(light);
}

// Exhausted source: drop the mesh + its light and free GPU resources. The
// geometry is shared across all food, so only the material is disposed.
function removeFood(i: number): void {
  const mesh = foodMeshes[i];
  scene.remove(mesh);
  (mesh.material as THREE.Material).dispose();

  const li = simLights.indexOf(foodSimLights[i]);
  if (li >= 0) simLights.splice(li, 1);

  foodSources3D.splice(i, 1);
  foodMeshes.splice(i, 1);
  foodSimLights.splice(i, 1);
}

for (const [fx, fy, fz] of initialFood) addFood(fx, fy, fz);

// ─── Agents — cellular bodies with leading-edge dot ────────────────────────
// The body is a sphere; the vertex shader deforms it by pushing the front
// surface toward a small bright dot at the leading edge.  The dot can angle
// up to 45° from the body's facing axis, and the body surface bends toward it.
let agents = createAgents(PARAMS.antCount, NEST_START.x, NEST_START.y, NEST_START.z);

const agentUniforms = {
  uTime: { value: 0 },
  uLightPos: { value: lightPosArr },
  uLightCol: { value: lightColArr },
};

const agentVert = `
  attribute float a_dotWeight;
  attribute float a_dotAngleX;
  attribute float a_dotAngleY;
  attribute float a_protrusion;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vColor;
  void main() {
    vec3 pos = position;
    float r = 0.55; // body radius

    // Dot direction in local space — angled up to 45° from +Z.
    // a_dotAngleX/Y are unit-circle constrained: length(xy) <= 1 ensures <=45°.
    vec3 dotDir = normalize(vec3(a_dotAngleX, a_dotAngleY, 1.0));

    // Protrusion: pull front surface outward toward the dot.
    // Max extension is 30% of body radius.
    float prot = a_protrusion * 0.3 * r;
    vec3 protOffset = dotDir * prot;

    // Body bend: vertices on the front half shift laterally toward the dot.
    // The more the dot is off-center, the more the body curves into a crescent.
    vec3 lateral = dotDir - vec3(0, 0, dotDir.z); // perpendicular component only
    float latMag = length(lateral);
    if (latMag > 0.001) {
      lateral /= latMag;
      // Bend amplitude scales with angle and front-weight.
      float bend = latMag * a_dotWeight * 0.5 * r;
      pos += lateral * bend;
    }

    // Apply the protrusion weighted by front-weight.
    pos += protOffset * a_dotWeight;

    // Pulse: subtle breathing of the whole body so it feels alive.
    float breathe = 1.0 + 0.02 * sin(uTime * 2.0 + a_protrusion * 3.0);
    pos *= breathe;

    vec4 wp = instanceMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(instanceMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    vColor = instanceColor;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const agentFrag = `
  uniform vec3 uLightPos[${MAX_AGENT_LIGHTS}];
  uniform vec3 uLightCol[${MAX_AGENT_LIGHTS}];
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vColor;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vViewDir);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    // Cellular body: solid core with a soft glow rim so the shape shows.
    vec3 col = vColor * 0.5 + vColor * fres * 0.7;

    // Pick up colour from nearby lights (subtle environmental tint).
    for (int i = 0; i < ${MAX_AGENT_LIGHTS}; i++) {
      vec3 toL = uLightPos[i] - vWorldPos;
      float d2 = dot(toL, toL);
      float att = 0.2 / (1.0 + 0.03 * d2);
      float diff = max(dot(n, normalize(toL)), 0.0);
      col += uLightCol[i] * att * (0.1 + 0.4 * diff);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const agentMat = new THREE.ShaderMaterial({
  uniforms: agentUniforms,
  vertexShader: agentVert,
  fragmentShader: agentFrag,
  transparent: false,
  blending: THREE.NormalBlending,
  depthWrite: true,
});

let bodyGeo = createBodyGeometry();
bodyGeo.setAttribute("a_dotAngleX", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
bodyGeo.setAttribute("a_dotAngleY", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
bodyGeo.setAttribute("a_protrusion", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
let agentMesh = new THREE.InstancedMesh(bodyGeo, agentMat, agents.length);
agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(agents.length * 3), 3);
scene.add(agentMesh);

// ─── Leading-edge dot sprite ─────────────────────────────────────────────
// A bright tiny point at each agent's front, rendered as additive glowy points.
const dotTex = makeDotTexture();
const dotMat = new THREE.PointsMaterial({
  map: dotTex,
  size: 1.2,
  color: 0xffffff,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
const dotPositions = new Float32Array(agents.length * 3);
const dotColors = new Float32Array(agents.length * 3);
const dotGeo = new THREE.BufferGeometry();
dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPositions, 3));
dotGeo.setAttribute("color", new THREE.BufferAttribute(dotColors, 3));
const dotMesh = new THREE.Points(dotGeo, dotMat);
scene.add(dotMesh);

const tmpVec = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpMat = new THREE.Matrix4();
const FORAGE_DOT_COLOR = new THREE.Color(0x6affff); // bright cyan dot
const RETURN_DOT_COLOR = new THREE.Color(0xffcc44); // bright gold dot
const FORAGE_COLOR = new THREE.Color(0x35e0d0); // teal body — searching
const RETURN_COLOR = new THREE.Color(0xff9a3c); // orange body — carrying food

function rebuildAgents(): void {
  scene.remove(agentMesh);
  scene.remove(dotMesh);
  agentMesh.dispose();
  dotMesh.geometry.dispose();
  bodyGeo.dispose();
  dotMat.dispose();

  agents = createAgents(PARAMS.antCount, nestPos.x, nestPos.y, nestPos.z);

  bodyGeo = createBodyGeometry();
  bodyGeo.setAttribute("a_dotAngleX", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
  bodyGeo.setAttribute("a_dotAngleY", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
  bodyGeo.setAttribute("a_protrusion", new THREE.InstancedBufferAttribute(new Float32Array(agents.length), 1));
  agentMesh = new THREE.InstancedMesh(bodyGeo, agentMat, agents.length);
  agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(agents.length * 3), 3);
  scene.add(agentMesh);

  // Rebuild dot sprite
  const newDotPos = new Float32Array(agents.length * 3);
  const newDotCol = new Float32Array(agents.length * 3);
  const newDotGeo = new THREE.BufferGeometry();
  newDotGeo.setAttribute("position", new THREE.BufferAttribute(newDotPos, 3));
  newDotGeo.setAttribute("color", new THREE.BufferAttribute(newDotCol, 3));
  dotMesh.geometry = newDotGeo;
  dotMesh.geometry.setDrawRange(0, agents.length);
  scene.add(dotMesh);
}

// Scratch vectors for orientation computation
const _svel = new THREE.Vector3();  // smoothed velocity (body facing)
const _vvel = new THREE.Vector3();  // actual velocity
const _dotL = new THREE.Vector3();  // dot direction in body-local frame
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

const BODY_LAG = 0.08; // how fast the body facing chases velocity (lower = more lag)

function updateAgentMeshes(): void {
  const colorArr = agentMesh.instanceColor!.array as Float32Array;
  const angleXAttr = bodyGeo.getAttribute("a_dotAngleX") as THREE.InstancedBufferAttribute;
  const angleYAttr = bodyGeo.getAttribute("a_dotAngleY") as THREE.InstancedBufferAttribute;
  const protAttr = bodyGeo.getAttribute("a_protrusion") as THREE.InstancedBufferAttribute;
  const angleXArr = angleXAttr.array as Float32Array;
  const angleYArr = angleYAttr.array as Float32Array;
  const protArr = protAttr.array as Float32Array;
  const now = performance.now();

  const dp = dotPositions;
  const dc = dotColors;

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];

    // ── 1. Smooth body facing direction (lags behind velocity) ──
    a.smoothVx += (a.vx - a.smoothVx) * BODY_LAG;
    a.smoothVy += (a.vy - a.smoothVy) * BODY_LAG;
    a.smoothVz += (a.vz - a.smoothVz) * BODY_LAG;
    const smLen = Math.hypot(a.smoothVx, a.smoothVy, a.smoothVz);
    if (smLen > 1e-6) {
      a.smoothVx /= smLen;
      a.smoothVy /= smLen;
      a.smoothVz /= smLen;
    } else {
      a.smoothVx = a.vx; a.smoothVy = a.vy; a.smoothVz = a.vz;
    }

    // ── 2. Build oriented matrix from the smoothed body direction ──
    _svel.set(a.smoothVx, a.smoothVy, a.smoothVz);
    _fwd.copy(_svel);
    const fwdLen = _fwd.length();
    if (fwdLen < 0.001) {
      tmpMat.makeTranslation(a.x, a.y, a.z);
    } else {
      _up.set(0, 1, 0);
      _right.crossVectors(_fwd, _up).normalize();
      if (_right.length() < 0.001) {
        _right.set(1, 0, 0);
      }
      _up.crossVectors(_right, _fwd).normalize();
      tmpMat.set(
        _right.x, _up.x, _fwd.x, a.x,
        _right.y, _up.y, _fwd.y, a.y,
        _right.z, _up.z, _fwd.z, a.z,
        0, 0, 0, 1,
      );
    }
    agentMesh.setMatrixAt(i, tmpMat);

    // ── 3. Compute dot direction in body-local space ──
    // The dot points in the actual velocity direction.  Express velocity
    // in the body's local frame (where +Z = smoothed facing).
    _vvel.set(a.vx, a.vy, a.vz);
    _dotL.set(
      _vvel.dot(new THREE.Vector3(_right.x, _right.y, _right.z)),  // local X
      _vvel.dot(new THREE.Vector3(_up.x, _up.y, _up.z)),           // local Y
      _vvel.dot(new THREE.Vector3(_fwd.x, _fwd.y, _fwd.z)),        // local Z (should be ~1)
    );
    // Clamp to 45° cone: ensure local X/Y magnitude doesn't exceed Z.
    // If moving exactly forward, dotDir = (0, 0, 1).
    // DotAngleX/Y represent the lateral displacement in the 45° cone.
    _dotL.normalize();
    angleXArr[i] = _dotL.x;
    angleYArr[i] = _dotL.y;

    // ── 4. Protrusion from agent state ──
    protArr[i] = a.protrusion;

    // ── 5. Dot sprite position ──
    // The dot sits at the body surface, protruding along the body-local
    // dot direction, then transformed to world space.
    const dotR = 0.55 * (1.0 + a.protrusion * 0.3);
    _dotL.set(_dotL.x * dotR, _dotL.y * dotR, _dotL.z * dotR);
    // Transform local dot position to world space via the instance matrix.
    tmpVec.copy(_dotL).applyMatrix4(tmpMat);
    const p = i * 3;
    dp[p] = tmpVec.x;
    dp[p + 1] = tmpVec.y;
    dp[p + 2] = tmpVec.z;

    // ── 6. Body colour ──
    tmpColor.copy(a.state === STATE_FORAGING ? FORAGE_COLOR : RETURN_COLOR);
    const pulse = 0.75 + 0.25 * Math.sin(now / 320 + i * 0.6);
    tmpColor.multiplyScalar(pulse);
    colorArr[i * 3] = tmpColor.r;
    colorArr[i * 3 + 1] = tmpColor.g;
    colorArr[i * 3 + 2] = tmpColor.b;

    // ── 7. Dot colour ──
    tmpColor.copy(a.state === STATE_FORAGING ? FORAGE_DOT_COLOR : RETURN_DOT_COLOR);
    const dpulse = 0.85 + 0.15 * Math.sin(now / 180 + i * 0.9);
    tmpColor.multiplyScalar(dpulse);
    dc[p] = tmpColor.r;
    dc[p + 1] = tmpColor.g;
    dc[p + 2] = tmpColor.b;
  }

  agentMesh.instanceMatrix.needsUpdate = true;
  agentMesh.instanceColor!.needsUpdate = true;
  angleXAttr.needsUpdate = true;
  angleYAttr.needsUpdate = true;
  protAttr.needsUpdate = true;
  dotGeo.attributes.position.needsUpdate = true;
  dotGeo.attributes.color.needsUpdate = true;
}

// ─── Pheromone trail visualisation ──────────────────────────────────────────
// The two stigmergic fields are otherwise invisible data. Render every charged
// grid cell as a soft additive point so the trails glow (food = amber/yellow,
// home = cool blue) — the 3D analogue of the 2D heatmap, and it blooms.
const TRAIL_MAX = GRID_SIZE * GRID_SIZE * GRID_SIZE;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_MAX * 3);
const trailCol = new Float32Array(TRAIL_MAX * 3);
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const trailMat = new THREE.PointsMaterial({
  size: 3.4,
  map: makeGlowTexture(),
  vertexColors: true,
  transparent: true,
  opacity: 0.8,
  sizeAttenuation: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const trail = new THREE.Points(trailGeo, trailMat);
trail.visible = false; // hidden by default; toggle from the debug panel
scene.add(trail);

// Auto-ranged (like the 2D heatmap) so the trail is always visible regardless
// of absolute pheromone magnitude, on an amber → yellow → white-hot ramp.
function updateTrail(): void {
  const home = homeField.grid;
  const food = foodField.grid;
  const cell = PARAMS.cubeSize / GRID_SIZE;

  let pMax = 1e-4;
  for (let i = 0; i < TRAIL_MAX; i++) {
    const c = food[i] + home[i];
    if (c > pMax) pMax = c;
  }
  const inv = 1 / pMax;

  let n = 0;
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      const row = (z * GRID_SIZE + y) * GRID_SIZE;
      for (let x = 0; x < GRID_SIZE; x++) {
        const c = (food[row + x] + home[row + x]) * inv; // 0..1, auto-ranged
        if (c < 0.22) continue; // cull the diffuse halo; keep lanes + sources
        const p = n * 3;
        trailPos[p] = (x + 0.5) * cell - HALF;
        trailPos[p + 1] = (y + 0.5) * cell - HALF;
        trailPos[p + 2] = (z + 0.5) * cell - HALF;
        trailCol[p] = 0.15 + 1.35 * c;        // red — warm, dark at the edges
        trailCol[p + 1] = 0.06 + 1.0 * c;     // green — builds toward yellow
        trailCol[p + 2] = c * c * 1.2;        // blue — only the hot cores go white
        n++;
      }
    }
  }
  trailGeo.setDrawRange(0, n);
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate = true;
}

// ─── Mouse Interaction ─────────────────────────────────────────────────────
const mouseHandler = new MouseHandler(
  camera,
  renderer.domElement,
  {
    onPlaceFood: (x, y, z) => addFood(x, y, z),
    onStartNestDrag: () => { nestMat.emissiveIntensity = 3.4; },
    onDragNest: (x, y, z) => {
      nestPos.set(
        Math.max(-HALF + 2, Math.min(HALF - 2, x)),
        Math.max(-HALF + 2, Math.min(HALF - 2, y)),
        Math.max(-HALF + 2, Math.min(HALF - 2, z)),
      );
      updateNestVisuals();
      const gx = (nestPos.x + HALF) * WORLD_TO_GRID;
      const gy = (nestPos.y + HALF) * WORLD_TO_GRID;
      const gz = (nestPos.z + HALF) * WORLD_TO_GRID;
      const r = PARAMS.nestRadius * WORLD_TO_GRID + 2;
      homeField.clearSphere(gx, gy, gz, r);
      foodField.clearSphere(gx, gy, gz, r);
    },
    onEndNestDrag: () => { nestMat.emissiveIntensity = NEST_GLOW; },
    onStartFoodDrag: () => { },
    onDragFood: (i, x, y, z) => {
      const half = HALF - 2;
      const fx = Math.max(-half, Math.min(half, x));
      const fy = Math.max(-half, Math.min(half, y));
      const fz = Math.max(-half, Math.min(half, z));
      foodMeshes[i].position.set(fx, fy, fz);
      foodSources3D[i].x = fx; foodSources3D[i].y = fy; foodSources3D[i].z = fz;
    },
    onEndFoodDrag: () => { },
  },
  () => nestPos.clone(),
  nestMesh,
  () => foodMeshes,
  () => HALF,
  () => PARAMS.nestRadius,
);

// ─── Resize ────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ─── HUD ───────────────────────────────────────────────────────────────────
const hud = new HUD();

window.addEventListener("param-change", ((e: CustomEvent) => {
  if (e.detail.key === "antCount") rebuildAgents();
  else if (e.detail.key === "cloudDensity") fogPass.setDensity(e.detail.value);
}) as EventListener);

window.addEventListener("camera-rotate-change", ((e: CustomEvent) => {
  cameraRotating = e.detail.rotating;
}) as EventListener);

window.addEventListener("camera-speed-change", ((e: CustomEvent) => {
  camOrbitSpeed = e.detail.value;
}) as EventListener);

window.addEventListener("trail-visible-change", ((e: CustomEvent) => {
  trail.visible = e.detail.visible;
}) as EventListener);

window.addEventListener("dof-change", ((e: CustomEvent) => {
  const u = dofPass.uniforms[e.detail.key];
  if (u) u.value = e.detail.value;
}) as EventListener);

// DoF mode: "off" disables the pass; "on" uses the manual focus slider; "nest"
// tracks the focal plane to the blue nest each frame (see the main loop).
let dofMode: "off" | "on" | "nest" = "on";
const camForward = new THREE.Vector3();
const nestOffset = new THREE.Vector3();
window.addEventListener("dof-mode-change", ((e: CustomEvent) => {
  dofMode = e.detail.mode;
  dofPass.enabled = dofMode !== "off";
}) as EventListener);

// ─── Main Loop ─────────────────────────────────────────────────────────────
let animTime = 0;

function frame(): void {
  requestAnimationFrame(frame);
  animTime += 0.016;

  // When enabled, slowly orbit the camera so the vivarium reads as turning.
  // When off, the camera holds wherever it last was (static by default).
  if (cameraRotating) {
    camAngle += camOrbitSpeed * 0.016;
    camera.position.set(
      Math.cos(camAngle) * CAM_RADIUS,
      CAM_HEIGHT,
      Math.sin(camAngle) * CAM_RADIUS,
    );
    camera.lookAt(0, 0, 0);
  }

  // In NEST mode the focal plane rides the blue nest: focus = camera→nest
  // distance, recomputed each frame so it stays sharp as the camera orbits.
  if (dofMode === "nest") {
    // BokehShader focuses by view-space (perpendicular) depth, not straight-line
    // distance — project nest→camera onto the camera's forward axis so the nest
    // lands exactly on the zero-blur plane regardless of how far off-centre it is.
    camera.getWorldDirection(camForward);
    nestOffset.copy(nestPos).sub(camera.position);
    const nestFocus = nestOffset.dot(camForward);
    dofPass.uniforms.focus.value = nestFocus;
    hud.setDofFocus(nestFocus); // keep the slider in sync with the live distance
  }

  updateAgents(agents, homeField, foodField, foodSources3D, nestPos.x, nestPos.y, nestPos.z, PARAMS.cubeSize);
  homeField.step(PARAMS.pheromoneDecay, PARAMS.blurMix);
  foodField.step(PARAMS.pheromoneDecay, PARAMS.blurMix);

  updateAgentMeshes();
  updateTrail();
  updateLightUniforms();
  agentUniforms.uTime.value = animTime;
  fogPass.setTime(animTime);

  // Nest holds a steady glow (set at creation); the food orbs breathe and
  // shrink toward empty. Iterate backwards so spent sources can be spliced out.
  // Cooled to offset the lower bloom threshold (0.35); the scarlet still clears
  // it and glows without blowing out.
  const foodPulse = 2.2 + 0.6 * (0.5 + 0.5 * Math.sin(animTime * 1.2));
  for (let i = foodMeshes.length - 1; i >= 0; i--) {
    const fs = foodSources3D[i];
    if (fs.value <= 0) { removeFood(i); continue; } // fully drained → gone
    (foodMeshes[i].material as THREE.MeshStandardMaterial).emissiveIntensity = foodPulse;
    // Size tracks remaining value (never quite zero until it's deleted).
    const ratio = fs.value / fs.capacity;
    const breathe = 0.92 + 0.08 * Math.sin(animTime * 1.2 + i);
    foodMeshes[i].scale.setScalar(FOOD_BASE_SIZE * (0.1 + 0.9 * ratio) * breathe);
  }

  composer.render();
  hud.tick(agents.length);
}

// Debug capture hook: ?warmup=N pre-runs N headless sim steps (no render) so a
// screenshot shows steady-state trails without waiting real time. Harmless when absent.
{
  const w = parseInt(new URLSearchParams(location.search).get("warmup") || "0", 10);
  for (let i = 0; i < w; i++) {
    updateAgents(agents, homeField, foodField, foodSources3D, nestPos.x, nestPos.y, nestPos.z, PARAMS.cubeSize);
    homeField.step(PARAMS.pheromoneDecay, PARAMS.blurMix);
    foodField.step(PARAMS.pheromoneDecay, PARAMS.blurMix);
  }
}

frame();
