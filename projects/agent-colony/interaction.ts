import * as THREE from "three";

export interface InteractionCallbacks {
  onPlaceFood: (x: number, y: number, z: number) => void;
  onStartNestDrag: () => void;
  onDragNest: (x: number, y: number, z: number) => void;
  onEndNestDrag: () => void;
}

/**
 * Handles mouse interaction for the vivarium.
 *
 * Nest selection uses raycaster.intersectObject against the actual mesh,
 * so the user clicks on what they see.  Nest drag projects the mouse onto
 * a plane at the nest's current depth (perpendicular to camera).
 * Food placement projects onto a plane through the cube centre.
 */
export class MouseHandler {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLCanvasElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly nestGetter: () => THREE.Vector3;
  private readonly nestMeshes: THREE.Mesh[];
  private readonly cubeHalf: () => number;

  private mousedown = new THREE.Vector2();
  private isDown = false;
  private isDraggingNest = false;
  private foodPlane = new THREE.Plane();
  private dragPlane = new THREE.Plane();
  private CLICK_THRESHOLD = 6;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    callbacks: InteractionCallbacks,
    nestGetter: () => THREE.Vector3,
    nestMesh: THREE.Mesh,
    cubeHalf: () => number,
    private nestRadius: () => number,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;
    this.nestGetter = nestGetter;
    this.nestMeshes = [nestMesh];  // array for intersectObjects
    this.cubeHalf = cubeHalf;

    // Food-placement plane: through origin, perpendicular to camera
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

  /** Project mouse to a plane at the given depth, clamped to cube. */
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

  /** Does the ray hit the nest mesh? */
  private _hitNest(clientX: number, clientY: number): boolean {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.nestMeshes);
    return hits.length > 0;
  }

  private _onDown = (e: PointerEvent) => {
    this.mousedown.set(e.clientX, e.clientY);
    this.isDown = true;

    if (e.button === 0 && this._hitNest(e.clientX, e.clientY)) {
      this.isDraggingNest = true;
      // Set drag plane at nest's depth
      const nestPos = this.nestGetter();
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      this.dragPlane.setFromNormalAndCoplanarPoint(camDir, nestPos);
      this.callbacks.onStartNestDrag();
    }
  };

  private _onMove = (e: PointerEvent) => {
    if (!this.isDraggingNest) return;
    const pt = this._planePointAtDepth(e.clientX, e.clientY, this.dragPlane);
    if (pt) this.callbacks.onDragNest(pt.x, pt.y, pt.z);
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

    // Short click → place food
    if (dist < this.CLICK_THRESHOLD && e.button === 0) {
      const pt = this._planePointAtDepth(e.clientX, e.clientY, this.foodPlane);
      if (pt) this.callbacks.onPlaceFood(pt.x, pt.y, pt.z);
    }
  };
}
