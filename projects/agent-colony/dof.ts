// ─── Depth-of-field pass with an intuitive "sharp zone + gradient" curve ──────
//
// A reshaped fork of three's BokehPass. The stock bokeh blur is a single linear
// ramp out of the focal *plane* governed by `aperture`/`maxblur` — optical knobs
// that don't map to "how wide is the sharp area" or "how soft is the edge".
//
// This pass replaces that curve with a band model in world units:
//   • everything within `focusRadius` of the focal plane is fully sharp,
//   • blur then smoothsteps from 0 → `maxblur` over the next `falloff` units,
//   • beyond that it's clamped at `maxblur`.
// `focus` is the focal-plane depth (view-space / perpendicular distance). The
// bokeh ring sampling itself is unchanged from the original shader.

import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import {
  Color,
  HalfFloatType,
  MeshDepthMaterial,
  NearestFilter,
  NoBlending,
  RGBADepthPacking,
  ShaderMaterial,
  WebGLRenderTarget,
} from "three";
import type { PerspectiveCamera, Scene, WebGLRenderer, IUniform } from "three";

export interface DofParams {
  focus?: number;       // focal-plane depth, world units (perpendicular)
  focusRadius?: number; // half-width of the fully-sharp band, world units
  falloff?: number;     // depth over which blur ramps to max, world units
  maxblur?: number;     // blur ceiling (screen-space fraction)
}

const fragmentShader = /* glsl */ `
  #include <common>

  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;

  uniform float maxblur;     // blur ceiling
  uniform float focusRadius; // sharp band half-width (world units)
  uniform float falloff;     // ramp distance into full blur (world units)

  uniform float nearClip;
  uniform float farClip;

  uniform float focus;
  uniform float aspect;

  #include <packing>

  float getDepth( const in vec2 screenPosition ) {
    return unpackRGBAToDepth( texture2D( tDepth, screenPosition ) );
  }

  float getViewZ( const in float depth ) {
    return perspectiveDepthToViewZ( depth, nearClip, farClip );
  }

  void main() {

    vec2 aspectcorrect = vec2( 1.0, aspect );

    float viewZ = getViewZ( getDepth( vUv ) );

    // Distance from the focal plane in world units (focus + viewZ; viewZ <= 0).
    float dist = abs( focus + viewZ );

    // Flat sharp band of half-width focusRadius, then a smoothstep ramp to full
    // blur over falloff units. This is the whole area-of-focus + gradient model.
    float t = smoothstep( focusRadius, focusRadius + max( falloff, 1e-4 ), dist );
    float coc = t * maxblur; // circle-of-confusion radius (screen fraction)

    vec4 col = texture2D( tColor, vUv );

    // Gather over a dense golden-angle (sunflower) disc rather than a few fixed
    // rings — even coverage means smooth bokeh instead of the ghosted, duplicated
    // highlights the original 41-tap kernel produces on bright/bloomed pixels.
    if ( coc > 0.00015 ) {
      float total = 1.0;
      for ( int i = 1; i <= DOF_SAMPLES; i++ ) {
        float fi = float( i );
        float r = sqrt( fi / float( DOF_SAMPLES ) );   // uniform area distribution
        float a = fi * 2.39996323;                     // golden angle, radians
        vec2 offset = vec2( cos( a ), sin( a ) ) * r * coc * aspectcorrect;
        col += texture2D( tColor, vUv + offset );
        total += 1.0;
      }
      col /= total;
    }

    gl_FragColor = vec4( col.rgb, 1.0 );

  }`;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

export class DepthOfFieldPass extends Pass {
  uniforms: Record<string, IUniform>;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private renderTargetDepth: WebGLRenderTarget;
  private materialDepth: MeshDepthMaterial;
  private materialBokeh: ShaderMaterial;
  private fsQuad: FullScreenQuad;
  private _oldClearColor = new Color();

  constructor(scene: Scene, camera: PerspectiveCamera, params: DofParams = {}) {
    super();
    this.scene = scene;
    this.camera = camera;

    this.renderTargetDepth = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      type: HalfFloatType,
    });
    this.renderTargetDepth.texture.name = "DepthOfFieldPass.depth";

    this.materialDepth = new MeshDepthMaterial();
    this.materialDepth.depthPacking = RGBADepthPacking;
    this.materialDepth.blending = NoBlending;

    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: this.renderTargetDepth.texture },
      focus: { value: params.focus ?? 30.0 },
      focusRadius: { value: params.focusRadius ?? 8.0 },
      falloff: { value: params.falloff ?? 25.0 },
      maxblur: { value: params.maxblur ?? 0.02 },
      aspect: { value: camera.aspect },
      nearClip: { value: camera.near },
      farClip: { value: camera.far },
    };

    this.materialBokeh = new ShaderMaterial({
      defines: { DOF_SAMPLES: 48 }, // disc tap count; higher = smoother, costlier
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
    });

    this.fsQuad = new FullScreenQuad(this.materialBokeh);
  }

  render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    // Depth pass: re-render the scene with a packed-depth material.
    this.scene.overrideMaterial = this.materialDepth;

    renderer.getClearColor(this._oldClearColor);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    renderer.setClearColor(0xffffff);
    renderer.setClearAlpha(1.0);
    renderer.setRenderTarget(this.renderTargetDepth);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // Composite pass: bokeh blur driven by that depth.
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.nearClip.value = this.camera.near;
    this.uniforms.farClip.value = this.camera.far;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      renderer.clear();
      this.fsQuad.render(renderer);
    }

    this.scene.overrideMaterial = null;
    renderer.setClearColor(this._oldClearColor);
    renderer.setClearAlpha(oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  setSize(width: number, height: number): void {
    this.uniforms.aspect.value = width / height;
    this.renderTargetDepth.setSize(width, height);
  }

  dispose(): void {
    this.renderTargetDepth.dispose();
    this.materialDepth.dispose();
    this.materialBokeh.dispose();
    this.fsQuad.dispose();
  }
}
