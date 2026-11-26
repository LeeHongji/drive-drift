// Nitro exhaust flames: one jet per tailpipe marker plus a blue glow on the road behind the car.
// No custom shader: each jet is two nested shells of revolution (blue sheath, white-hot core) drawn additively
// with a StandardMaterial. The gradient along the jet is baked into vertex colours, the turbulence is a
// brightness texture scrolling toward the tip, and a camera-facing glow sprite covers the pipe mouth (the
// chase camera looks almost straight down the jet).

import * as pc from 'playcanvas';
import { FLAMES } from '../config/vfx';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import { ROAD_ONLY_LAYERS } from '../render/layers';
import { engineColor, flameNoiseTexture, glowTexture } from './textures';

type Rgb = readonly [number, number, number];

/** Jet outline: radius (0…1) at fraction `t` of the length. Leaves the pipe narrow, swells, tapers to a point. */
function outline(t: number): number {
  return (0.8 + 0.9 * Math.sqrt(t)) * Math.pow(1 - t, 0.8);
}

interface Shell {
  /** Fractions of the full jet radius and length this shell spans. */
  radius: number;
  length: number;
  /** Linear colour at fraction `t` of the shell's own length. */
  color: (t: number) => Rgb;
}

/**
 * Shells of revolution around +Z in a unit frame: z runs 0…1 along the jet, the widest point has radius 1.
 * The owning entity's scale (radius, radius, length) sizes the jet.
 */
function jetMesh(device: pc.GraphicsDevice, shells: Shell[]): pc.Mesh {
  const around = FLAMES.segmentsAround;
  const along = FLAMES.segmentsAlong;
  let widest = 0;
  for (let j = 0; j <= 64; j++) widest = Math.max(widest, outline(j / 64));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const shell of shells) {
    const base = positions.length / 3;
    for (let j = 0; j <= along; j++) {
      const t = j / along;
      const r = (outline(t) / widest) * shell.radius;
      const [cr, cg, cb] = shell.color(t);
      for (let i = 0; i <= around; i++) {
        const a = (i / around) * 2 * Math.PI;
        positions.push(Math.cos(a) * r, Math.sin(a) * r, t * shell.length);
        normals.push(Math.cos(a), Math.sin(a), 0);
        // The pattern wraps twice around the jet; V follows the full jet length on every shell.
        uvs.push((i / around) * 2, t * shell.length);
        colors.push(Math.round(clamp(cr, 0, 1) * 255), Math.round(clamp(cg, 0, 1) * 255), Math.round(clamp(cb, 0, 1) * 255), 255);
      }
    }
    const ring = around + 1;
    for (let j = 0; j < along; j++) {
      for (let i = 0; i < around; i++) {
        const a = base + j * ring + i;
        indices.push(a, a + 1, a + ring, a + 1, a + ring + 1, a + ring);
      }
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setColors32(colors);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Unit quad in the XY plane facing +Z (so copying the camera's rotation onto it makes it face the camera). */
function quadMesh(device: pc.GraphicsDevice): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Additive, unlit, emissive only. Starts dark; `update` drives the intensity. */
function glowMaterial(name: string, map: pc.Texture): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.name = name;
  m.diffuse = new pc.Color(0, 0, 0);
  m.specular = new pc.Color(0, 0, 0);
  m.useLighting = false;
  m.useSkybox = false;
  m.useFog = false;
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveMap = map;
  m.emissiveIntensity = 0;
  m.blendType = pc.BLEND_ADDITIVE;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  return m;
}

interface Jet {
  flame: pc.Entity;
  glow: pc.Entity;
  light: pc.Entity;
}

export class NitroFlames {
  /** Smoothed boost level the flames are showing, 0…1. */
  level = 0;
  private readonly jets: Jet[] = [];
  private readonly body: pc.StandardMaterial;
  private readonly tip: pc.StandardMaterial;
  private readonly glow: pc.StandardMaterial;
  private readonly scroll = new pc.Vec2();
  private readonly tipColor = new pc.Color();
  private readonly midColor = engineColor(FLAMES.colorMid);
  private readonly surgeColor = engineColor(FLAMES.colorSurge);

  /** `exhausts` are the tailpipe markers on the car body: origin at the outlet, +Z along the jet. */
  constructor(app: pc.AppBase, exhausts: pc.Entity[]) {
    const device = app.graphicsDevice;
    if (exhausts.length === 0) console.warn('nitro flames: the car model has no Exhaust_L/R markers (rebuild with npm run car:build)');

    // How strongly the surge colour replaces the sheath at fraction t, and how the sheath fades along the jet.
    const toTip = (t: number): number => smoothstep(FLAMES.surgeFrom, FLAMES.surgeTo, t);
    const fade = (t: number): number => smoothstep(0, 0.04, t) * Math.pow(1 - t, 0.4);
    const sheath = (t: number): Rgb => {
      const k = smoothstep(0.1, 0.7, t);
      return [lerp(FLAMES.colorRoot[0], FLAMES.colorMid[0], k), lerp(FLAMES.colorRoot[1], FLAMES.colorMid[1], k), lerp(FLAMES.colorRoot[2], FLAMES.colorMid[2], k)];
    };
    // Body mesh: the near part of the sheath plus the core. Its material runs coreGain times brighter than the
    // tip's so the core can exceed the 0…1 range of vertex colours; the sheath colours are divided to match.
    const bodyMesh = jetMesh(device, [
      {
        radius: 1,
        length: 1,
        color: (t) => {
          const w = (fade(t) * (1 - toTip(t))) / FLAMES.coreGain;
          const c = sheath(t);
          return [c[0] * w, c[1] * w, c[2] * w];
        },
      },
      {
        radius: FLAMES.coreRadius,
        length: FLAMES.coreLength,
        color: (t) => {
          const w = smoothstep(0, 0.04, t) * Math.pow(1 - t, 2.2);
          return [FLAMES.colorCore[0] * w, FLAMES.colorCore[1] * w, FLAMES.colorCore[2] * w];
        },
      },
    ]);
    // Tip mesh: the far part of the sheath as a grey weight; its material colour goes from blue to the surge colour.
    const tipMesh = jetMesh(device, [
      {
        radius: 1,
        length: 1,
        color: (t) => {
          const w = fade(t) * toTip(t);
          return [w, w, w];
        },
      },
    ]);
    const quad = quadMesh(device);

    const noise = flameNoiseTexture(device, FLAMES.noiseDepth);
    this.body = glowMaterial('FlameBody', noise);
    this.tip = glowMaterial('FlameTip', noise);
    for (const m of [this.body, this.tip]) {
      m.emissiveVertexColor = true;
      // Never the identity transform, so animating the offset does not switch shader variants.
      m.emissiveMapTiling = new pc.Vec2(1, FLAMES.noiseTiles);
      m.update();
    }
    this.tip.emissive = this.midColor;
    this.tip.update();
    this.glow = glowMaterial('FlameGlow', glowTexture(device, FLAMES.glowColor));
    this.glow.update();

    for (const marker of exhausts) {
      const flame = new pc.Entity('Flame');
      flame.addComponent('render', {
        meshInstances: [new pc.MeshInstance(bodyMesh, this.body), new pc.MeshInstance(tipMesh, this.tip)],
        castShadows: false,
        receiveShadows: false,
      });
      const glow = new pc.Entity('FlameGlow');
      glow.addComponent('render', { meshInstances: [new pc.MeshInstance(quad, this.glow)], castShadows: false, receiveShadows: false });
      // Just outside the pipe so the sprite is not cut by the bumper.
      glow.setLocalPosition(0, 0, 0.04);

      const light = new pc.Entity('NitroLight');
      light.addComponent('light', {
        type: 'omni',
        color: engineColor(FLAMES.lightColor),
        intensity: 0,
        range: FLAMES.lightRange,
        falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
        castShadows: false,
        layers: ROAD_ONLY_LAYERS,
      });
      const side = Math.sign(marker.getLocalPosition().x) || 1;
      light.setLocalPosition(side * FLAMES.lightOutward, FLAMES.lightUp, FLAMES.lightBehind);

      for (const e of [flame, glow, light]) {
        e.enabled = false;
        marker.addChild(e);
      }
      this.jets.push({ flame, glow, light });
    }
  }

  /** `boost` and `surge` are 0…1; `time` is the render clock in seconds; `camera` is the main camera entity. */
  update(boost: number, surge: number, time: number, dt: number, camera: pc.Entity): void {
    this.level += (clamp(boost, 0, 1) - this.level) * damp(FLAMES.rate, dt);
    const level = this.level;
    const on = level > FLAMES.minLevel;
    for (const jet of this.jets) {
      if (jet.flame.enabled !== on) jet.flame.enabled = jet.glow.enabled = jet.light.enabled = on;
    }
    if (!on) return;

    const flicker = 1 + FLAMES.brightFlicker * Math.sin(71 * time);
    this.body.emissiveIntensity = FLAMES.intensity * FLAMES.coreGain * level * flicker;
    this.tip.emissiveIntensity = FLAMES.intensity * level * flicker;
    this.glow.emissiveIntensity = FLAMES.glowIntensity * level * flicker;
    // The engine samples at v·tiling + 1 − tiling − offset, so a growing offset moves the pattern toward the tip.
    this.scroll.set(0, (time * FLAMES.scroll * FLAMES.noiseTiles) % 1);
    this.body.emissiveMapOffset = this.scroll;
    this.tip.emissiveMapOffset = this.scroll;
    this.tip.emissive = this.tipColor.lerp(this.midColor, this.surgeColor, clamp(surge, 0, 1));
    this.body.update();
    this.tip.update();
    this.glow.update();

    const radius = lerp(FLAMES.radiusMin, FLAMES.radiusMax, level);
    const glowSize = lerp(FLAMES.glowSizeMin, FLAMES.glowSizeMax, level);
    const facing = camera.getRotation();
    this.jets.forEach((jet, i) => {
      const wobble = 1 + FLAMES.lengthFlicker * Math.sin(37 * time + 1.7 * i) * Math.sin(23 * time + i);
      jet.flame.setLocalScale(radius, radius, lerp(FLAMES.lengthMin, FLAMES.lengthMax, level) * wobble);
      jet.glow.setLocalScale(glowSize, glowSize, glowSize);
      jet.glow.setRotation(facing);
      jet.light.light!.intensity = FLAMES.lightIntensity * level * (1 + FLAMES.lightFlicker * Math.sin(40 * time + 2 * i));
    });
  }
}
