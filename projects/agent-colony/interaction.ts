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
 * Since the camera is static, we project clicks onto a plane that passes
 * through the origin and is perpendicular to the camera's look direction.
 *
 * This gives a natural 3D feel — clicking a point on the screen maps to
 * a 3D position at that visual depth.
 *
 * - Left-click (short) → place food at that 3D position.
 * - Left-click + hold on nest → drag nest within the vivarium volume.
 */
export class MouseHandler {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLCanvasElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly nestGetter: () => THREE.Vector3;
  private readonly cubeHalf: () => number;

  private mousedown = new THREE.Vector2();
  private isDown = false;
  private isDraggingNest = false;
  private clickPlane = new THREE.Plane();
  private CLICK_THRESHOLD = 6;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    callbacks: InteractionCallbacks,
    nestGetter: () => THREE.Vector3,
    cubeHalf: () => number,
    private nestRadius: () => number,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;
    this.nestGetter = nestGetter;
    this.cubeHalf = cubeHalf;

    // Plane through origin, perpendicular to camera
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    this.clickPlane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3());

    domElement.addEventListener("pointerdown", this._onDown);
    domElement.addEventListener("pointermove", this._onMove);
    domElement.addEventListener("pointerup", this._onUp);
  }

  destroy(): void {
    this.domElement.removeEventListener("pointerdown", this._onDown);
    this.domElement.removeEventListener("pointermove", this._onMove);
    this.domElement.removeEventListener("pointerup", this._onUp);
  }

  /** Get 3D point on the click-plane from screen coords, clamped to cube. */
  private _planePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    const t = this.raycaster.ray.intersectPlane(this.clickPlane, target);
    if (t === null) return null;

    // Clamp to cube bounds
    const half = this.cubeHalf();
    target.x = Math.max(-half, Math.min(half, target.x));
    target.y = Math.max(-half, Math.min(half, target.y));
    target.z = Math.max(-half, Math.min(half, target.z));
    return target;
  }

  private _isNearNest(clientX: number, clientY: number): boolean {
    const pt = this._planePoint(clientX, clientY);
    if (!pt) return false;
    const nest = this.nestGetter();
    const dx = pt.x - nest.x;
    const dy = pt.y - nest.y;
    const dz = pt.z - nest.z;
    const margin = this.nestRadius() + 2;
    return dx * dx + dy * dy + dz * dz < margin * margin;
  }

  private _onDown = (e: PointerEvent) => {
    this.mousedown.set(e.clientX, e.clientY);
    this.isDown = true;

    if (e.button === 0 && this._isNearNest(e.clientX, e.clientY)) {
      this.isDraggingNest = true;
      this.callbacks.onStartNestDrag();
    }
  };

  private _onMove = (e: PointerEvent) => {
    if (!this.isDraggingNest) return;
    const pt = this._planePoint(e.clientX, e.clientY);
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
      const pt = this._planePoint(e.clientX, e.clientY);
      if (pt) this.callbacks.onPlaceFood(pt.x, pt.y, pt.z);
    }
  };
}
