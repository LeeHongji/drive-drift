// Sky, sun light, environment lighting and distance fog.
//
// The normal sky is the engine's DynamicSkyEffect: a physically based atmosphere with volumetric clouds that
// also bakes the environment atlas (image-based lighting and reflections) and hazes distant surfaces into
// the sky colour behind them. It is a CameraFrame effect, so it only exists once src/render/post.ts has
// called `attach` with the main camera's CameraFrame.
//
// The fallback is the static procedural sky from M1: an equirect gradient with a sun disc and noise clouds,
// used as skybox and lighting source, plus single-colour EXP2 scene fog. It is built when RENDER.dynamicSky
// is off, when `createSky` is asked for it, or when the app starts without a CameraFrame having attached.
//
// Both use the same sun direction (RENDER.sunElevation / sunAzimuth) and the same directional light.

import * as pc from 'playcanvas';
import { QUALITY } from '../config/quality';
import { RENDER } from '../config/render';
import { LIT_LAYERS } from '../render/layers';
import { clamp, DEG, lerp, smoothstep } from '../core/math';

/** Unit vector pointing from the scene toward the sun. Azimuth 0 = −Z, clockwise seen from above. */
export function sunDirection(): pc.Vec3 {
  const e = RENDER.sunElevation * DEG;
  const a = RENDER.sunAzimuth * DEG;
  return new pc.Vec3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

export interface SkyOptions {
  /** Override RENDER.dynamicSky (for example from a `?sky=static` URL switch). */
  dynamic?: boolean;
}

export interface Sky {
  sun: pc.Entity;
  sunDir: pc.Vec3;
  /** The engine's dynamic sky once attached; null while the static sky (or no sky yet) is in use. */
  readonly effect: pc.DynamicSkyEffect | null;
  /** Add the dynamic sky to the main camera's CameraFrame. Called by createPost; does nothing when the
   *  static sky was requested. The caller applies it with `cameraFrame.update()`. */
  attach(cameraFrame: pc.CameraFrame): void;
  /** Per-frame sync, called by the post stack: the haze follows `scene.fog.density`. */
  update(): void;
}

export function createSky(app: pc.AppBase, options: SkyOptions = {}): Sky {
  const scene = app.scene;
  const sunDir = sunDirection();
  const wantDynamic = options.dynamic ?? RENDER.dynamicSky;

  scene.skyboxIntensity = RENDER.skyboxIntensity;
  scene.exposure = RENDER.exposure;
  // Scene fog serves the static sky and every camera without the dynamic sky's haze.
  scene.fog.type = pc.FOG_EXP2;
  scene.fog.color.set(...RENDER.fogColor);
  scene.fog.density = RENDER.fogDensity;

  const sun = new pc.Entity('Sun');
  sun.addComponent('light', {
    type: 'directional',
    color: new pc.Color(...RENDER.sunColor),
    intensity: RENDER.sunIntensity,
    layers: LIT_LAYERS,
    castShadows: true,
    shadowType: pc.SHADOW_PCF5_32F,
    shadowResolution: QUALITY.shadowResolution,
    shadowDistance: QUALITY.shadowDistance,
    numCascades: QUALITY.shadowCascades,
    cascadeDistribution: RENDER.cascadeDistribution,
    shadowBias: RENDER.shadowBias,
    normalOffsetBias: RENDER.normalOffsetBias,
  });
  // A directional light shines along its local −Y, so rotate +Y onto the sun direction.
  const axis = new pc.Vec3().cross(pc.Vec3.UP, sunDir).normalize();
  const angle = Math.acos(clamp(pc.Vec3.UP.dot(sunDir), -1, 1)) / DEG;
  sun.setRotation(new pc.Quat().setFromAxisAngle(axis, angle));
  app.root.addChild(sun);

  let effect: pc.DynamicSkyEffect | null = null;
  let fallback: StaticSky | null = null;

  const useStatic = (): void => {
    if (effect || fallback) return;
    fallback = buildStaticSky(app, sunDir);
  };
  if (!wantDynamic) {
    useStatic();
  } else {
    // The dynamic sky cannot draw without a CameraFrame. If none has attached by the time the app starts
    // (post stack not wired up, or switched off), light the scene with the static sky instead.
    app.once('start', () => {
      if (effect) return;
      console.info('[sky] no CameraFrame attached: using the static procedural sky');
      useStatic();
    });
  }

  return {
    sun,
    sunDir,
    get effect() {
      return effect;
    },
    attach(cameraFrame: pc.CameraFrame): void {
      if (!wantDynamic || effect) return;
      if (fallback) {
        // Attached after the app started: drop the static sky. With no skybox set, cameras without the
        // effect draw the environment atlas the dynamic sky bakes.
        scene.skybox = null;
        scene.envAtlas = null;
        fallback.skybox.destroy();
        fallback.atlas.destroy();
        fallback = null;
      }
      effect = createDynamicSky(app, sun);
      cameraFrame.addEffect(effect);
    },
    update(): void {
      if (effect && effect.haze) effect.hazeDensity = scene.fog.density;
    },
  };
}

// ── Dynamic sky ──────────────────────────────────────────────────────────────────────────────────────────

function createDynamicSky(app: pc.AppBase, sun: pc.Entity): pc.DynamicSkyEffect {
  const R = RENDER;
  const sky = new pc.DynamicSkyEffect(app.graphicsDevice);
  // The constructor (re)registers the engine's sky shader chunks, so the patch goes right after it.
  if (R.sunDiscMax > 0) clampSunDisc(app.graphicsDevice, R.sunDiscMax);

  sky.elevation = R.sunElevation;
  // The engine measures azimuth from +Z toward +X; ours runs from −Z toward +X.
  sky.azimuth = 180 - R.sunAzimuth;
  sky.sunIntensity = R.sunIntensity;
  sky.luminance = R.skyLuminance;
  sky.turbidity = R.turbidity;
  sky.rayleigh = R.rayleigh;
  sky.mieCoefficient = R.mieCoefficient;
  sky.mieDirectionalG = R.mieDirectionalG;
  // With a light assigned the sky keeps its direction, colour and intensity in step with the sun.
  // Without one the light keeps the rotation, colour and intensity set in createSky.
  if (R.skyDrivesSun) sky.light = sun.light ?? null;

  const level = Math.min(QUALITY.clouds, R.cloudLevels.length);
  if (level > 0) {
    const [scale, quality] = R.cloudLevels[level - 1];
    sky.cloudType = pc.CLOUDTYPE_VOLUMETRIC;
    sky.cloudResolution = scale;
    sky.cloudQuality = quality;
    sky.cloudCoverage = R.cloudCoverage;
    sky.cloudSoftness = R.cloudSoftness;
    sky.cloudBrightness = R.cloudBrightness;
    sky.cloudSunDimming = R.cloudSunDimming;
    sky.windSpeed = R.windSpeed;
    sky.windDirection = R.windDirection;
  } else {
    sky.cloudType = pc.CLOUDTYPE_NONE;
  }

  // The haze replaces the scene fog on this camera: lit materials fade into the sky colour behind them,
  // which matches the horizon in every direction (warm toward the sun, blue away from it).
  sky.haze = R.haze;
  sky.hazeDensity = app.scene.fog.density;
  sky.hazeHeight = R.hazeHeight;
  sky.hazeBaseHeight = R.hazeBaseHeight;

  // Image-based lighting and reflections: baked once from the sky into scene.envAtlas (the sun never moves).
  sky.lighting = true;
  sky.lightingResolution = R.lightingResolution;
  sky.atlasSize = R.atlasSize;
  return sky;
}

/**
 * Limit the radiance of the sun disc in the engine's atmosphere chunk, in both shader languages. The chunk
 * is shared by the sky itself, its lighting bake and the haze. If a future engine version rewords the line
 * we hook onto, the patch is skipped with a warning and the engine's own limit applies.
 */
function clampSunDisc(device: pc.GraphicsDevice, max: number): void {
  const limit = max.toFixed(1);
  const patches: [string, string, string][] = [
    [pc.SHADERLANGUAGE_GLSL, 'dynSkySunDisc = disc * (0.04 * dynSkyLuminance);', `dynSkySunDisc = min(dynSkySunDisc, vec3(${limit}));`],
    [pc.SHADERLANGUAGE_WGSL, 'dynSkySunDisc = disc * (0.04 * uniform.dynSkyLuminance);', `dynSkySunDisc = min(dynSkySunDisc, vec3f(${limit}));`],
  ];
  for (const [language, anchor, clampLine] of patches) {
    const chunks = pc.ShaderChunks.get(device, language);
    const source = chunks.get('dynamicSkyAtmospherePS');
    if (!source || !source.includes(anchor)) {
      console.warn(`[sky] sun disc clamp not applied (${language}): the engine chunk changed`);
      continue;
    }
    if (!source.includes(clampLine)) chunks.set('dynamicSkyAtmospherePS', source.replace(anchor, `${anchor}\n\t\t${clampLine}`));
  }
}

// ── Static procedural sky (fallback) ─────────────────────────────────────────────────────────────────────

interface StaticSky {
  skybox: pc.Texture;
  atlas: pc.Texture;
}

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v);
}
/** Cloud density 0..1 for a view direction above the horizon: noise on a flat layer, stretched along X. */
function cloudDensity(dx: number, dy: number, dz: number): number {
  if (dy <= 0.015) return 0;
  const px = (dx / (dy + 0.08)) * 0.42;
  const pz = (dz / (dy + 0.08)) * 0.95;
  const n = noise2(px, pz) * 0.5 + noise2(px * 2.3 + 5, pz * 2.3 - 2) * 0.3 + noise2(px * 5.1 - 7, pz * 5.1 + 9) * 0.2;
  return smoothstep(1 - RENDER.cloudCover, 1 - RENDER.cloudCover + 0.22, n) * smoothstep(0.015, 0.12, dy);
}

function skyRadiance(dx: number, dy: number, dz: number, sun: pc.Vec3, out: number[]): void {
  const up = clamp(dy, 0, 1);
  const k = Math.pow(up, 0.42);
  const mu = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
  // Warm glow around the sun, strongest near the horizon.
  const glow = Math.pow(mu, 6) * 0.9 * (1 - up) + Math.pow(mu, 48) * 2.5;
  const disc = mu > Math.cos(RENDER.sunDiscSize * DEG) ? RENDER.sunDiscRadiance : 0;
  const below = smoothstep(0.0, -0.12, dy);
  const cloud = cloudDensity(dx, dy, dz);
  // Clouds facing the sun catch its colour; the rest sit in blue-violet shade.
  const lit = 0.25 + 0.75 * Math.pow(mu, 2);
  for (let c = 0; c < 3; c++) {
    let sky = lerp(RENDER.skyHorizon[c], RENDER.skyZenith[c], k) + glow * RENDER.sunColor[c];
    sky = lerp(sky, lerp(RENDER.cloudShade[c], RENDER.cloudLit[c] * 1.5, lit), cloud * 0.85);
    sky += disc * RENDER.sunColor[c] * (1 - cloud);
    out[c] = lerp(sky, RENDER.skyGround[c], below);
  }
}

function buildStaticSky(app: pc.AppBase, sunDir: pc.Vec3): StaticSky {
  const device = app.graphicsDevice;
  const W = 1024;
  const H = 512;
  const data = new Uint16Array(W * H * 4);
  const rgb = [0, 0, 0];
  const one = pc.FloatPacking.float2Half(1);
  for (let py = 0; py < H; py++) {
    // Engine equirect convention: u = atan2(x, z)/2π + 0.5, row 0 is straight up.
    const theta = (0.5 - (py + 0.5) / H) * Math.PI;
    for (let px = 0; px < W; px++) {
      const phi = ((px + 0.5) / W - 0.5) * 2 * Math.PI;
      skyRadiance(Math.cos(theta) * Math.sin(phi), Math.sin(theta), Math.cos(theta) * Math.cos(phi), sunDir, rgb);
      const o = (py * W + px) * 4;
      data[o] = pc.FloatPacking.float2Half(rgb[0]);
      data[o + 1] = pc.FloatPacking.float2Half(rgb[1]);
      data[o + 2] = pc.FloatPacking.float2Half(rgb[2]);
      data[o + 3] = one;
    }
  }
  const source = new pc.Texture(device, {
    name: 'sky-equirect',
    width: W,
    height: H,
    format: pc.PIXELFORMAT_RGBA16F,
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    levels: [data],
  });
  const skybox = pc.EnvLighting.generateSkyboxCubemap(source);
  const lighting = pc.EnvLighting.generateLightingSource(source);
  const atlas = pc.EnvLighting.generateAtlas(lighting);
  lighting.destroy();
  source.destroy();

  app.scene.envAtlas = atlas;
  app.scene.skybox = skybox;
  return { skybox, atlas };
}
