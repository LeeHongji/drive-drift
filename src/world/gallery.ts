// The snow gallery: a concrete roof over the gallery segment with one closed wall and one arcade of arched
// openings toward the low sun, so light rakes across the road. Neon strips in the brand colours run along
// the closed wall. Everything is swept along the centreline in track coordinates (lateral offset, height
// above the banked road plane), the same convention the road and walls use, so the structure sits exactly
// on the existing barriers: its walls start at the barriers' outer faces and rise from their tops.

import * as pc from 'playcanvas';
import { WORLD } from '../config/world';
import { LIT_LAYERS } from '../render/layers';
import { frameAt, type Track, type TrackFrame } from '../track/track';
import type { GallerySpec } from './layout';
import { MeshBuilder, addMeshEntity, scale, sub, trackPoint, type Rgb, type V3 } from './mesh-builder';

export interface GalleryStats {
  entities: number;
  triangles: number;
  lights: number;
}

export function createGallery(app: pc.AppBase, parent: pc.Entity, track: Track, spec: GallerySpec): GalleryStats {
  const G = WORLD.gallery;
  const cfg = track.config;
  const device = app.graphicsDevice;
  /** Outer face of the existing barrier: the gallery's walls start here. */
  const O = track.wallOffset + cfg.wallThickness;
  const sill = cfg.wallHeight;
  /** Walls run down to here so their feet are always buried. */
  const foot = -(cfg.deckDepth + 1.2);
  const roofTop = G.ceiling + G.roofThickness;
  const open = spec.openSide;
  const closed = -open;
  const outside = G.concrete;
  const inside = G.interior;
  const soffit: Rgb = [inside[0] * 0.8, inside[1] * 0.8, inside[2] * 0.8];

  const b = new MeshBuilder();
  const neon = new MeshBuilder();
  const at = (s: number): TrackFrame => frameAt(track, s);
  const left = (f: TrackFrame): V3 => [f.lx, 0, f.lz];
  const P = (f: TrackFrame, d: number, h: number): V3 => trackPoint(f, d, h);

  /** A strip between two profile points (lateral, height), swept from s0 to s1 in `step` metre pieces. */
  const sweep = (m: MeshBuilder, s0: number, s1: number, a: [number, number], c: [number, number], toward: (f: TrackFrame) => V3, color: Rgb, step = 2): void => {
    const n = Math.max(1, Math.round((s1 - s0) / step));
    for (let k = 0; k < n; k++) {
      const f0 = at(s0 + ((s1 - s0) * k) / n);
      const f1 = at(s0 + ((s1 - s0) * (k + 1)) / n);
      m.quad(P(f0, a[0], a[1]), P(f1, a[0], a[1]), P(f1, c[0], c[1]), P(f0, c[0], c[1]), toward(f0), color);
    }
  };
  const up = (): V3 => [0, 1, 0];
  const down = (): V3 => [0, -1, 0];
  const toSide = (side: number) => (f: TrackFrame): V3 => scale(left(f), side);

  const { s0, s1 } = spec;

  // ---- roof slab: top, the two fascias, and the underside (ceiling inside, soffit over the walls) ----
  const roofClosed = closed * (O + G.wallThickness + 0.3);
  const roofOpen = open * (O + G.arcadeThickness + 0.3);
  sweep(b, s0, s1, [roofClosed, roofTop], [roofOpen, roofTop], up, outside);
  sweep(b, s0, s1, [roofClosed, G.ceiling], [roofClosed, roofTop], toSide(closed), outside);
  sweep(b, s0, s1, [roofOpen, G.ceiling], [roofOpen, roofTop], toSide(open), outside);
  sweep(b, s0, s1, [roofClosed, G.ceiling], [roofOpen, G.ceiling], down, soffit);

  // ---- closed wall: inner face above the barrier, outer face down into the ground ----
  sweep(b, s0, s1, [closed * O, sill], [closed * O, G.ceiling], toSide(open), inside);
  sweep(b, s0, s1, [closed * (O + G.wallThickness), foot], [closed * (O + G.wallThickness), G.ceiling], toSide(closed), outside);

  // ---- arcade: piers and arched openings ----
  const dIn = open * O;
  const dOut = open * (O + G.arcadeThickness);
  // Plinth under the openings: outer face and the sill on top of it.
  sweep(b, s0, s1, [dOut, foot], [dOut, sill], toSide(open), outside);
  const half = G.pierWidth / 2;
  for (let bay = 0; bay < spec.bays; bay++) {
    const a0 = s0 + bay * spec.bayLength;
    const a1 = a0 + spec.bayLength;
    const o0 = a0 + half;
    const o1 = a1 - half;
    // Pier halves at both ends of the bay, full height on both faces, plus the jambs of the opening.
    for (const [p0, p1] of [[a0, o0], [o1, a1]]) {
      sweep(b, p0, p1, [dIn, sill], [dIn, G.ceiling], toSide(closed), inside, 1);
      sweep(b, p0, p1, [dOut, sill], [dOut, G.ceiling], toSide(open), outside, 1);
    }
    const mid = at((o0 + o1) / 2);
    const centre = P(mid, (dIn + dOut) / 2, (sill + G.spring) / 2);
    for (const sj of [o0, o1]) {
      const f = at(sj);
      const a = P(f, dIn, sill);
      b.quad(a, P(f, dOut, sill), P(f, dOut, G.spring), P(f, dIn, G.spring), sub(centre, a), outside);
    }
    // The arch: wall above the curve on both faces, and the curved underside between them.
    const n = G.archSegments;
    const archAt = (i: number): { f: TrackFrame; h: number } => {
      // Cosine spacing puts more segments where the curve is steep, near the springing.
      const q = -Math.cos((Math.PI * i) / n);
      return { f: at((o0 + o1) / 2 + (q * (o1 - o0)) / 2), h: G.spring + (G.crown - G.spring) * Math.sqrt(Math.max(0, 1 - q * q)) };
    };
    for (let i = 0; i < n; i++) {
      const p = archAt(i);
      const q = archAt(i + 1);
      b.quad(P(p.f, dIn, p.h), P(q.f, dIn, q.h), P(q.f, dIn, G.ceiling), P(p.f, dIn, G.ceiling), scale(left(p.f), closed), inside);
      b.quad(P(p.f, dOut, p.h), P(q.f, dOut, q.h), P(q.f, dOut, G.ceiling), P(p.f, dOut, G.ceiling), scale(left(p.f), open), outside);
      const a = P(p.f, dIn, p.h);
      b.quad(a, P(q.f, dIn, q.h), P(q.f, dOut, q.h), P(p.f, dOut, p.h), sub(centre, a), outside);
    }
    // Sill of the opening (the plinth's top; the barrier's own top continues it on the road side).
    sweep(b, o0, o1, [dIn, sill], [dOut, sill], up, outside, 1.5);
    // Ceiling rib on the bay line.
    if (bay > 0) {
      const f = at(a0);
      const across = scale(sub(P(f, O, 0), P(f, -O, 0)), 0.5);
      b.box(P(f, 0, G.ceiling - G.ribDepth / 2), across, [0, G.ribDepth / 2, 0], scale([f.tx, f.grade, f.tz], G.ribWidth / 2), soffit, { top: true });
    }
  }

  // ---- portals: close the cut ends of both walls and the roof ----
  for (const [s, dir] of [[s0, -1], [s1, 1]] as const) {
    const f = at(s);
    const out: V3 = [f.tx * dir, 0, f.tz * dir];
    const rect = (d0: number, d1: number, h0: number, h1: number): void => b.quad(P(f, d0, h0), P(f, d1, h0), P(f, d1, h1), P(f, d0, h1), out, outside);
    rect(closed * O, closed * (O + G.wallThickness), foot, G.ceiling);
    rect(dIn, dOut, foot, G.ceiling);
    rect(roofClosed, roofOpen, G.ceiling, roofTop);
  }

  // ---- neon strips on the closed wall, a few centimetres proud of it ----
  const neonFace = closed * (O - 0.04);
  for (const strip of G.neon) sweep(neon, s0 + 0.5, s1 - 0.5, [neonFace, strip.bottom], [neonFace, strip.top], toSide(open), strip.color);

  const concrete = new pc.StandardMaterial();
  concrete.name = 'GalleryConcrete';
  concrete.diffuseVertexColor = true;
  concrete.vertexColorGamma = true;
  concrete.gloss = 0.22;
  concrete.update();
  const neonMat = new pc.StandardMaterial();
  neonMat.name = 'GalleryNeon';
  neonMat.diffuse = new pc.Color(0, 0, 0);
  neonMat.emissive = new pc.Color(1, 1, 1);
  neonMat.emissiveVertexColor = true;
  neonMat.vertexColorGamma = true;
  neonMat.emissiveIntensity = G.neonEmissive;
  neonMat.update();

  addMeshEntity(parent, 'Gallery', b.build(device), concrete, { castShadows: true });
  addMeshEntity(parent, 'GalleryNeon', neon.build(device), neonMat);

  // ---- coloured fill lights along the closed wall, so the neon tints the road and the car ----
  for (let k = 0; k < G.lightCount; k++) {
    const f = at(s0 + ((k + 0.5) / G.lightCount) * (s1 - s0));
    const color = G.neon[k % G.neon.length].color;
    const light = new pc.Entity(`GalleryLight_${k}`);
    light.addComponent('light', {
      type: 'omni',
      color: new pc.Color(Math.pow(color[0], 1 / 2.2), Math.pow(color[1], 1 / 2.2), Math.pow(color[2], 1 / 2.2)),
      intensity: G.lightIntensity,
      range: G.lightRange,
      castShadows: false,
      layers: LIT_LAYERS,
    });
    const p = P(f, closed * (O - 1.5), G.lightHeight);
    light.setPosition(p[0], p[1], p[2]);
    parent.addChild(light);
  }

  return { entities: 2, triangles: b.triangleCount + neon.triangleCount, lights: G.lightCount };
}
