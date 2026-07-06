import * as THREE from "three";

export interface InteractionCallbacks {
  onPlaceFood: (x: number, y: number, z: number) => void;
  onStartNestDrag: () => void;
  onDragNest: (x: number, y: number, z: number) => void;
  onEndNestDrag: () => void;
  onStartFoodDrag: (index: number) => void;
  onDragFood: (index: number, x: number, y: number, z: number) => void;
  onEndFoodDrag: () => void;
}

/**
 * Handles mouse interaction for the vivarium.
 *
 * - Short click on empty space → place food at random depth.
 * - Click + drag on nest → move nest.
 * - Click + drag on food → move that food item.
 */
export class MouseHandler {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLCanvasElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly nestGetter: () => THREE.Vector3;
  private readonly nestMeshes: THREE.Mesh[];
  private readonly foodGetter: () => THREE.Mesh[];
  private readonly cubeHalf: () => number;

  private mousedown = new THREE.Vector2();
  private isDown = false;
  private isDraggingNest = false;
  private isDraggingFood = false;
  private dragFoodIndex = -1;
  private foodPlane = new THREE.Plane();
  private dragPlane = new THREE.Plane();
  private CLICK_THRESHOLD = 6;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    callbacks: InteractionCallbacks,
    nestGetter: () => THREE.Vector3,
    nestMesh: THREE.Mesh,
    foodGetter: () => THREE.Mesh[],
    cubeHalf: () => number,
    private nestRadius: () => number,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;
    this.nestGetter = nestGetter;
    this.nestMeshes = [nestMesh];
    this.foodGetter = foodGetter;
    this.cubeHalf = cubeHalf;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    this.foodPlane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3());

    domElement.addEventListener("pointerdown", this._onDown);
    domElement.addEventListener("pointermove", this._onMove);
    domElement.addEventListener("pointerup", this._onUp);
  }

  destroy(): void {
    this.domElement.removeEventListener("pointerdown", this._onDown);
    this.domElement.removeEventListener("pointermove", this._onMove);
    this.domElement.removeEventListener("pointerup", this._onUp);
  }

  private _planePointAtDepth(
    clientX: number,
    clientY: number,
    plane: THREE.Plane,
  ): THREE.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    const t = this.raycaster.ray.intersectPlane(plane, target);
    if (t === null) return null;

    const half = this.cubeHalf();
    target.x = Math.max(-half, Math.min(half, target.x));
    target.y = Math.max(-half, Math.min(half, target.y));
    target.z = Math.max(-half, Math.min(half, target.z));
    return target;
  }

  /** Find first hit among a set of meshes. Returns { mesh, index } or null. */
  private _hitAny(meshes: THREE.Mesh[]): { mesh: THREE.Mesh; index: number } | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = -1;
    this.pointer.y = -1;
    // Re-set from stored event coords — use last stored mousedown
    return null; // overridden below
  }

  private _hitNest(clientX: number, clientY: number): boolean {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nestMeshes);
    return hits.length > 0;
  }

  /** Hit-test food meshes, return the index of the hit mesh or -1. */
  private _hitFood(clientX: number, clientY: number): number {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const food = this.foodGetter();
    if (food.length === 0) return -1;
    const hits = this.raycaster.intersectObjects(food);
    if (hits.length === 0) return -1;
    // Find which index the hit mesh corresponds to
    const hitMesh = hits[0].object as THREE.Mesh;
    return food.indexOf(hitMesh);
  }

  private _onDown = (e: PointerEvent) => {
    this.mousedown.set(e.clientX, e.clientY);
    this.isDown = true;

    // Check food first (so food takes priority over nest if overlapping)
    const foodIdx = this._hitFood(e.clientX, e.clientY);
    if (e.button === 0 && foodIdx >= 0) {
      this.isDraggingFood = true;
      this.dragFoodIndex = foodIdx;
      // Set drag plane at the food's depth
      const foodPos = this.foodGetter()[foodIdx].position;
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      this.dragPlane.setFromNormalAndCoplanarPoint(camDir, foodPos);
      this.callbacks.onStartFoodDrag(foodIdx);
      return;
    }

    // Check nest
    if (e.button === 0 && this._hitNest(e.clientX, e.clientY)) {
      this.isDraggingNest = true;
      const nestPos = this.nestGetter();
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      this.dragPlane.setFromNormalAndCoplanarPoint(camDir, nestPos);
      this.callbacks.onStartNestDrag();
    }
  };

  private _onMove = (e: PointerEvent) => {
    if (this.isDraggingNest) {
      const pt = this._planePointAtDepth(e.clientX, e.clientY, this.dragPlane);
      if (pt) this.callbacks.onDragNest(pt.x, pt.y, pt.z);
    } else if (this.isDraggingFood) {
      const pt = this._planePointAtDepth(e.clientX, e.clientY, this.dragPlane);
      if (pt) this.callbacks.onDragFood(this.dragFoodIndex, pt.x, pt.y, pt.z);
    }
  };

  private _onUp = (e: PointerEvent) => {
    if (!this.isDown) return;
    this.isDown = false;

    const dx = e.clientX - this.mousedown.x;
    const dy = e.clientY - this.mousedown.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (this.isDraggingNest) {
      this.isDraggingNest = false;
      this.callbacks.onEndNestDrag();
      return;
    }
    if (this.isDraggingFood) {
      this.isDraggingFood = false;
      this.dragFoodIndex = -1;
      this.callbacks.onEndFoodDrag();
      return;
    }

    // Short click → place food with random depth
    if (dist < this.CLICK_THRESHOLD && e.button === 0) {
      const pt = this._planePointAtDepth(e.clientX, e.clientY, this.foodPlane);
      if (pt) {
        // Add random depth offset (along camera look direction) so food
        // scatters through the volume instead of all on one plane
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        const depthOffset = (Math.random() - 0.5) * this.cubeHalf() * 1.2;
        pt.x += camDir.x * depthOffset;
        pt.y += camDir.y * depthOffset;
        pt.z += camDir.z * depthOffset;
        // Re-clamp
        const half = this.cubeHalf();
        pt.x = Math.max(-half, Math.min(half, pt.x));
        pt.y = Math.max(-half, Math.min(half, pt.y));
        pt.z = Math.max(-half, Math.min(half, pt.z));
        this.callbacks.onPlaceFood(pt.x, pt.y, pt.z);
      }
    }
  };
}
