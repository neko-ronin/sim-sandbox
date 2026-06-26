import * as THREE from "three";

export type MouseMode = "place-food" | "move-nest";

export interface InteractionCallbacks {
  onPlaceFood: (x: number, z: number) => void;
  onStartNestDrag: () => void;
  onDragNest: (x: number, z: number) => void;
  onEndNestDrag: () => void;
}

/**
 * Handles mouse raycasting for food placement and nest dragging.
 *
 * - Left-click on ground → place food at that world position.
 * - Left-click + hold on nest sphere → drag nest along the ground plane.
 * - OrbitControls handles left-drag elsewhere for camera rotation.
 */
export class MouseHandler {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLCanvasElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly nestGetter: () => THREE.Vector3;

  private mousedownPos = new THREE.Vector2();
  private isDown = false;
  private isDraggingNest = false;
  private CLICK_THRESHOLD = 6; // px

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    callbacks: InteractionCallbacks,
    nestGetter: () => THREE.Vector3,
    private nestRadius: () => number,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;
    this.nestGetter = nestGetter;

    domElement.addEventListener("pointerdown", this._onDown);
    domElement.addEventListener("pointermove", this._onMove);
    domElement.addEventListener("pointerup", this._onUp);
  }

  get mode(): MouseMode {
    return this.isDraggingNest ? "move-nest" : "place-food";
  }

  destroy(): void {
    this.domElement.removeEventListener("pointerdown", this._onDown);
    this.domElement.removeEventListener("pointermove", this._onMove);
    this.domElement.removeEventListener("pointerup", this._onUp);
  }

  /** Raycast pointer to ground plane, return world coords. */
  private _groundPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    const ray = this.raycaster.ray;
    const t = ray.intersectPlane(this.groundPlane, target);
    return t !== null ? target : null;
  }

  /** Is the pointer near the nest sphere (in 3D)? */
  private _isNearNest(clientX: number, clientY: number): boolean {
    const pt = this._groundPoint(clientX, clientY);
    if (!pt) return false;
    const nest = this.nestGetter();
    const dx = pt.x - nest.x;
    const dz = pt.z - nest.z;
    return dx * dx + dz * dz < (this.nestRadius() + 1) * (this.nestRadius() + 1);
  }

  // ── Event handlers ──────────────────────────────────────────
  private _onDown = (e: PointerEvent) => {
    this.mousedownPos.set(e.clientX, e.clientY);
    this.isDown = true;

    if (e.button === 0 && this._isNearNest(e.clientX, e.clientY)) {
      this.isDraggingNest = true;
      this.callbacks.onStartNestDrag();
    }
  };

  private _onMove = (e: PointerEvent) => {
    if (this.isDraggingNest) {
      const pt = this._groundPoint(e.clientX, e.clientY);
      if (pt) {
        this.callbacks.onDragNest(pt.x, pt.z);
      }
      return;
    }
  };

  private _onUp = (e: PointerEvent) => {
    if (!this.isDown) return;
    this.isDown = false;

    const dx = e.clientX - this.mousedownPos.x;
    const dy = e.clientY - this.mousedownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (this.isDraggingNest) {
      this.isDraggingNest = false;
      this.callbacks.onEndNestDrag();
      return;
    }

    // Short click on ground → place food
    if (dist < this.CLICK_THRESHOLD && e.button === 0) {
      const pt = this._groundPoint(e.clientX, e.clientY);
      if (pt) {
        this.callbacks.onPlaceFood(pt.x, pt.z);
      }
    }
  };
}
