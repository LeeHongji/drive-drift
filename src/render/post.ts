// Post-processing stack: the engine's CameraFrame on the main camera.
//
// The scene renders into an HDR (RGBA16F) multisampled target and one full-screen compose pass turns it into
// the final image. Effects run in the order of `cameraFrame.effects` inside each compose slot:
//
//   scene slot : fringing → CAS sharpen → (custom scene effects)
//   hdr slot   : bloom → colour grading → lens flare
//   ACES tone mapping
//   ldr slot   : vignette
//   gamma
//
// Effects with passes of their own: volumetric fog (after the scene), dynamic sky (lighting bake, clouds and
// the sky dome), lens flare (occlusion + sprites), auto exposure (histogram of the half-resolution scene).
//
// Everything here is an engine class (playcanvas 2.24.3, build/playcanvas/src/extras/…); there is no custom
// shader code in this file. The only shader edit in the slice is the sun-disc clamp in src/world/sky.ts.
//
// Adding a custom effect (speed blur, lens droplets):
//
//   class Droplets extends pc.CameraFrameEffect {
//     amount = 1;
//     constructor(device: pc.GraphicsDevice) {
//       super(device, 'droplets', {            // id → entry function `applyDroplets`, define `DROPLETS`
//         slot: pc.COMPOSESLOT_SCENE,          // 'scene' | 'hdr' | 'ldr' | 'output'
//         requires: [pc.FRAMERESOURCE_DEPTH],  // only if the chunk calls getLinearScreenDepth(uv)
//         glsl: `uniform float dropletsAmount;
//                vec4 applyDroplets(vec4 scene, vec2 uv) { return scene; }`,
//         wgsl: `uniform dropletsAmount: f32;
//                fn applyDroplets(scene: vec4f, uv: vec2f) -> vec4f { return scene; }`,
//       });
//     }
//     update(): void { this.setUniform('dropletsAmount', this.amount); }   // runs on every post.update
//   }
//   const droplets = new Droplets(app.graphicsDevice);
//   post.addEffect(droplets);                  // appended: runs after fringing and CAS in the scene slot
//   // then set droplets.amount (and droplets.enabled) each frame before post.update(frame)
//
// Entry function signatures: scene slot `vec4 f(vec4 scene, vec2 uv)` on the HDR scene colour before
// anything else; hdr slot `vec3 f(vec3 color, vec2 uv)` before tone mapping; ldr slot the same after tone
// mapping; output slot the same after gamma. Chunks may read `sceneTexture` (WGSL: with
// `sceneTextureSampler`) and `sceneTextureSize` (w, h, 1/w, 1/h). In WGSL uniforms are read as `uniform.name`.

import * as pc from 'playcanvas';
import { POST, type FlareShape } from '../config/post';
import { QUALITY } from '../config/quality';
import type { FrameState, FrameSystem } from '../core/frame';
import { clamp } from '../core/math';
import type { Sky } from '../world/sky';

export interface Post extends FrameSystem {
  /** The engine CameraFrame. Its built-in effects (bloom, vignette, grading, fringing, volumetricFog, dof,
   *  taa, ssao) are fields on it; settings changed there apply on the next `update`. */
  readonly cameraFrame: pc.CameraFrame;
  /** False when the device cannot render to RGBA16F: the scene target is 8-bit and bloom is off. */
  readonly hdr: boolean;
  /** Null when switched off by the quality preset or the config. */
  readonly lensFlare: pc.LensFlareEffect | null;
  readonly autoExposure: pc.AutoExposureEffect | null;
  /** Register a custom effect. It runs after the existing effects of its slot, or before `before` (an
   *  effect or its id, e.g. 'cas') when given. */
  addEffect(effect: pc.CameraFrameEffect, before?: pc.CameraFrameEffect | string): void;
  removeEffect(effect: pc.CameraFrameEffect): void;
  /** Animate the nitro-driven values and apply all pending effect settings. Call once per rendered frame,
   *  after game.ts has set `scene.fog.density`. */
  update(frame: FrameState): void;
}

/**
 * Configure the post stack on `camera` (an entity with a camera component). Pass the sky so that the dynamic
 * sky is drawn by this camera and the sun gets its light shafts and lens flare; without it the stack still
 * works, with the static sky and without those two.
 */
export function createPost(app: pc.AppBase, camera: pc.Entity, sky?: Sky): Post {
  const component = camera.camera;
  if (!component) throw new Error('createPost: the entity has no camera component');
  const device = app.graphicsDevice;
  const P = POST;

  // The scene pass overrides the camera's own tone mapping and gamma while it renders, so the component's
  // ACES / sRGB settings can stay: they only apply to what is drawn after the compose pass (the UI layer).
  const cameraFrame = new pc.CameraFrame(app, component);
  const rendering = cameraFrame.rendering;
  // If RGBA16F is not renderable the engine falls back to RGBA8 and bloom deactivates itself.
  rendering.renderFormats = [pc.PIXELFORMAT_RGBA16F];
  rendering.samples = QUALITY.msaa;
  rendering.toneMapping = pc.TONEMAP_ACES;
  rendering.sharpness = P.sharpness;

  const { bloom, vignette, grading, fringing, volumetricFog } = cameraFrame;
  bloom.intensity = P.bloom.intensity;
  bloom.blurLevel = P.bloom.blurLevel;
  vignette.intensity = P.vignette.intensity;
  vignette.inner = P.vignette.inner;
  vignette.outer = P.vignette.outer;
  vignette.curvature = P.vignette.curvature;
  grading.enabled = true;
  grading.saturation = P.grading.saturation;
  grading.contrast = P.grading.contrast;
  grading.brightness = P.grading.brightness;
  grading.tint.set(...P.grading.tint);
  fringing.intensity = P.fringing.intensity;

  const sunLight = sky?.sun.light ?? null;

  // Volumetric fog needs the scene depth. With MSAA that costs a depth prepass of the opaque scene.
  if (QUALITY.fogSteps > 0 && sunLight) {
    volumetricFog.enabled = true;
    volumetricFog.light = sunLight;
    volumetricFog.density = P.fog.density;
    volumetricFog.heightBase = P.fog.heightBase;
    volumetricFog.heightFalloff = P.fog.heightFalloff;
    volumetricFog.intensity = P.fog.intensity;
    volumetricFog.ambientIntensity = P.fog.ambientIntensity;
    volumetricFog.anisotropy = P.fog.anisotropy;
    volumetricFog.maxDistance = P.fog.maxDistance;
    // The engine clamps steps to 4…128 and scale to 0.25…1.
    volumetricFog.steps = QUALITY.fogSteps;
    volumetricFog.scale = QUALITY.fogScale;
  }

  // Appended effects, in the benchmark's order: dynamic sky, lens flare, auto exposure, then custom ones.
  sky?.attach(cameraFrame);

  // The flare also needs the scene depth (for occlusion), so it shares the "lens effects" quality switch:
  // on the low preset nothing in this stack asks for depth and no prepass is rendered.
  let lensFlare: pc.LensFlareEffect | null = null;
  if (QUALITY.lensEffects && P.flare.intensity > 0 && sunLight) {
    lensFlare = new pc.LensFlareEffect(device);
    lensFlare.intensity = P.flare.intensity;
    lensFlare.scale = P.flare.scale;
    const shapes: Record<string, pc.Texture> = {};
    for (const { shape } of P.flare.elements) shapes[shape] ??= makeFlareShape(device, shape, P.flare.shapeSize);
    lensFlare.shapes = { resolution: P.flare.shapeSize, shapes };
    const flare = new pc.LensFlare({ elements: P.flare.elements.map((e) => ({ ...e })) }, { light: sunLight });
    flare.occlusionRadius = P.flare.occlusionRadius;
    flare.occlusionFade = P.flare.occlusionFade;
    lensFlare.add(flare);
    cameraFrame.addEffect(lensFlare);
  }

  let autoExposure: pc.AutoExposureEffect | null = null;
  if (P.exposure.enabled && P.exposure.mode === 'auto') {
    autoExposure = new pc.AutoExposureEffect(device);
    autoExposure.minEv = P.exposure.minEv;
    autoExposure.maxEv = P.exposure.maxEv;
    autoExposure.compensation = P.exposure.compensation;
    autoExposure.speedLightToDark = P.exposure.speedLightToDark;
    autoExposure.speedDarkToLight = P.exposure.speedDarkToLight;
    autoExposure.lowPercent = P.exposure.lowPercent;
    autoExposure.highPercent = P.exposure.highPercent;
    autoExposure.centerWeight = P.exposure.centerWeight;
    cameraFrame.addEffect(autoExposure);
  }

  cameraFrame.update();
  const hdr = cameraFrame.hdrFormat !== pc.PIXELFORMAT_RGBA8;
  if (!hdr) console.warn('[post] RGBA16F render targets unavailable: 8-bit scene target, bloom off');

  let kick = 0;
  let wasBoosting = false;
  /** `tunnel` exposure mode: current stops above the outdoor exposure. */
  let ev = 0;
  const baseExposure = app.scene.exposure;

  return {
    cameraFrame,
    hdr,
    lensFlare,
    autoExposure,
    addEffect(effect, before) {
      if (before === undefined) cameraFrame.addEffect(effect);
      else cameraFrame.insertEffectBefore(effect, before);
    },
    removeEffect(effect) {
      cameraFrame.removeEffect(effect);
    },
    update(frame: FrameState): void {
      const boosting = frame.car.boost;
      if (boosting && !wasBoosting) kick = 1;
      wasBoosting = boosting;
      kick = Math.max(0, kick - frame.dt * P.kickDecay);
      const boost = clamp(frame.boost, 0, 1);
      const surge = clamp(frame.surge, 0, 1);

      bloom.intensity = P.bloom.intensity * (1 + boost * P.bloom.boost + kick * P.bloom.kick + surge * P.bloom.surge);
      vignette.intensity = P.vignette.intensity + boost * P.vignette.boost + surge * P.vignette.surge;
      fringing.intensity = P.fringing.intensity + boost * P.fringing.boost + kick * P.fringing.kick + surge * P.fringing.surge;

      if (P.exposure.enabled && P.exposure.mode === 'tunnel') {
        // Eyes adapt to the dark faster than back to the light, as with the metered version.
        const target = P.exposure.tunnelEv * clamp(frame.tunnel, 0, 1);
        const rate = target > ev ? P.exposure.speedLightToDark : P.exposure.speedDarkToLight;
        ev += (target - ev) * (1 - Math.exp(-rate * frame.dt));
        app.scene.exposure = baseExposure * Math.pow(2, ev);
      }

      sky?.update();
      cameraFrame.update();
    },
  };
}

// ── Lens flare shapes ────────────────────────────────────────────────────────────────────────────────────
// The engine's flare effect draws textured sprites but the npm package ships no shape textures, so the four
// shapes are generated here: white on black, linear intensity 0…1, fading to 0 at the edge of the square.

const srgbByte = (linear: number): number => {
  const v = clamp(linear, 0, 1);
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
};

/** Intensity of a thin line through the centre at `angle` (radians); `width` in units of the half-square. */
const ray = (u: number, v: number, angle: number, width: number): number => {
  const d = (u * Math.sin(angle) - v * Math.cos(angle)) / width;
  return Math.exp(-d * d);
};

/** Shape intensity per channel at (u, v) in −1…1. */
function flareShape(shape: FlareShape, u: number, v: number, out: number[]): void {
  const r = Math.hypot(u, v);
  const fade = Math.max(0, 1 - r);
  let value = 0;
  switch (shape) {
    case 'glow_soft':
      // Gaussian blob, forced to 0 at the rim.
      value = Math.exp(-4.5 * r * r) * Math.min(1, fade * 5);
      break;
    case 'burst_star': {
      // Hot core, six long spikes and eight short faint ones.
      let long = 0;
      for (let k = 0; k < 3; k++) long += ray(u, v, 0.26 + (k * Math.PI) / 3, 0.012);
      let short = 0;
      for (let k = 0; k < 4; k++) short += ray(u, v, 0.61 + (k * Math.PI) / 4, 0.008);
      const reach = Math.max(0, 1 - r / 0.6);
      value = Math.exp(-(r * r) / 0.0025) + long * fade * fade * fade + 0.4 * short * reach * reach * reach + 0.15 * Math.pow(fade, 4);
      break;
    }
    case 'anamorphic_streak': {
      // Horizontal line; the element's aspect stretches it across the screen.
      const along = Math.max(0, 1 - Math.abs(u));
      value = Math.exp(-(v * v) / 0.05) * along * along;
      break;
    }
    case 'halo':
      // Thin ring with a slight colour split (red outside, blue inside).
      for (let c = 0; c < 3; c++) {
        const d = (r - (0.8 - 0.02 * c)) / 0.045;
        out[c] = Math.exp(-d * d);
      }
      return;
  }
  out[0] = out[1] = out[2] = value;
}

function makeFlareShape(device: pc.GraphicsDevice, shape: FlareShape, size: number): pc.Texture {
  const data = new Uint8Array(size * size * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      flareShape(shape, ((x + 0.5) / size) * 2 - 1, v, rgb);
      const o = (y * size + x) * 4;
      data[o] = srgbByte(rgb[0]);
      data[o + 1] = srgbByte(rgb[1]);
      data[o + 2] = srgbByte(rgb[2]);
      data[o + 3] = 255;
    }
  }
  // sRGB storage keeps precision in the dim tails; the effect samples it as linear.
  return new pc.Texture(device, {
    name: `flare-${shape}`,
    width: size,
    height: size,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    levels: [data],
  });
}
