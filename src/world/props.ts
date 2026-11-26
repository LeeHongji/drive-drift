// Trackside furniture, all placed by rule from the centreline (src/world/layout.ts, placement.ts): sponsor
// banners on the walls through corners, `>>` boards on the outside of tight corners, lamp posts, marker
// posts, and the bridge parts where the road leaves the ground (deck underside, piers).
// Sponsor names are invented; no real brands.

import * as pc from 'playcanvas';
import { WORLD } from '../config/world';
import { Rng } from '../core/rng';
import { frameAt, type Track, type TrackFrame } from '../track/track';
import { bannerRanges, placeChevrons, placeLamps, placePosts, wallTopOffset } from './layout';
import { MeshBuilder, add, addMeshEntity, canvasTexture, scale, sub, trackPoint, type Rgb, type V3 } from './mesh-builder';
import type { Heightfield } from './heightfield';
import type { PierSpot } from './placement';

const UP: V3 = [0, 1, 0];
const STEEL: Rgb = [0.03, 0.032, 0.036];
const HOUSING: Rgb = [0.02, 0.021, 0.024];

/** Horizontal unit vector pointing left of the track, and the 3D tangent (with grade). */
const leftOf = (f: TrackFrame): V3 => [f.lx, 0, f.lz];
const tangentOf = (f: TrackFrame): V3 => [f.tx, f.grade, f.tz];

function vertexColorMaterial(name: string, gloss: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.name = name;
  m.diffuseVertexColor = true;
  m.vertexColorGamma = true;
  m.gloss = gloss;
  m.update();
  return m;
}

// ---- sponsor banners ----

/** All boards side by side along U; V runs from the top edge (0) to the bottom edge (1). */
function bannerTexture(device: pc.GraphicsDevice, rng: Rng): pc.Texture {
  const B = WORLD.banners;
  const n = B.sponsors.length;
  const BW = 512;
  const H = 128;
  // Text is drawn in a space where one unit is one pixel of height, squeezed along U so that letters keep
  // their proportions on a board that is boardLength × (top − bottom) metres.
  const squeeze = BW / H / (B.boardLength / (B.top - B.bottom));
  const tex = canvasTexture(device, 'sponsor-banners', BW * n, H, true, (g) => {
    B.sponsors.forEach(([name, bg, fg], k) => {
      g.setTransform(1, 0, 0, 1, k * BW, 0);
      g.fillStyle = bg;
      g.fillRect(0, 0, BW, H);
      g.fillStyle = fg;
      g.fillRect(0, 0, 8, H);
      g.fillRect(0, H - 22, BW, 9);
      g.setTransform(squeeze, 0, 0, 1, k * BW, 0);
      g.font = 'italic 900 78px "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, BW / squeeze / 2, H * 0.43, (BW / squeeze) * 0.9);
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Road grime, heavier toward the bottom edge, and scuffs.
    const grime = g.createLinearGradient(0, H * 0.45, 0, H);
    grime.addColorStop(0, 'rgba(40,34,28,0)');
    grime.addColorStop(1, 'rgba(40,34,28,0.55)');
    g.fillStyle = grime;
    g.fillRect(0, 0, BW * n, H);
    g.strokeStyle = 'rgba(15,15,15,0.4)';
    for (let i = 0; i < 70; i++) {
      const x = rng.next() * BW * n;
      const y = H * (0.3 + rng.next() * 0.7);
      g.lineWidth = 1 + rng.next() * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 20 + rng.next() * 90, y + (rng.next() - 0.5) * 8);
      g.stroke();
    }
  });
  tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  return tex;
}

function buildBanners(app: pc.AppBase, parent: pc.Entity, track: Track, rng: Rng): number {
  const B = WORLD.banners;
  const material = new pc.StandardMaterial();
  material.name = 'Banners';
  material.diffuseMap = bannerTexture(app.graphicsDevice, rng);
  material.emissiveMap = material.diffuseMap;
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveIntensity = B.emissive;
  material.gloss = 0.32;
  // The strip stands a few centimetres off the wall; the bias keeps it clean at long range as well.
  material.depthBias = -1;
  material.slopeDepthBias = -1;
  material.update();

  const face = track.wallOffset - B.standOff;
  const period = B.sponsors.length * B.boardLength;
  const white: Rgb = [1, 1, 1];
  const step = 2;
  let count = 0;
  for (const range of bannerRanges(track)) {
    const b = new MeshBuilder();
    for (const side of [1, -1]) {
      for (let s = range.s0; s < range.s1 - 1e-6; s += step) {
        const s1 = Math.min(range.s1, s + step);
        const f0 = frameAt(track, s);
        const f1 = frameAt(track, s1);
        // Read left to right as seen from the road: along +s on the left wall, against it on the right.
        const u0 = (side * s) / period;
        const u1 = (side * s1) / period;
        b.quad(
          trackPoint(f0, side * face, B.bottom),
          trackPoint(f1, side * face, B.bottom),
          trackPoint(f1, side * face, B.top),
          trackPoint(f0, side * face, B.top),
          scale(leftOf(f0), -side),
          white,
          [[u0, 1], [u1, 1], [u1, 0], [u0, 0]],
        );
      }
    }
    addMeshEntity(parent, `Banners_${Math.round(range.s0)}`, b.build(app.graphicsDevice, { colors: false, uvs: true }), material);
    count++;
  }
  return count;
}

// ---- chevron boards ----

function chevronTexture(device: pc.GraphicsDevice): pc.Texture {
  const C = WORLD.chevrons;
  const W = 256;
  const H = 128;
  // The arrows point toward +U, which the board maps to the driving direction.
  return canvasTexture(
    device,
    'chevrons',
    W,
    H,
    true,
    (g) => {
      g.fillStyle = C.background;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = C.arrow;
      g.lineWidth = 26;
      g.lineJoin = 'miter';
      for (const x of [46, 142]) {
        g.beginPath();
        g.moveTo(x, 18);
        g.lineTo(x + 50, H / 2);
        g.lineTo(x, H - 18);
        g.stroke();
      }
    },
    false,
  );
}

// ---- everything ----

export interface PropStats {
  /** Render entities created (one draw call each when visible). */
  entities: number;
  chevrons: number;
  lamps: number;
  posts: number;
  piers: number;
  bannerRuns: number;
  triangles: number;
}

export function createProps(app: pc.AppBase, parent: pc.Entity, track: Track, hf: Heightfield, piers: PierSpot[]): PropStats {
  const device = app.graphicsDevice;
  const cfg = track.config;
  const rng = new Rng((cfg.seed | 0) ^ 0x9209);
  const K = track.wallOffset;
  const O = K + cfg.wallThickness;
  const wallTop = cfg.wallHeight;
  const onWall = wallTopOffset(track);
  const stats: PropStats = { entities: 0, chevrons: 0, lamps: 0, posts: 0, piers: piers.length, bannerRuns: 0, triangles: 0 };

  stats.bannerRuns = buildBanners(app, parent, track, rng.fork());
  stats.entities += stats.bannerRuns;

  /** Unlit-looking dark parts: poles, housings, the backs of boards, marker posts. */
  const furniture = new MeshBuilder();
  /** `>>` faces (emissive texture). */
  const boards = new MeshBuilder();
  /** Lamp lenses (emissive colour). */
  const glow = new MeshBuilder();
  /** Concrete that casts shadows: piers and the underside of the road deck. */
  const structures = new MeshBuilder();

  // ---- chevron boards on the outside wall of tight corners ----
  const C = WORLD.chevrons;
  const chevrons = placeChevrons(track);
  stats.chevrons = chevrons.length;
  for (const { s, side } of chevrons) {
    const f = frameAt(track, s);
    const inward = scale(leftOf(f), -side);
    const y0 = wallTop + C.lift;
    const y1 = y0 + C.height;
    const half = C.width / 2;
    const front = side * (onWall - 0.07);
    const back = side * (onWall + 0.07);
    boards.quad(
      trackPoint(f, front, y0, -half),
      trackPoint(f, front, y0, half),
      trackPoint(f, front, y1, half),
      trackPoint(f, front, y1, -half),
      inward,
      [1, 1, 1],
      [[0, 1], [1, 1], [1, 0], [0, 0]],
    );
    furniture.quad(
      trackPoint(f, back, y0, -half),
      trackPoint(f, back, y0, half),
      trackPoint(f, back, y1, half),
      trackPoint(f, back, y1, -half),
      scale(inward, -1),
      STEEL,
    );
    for (const ds of [-half * 0.6, half * 0.6]) {
      const c = trackPoint(f, side * onWall, (wallTop + y0) / 2 - 0.05, ds);
      furniture.box(c, scale(leftOf(f), 0.05), scale(UP, (y0 - wallTop) / 2 + 0.05), scale(tangentOf(f), 0.05), STEEL, { bottom: true });
    }
  }

  // ---- lamp posts: a tapered pole on the wall top that bends over the road ----
  const L = WORLD.lamps;
  const lamps = placeLamps(track);
  stats.lamps = lamps.length;
  for (const { s, side } of lamps) {
    const f = frameAt(track, s);
    const inward = scale(leftOf(f), -side);
    const along: V3 = [f.tx, 0, f.tz];
    const base = trackPoint(f, side * onWall, wallTop - 0.05);
    const bend = 1.3;
    const path: V3[] = [base, add(base, scale(UP, L.height * 0.45)), add(base, scale(UP, L.height - bend))];
    const centre = add(add(base, scale(UP, L.height - bend)), scale(inward, bend));
    for (const deg of [18, 36, 54, 72, 90]) {
      const a = (deg * Math.PI) / 180;
      path.push(add(centre, add(scale(inward, -Math.cos(a) * bend), scale(UP, Math.sin(a) * bend))));
    }
    const tip = add(add(base, scale(UP, L.height)), scale(inward, L.reach));
    path.push(tip);
    const radii = path.map((_, i) => L.radius * (1 - 0.55 * (i / (path.length - 1))));
    furniture.tube(path, radii, 6, along, STEEL);
    furniture.tube([base, add(base, scale(UP, 0.4))], [L.radius * 1.5, L.radius * 1.35], 6, along, STEEL, true);
    const head = add(tip, scale(inward, 0.4));
    furniture.box(head, scale(inward, 0.52), scale(UP, 0.05), scale(along, 0.18), HOUSING);
    const lens = add(head, [0, -0.062, 0]);
    glow.quad(
      sub(sub(lens, scale(inward, 0.42)), scale(along, 0.12)),
      sub(add(lens, scale(inward, 0.42)), scale(along, 0.12)),
      add(add(lens, scale(inward, 0.42)), scale(along, 0.12)),
      add(sub(lens, scale(inward, 0.42)), scale(along, 0.12)),
      [0, -1, 0],
      L.glow,
    );
  }

  // ---- marker posts: white with a red cap, on both wall tops ----
  const P = WORLD.posts;
  const posts = placePosts(track, chevrons, lamps);
  stats.posts = posts.length;
  const white: Rgb = [0.72, 0.72, 0.7];
  const red: Rgb = [0.5, 0.03, 0.02];
  for (const { s, side } of posts) {
    const f = frameAt(track, s);
    const w = P.width / 2;
    const cap = P.height * 0.24;
    const body = P.height - cap;
    furniture.box(trackPoint(f, side * onWall, wallTop + body / 2 - 0.02), scale(leftOf(f), w), scale(UP, body / 2 + 0.02), scale([f.tx, 0, f.tz], w), white, { top: true, bottom: true });
    furniture.box(trackPoint(f, side * onWall, wallTop + body + cap / 2), scale(leftOf(f), w), scale(UP, cap / 2), scale([f.tx, 0, f.tz], w), red, { bottom: true });
  }

  // ---- road deck underside, visible wherever the ground falls away ----
  const concrete = WORLD.gallery.concrete;
  const shade: Rgb = [concrete[0] * 0.55, concrete[1] * 0.55, concrete[2] * 0.55];
  const deck = -cfg.deckDepth;
  const step = track.spacing * 2;
  const stations = Math.round(track.length / step);
  for (let k = 0; k < stations; k++) {
    const f0 = frameAt(track, k * step);
    const f1 = frameAt(track, (k + 1) * step);
    structures.quad(trackPoint(f0, -O, deck), trackPoint(f0, O, deck), trackPoint(f1, O, deck), trackPoint(f1, -O, deck), [0, -1, 0], shade);
  }

  // ---- abutments: where the ground drops below the deck but not far, wall the gap in on both sides so
  // the slab never appears to float; the open span between the abutments is left to the piers ----
  const cut = (f: TrackFrame, d: number): number => trackPoint(f, d, 0)[1] - hf.heightAt(f.x + f.lx * d, f.z + f.lz * d);
  const R = WORLD.piers;
  let wasOpen = cut(frameAt(track, -step), 0) > R.abutmentMax;
  for (let k = 0; k < stations; k++) {
    const f0 = frameAt(track, k * step);
    const f1 = frameAt(track, (k + 1) * step);
    const open = cut(frameAt(track, (k + 0.5) * step), 0) > R.abutmentMax;
    if (open !== wasOpen) {
      // End wall of the abutment, facing the span.
      const depth = Math.max(cut(f0, -O), cut(f0, 0), cut(f0, O)) + 1;
      const toSpan: V3 = open ? [f0.tx, 0, f0.tz] : [-f0.tx, 0, -f0.tz];
      structures.quad(trackPoint(f0, -O, deck), trackPoint(f0, O, deck), trackPoint(f0, O, -depth), trackPoint(f0, -O, -depth), toSpan, concrete);
    }
    wasOpen = open;
    if (open) continue;
    for (const side of [1, -1]) {
      const g0 = cut(f0, side * (O + 0.4));
      const g1 = cut(f1, side * (O + 0.4));
      if (Math.max(g0, g1) < cfg.deckDepth - 0.05) continue;
      structures.quad(
        trackPoint(f0, side * O, deck),
        trackPoint(f1, side * O, deck),
        trackPoint(f1, side * O, -(g1 + 1)),
        trackPoint(f0, side * O, -(g0 + 1)),
        scale(leftOf(f0), side),
        concrete,
      );
    }
  }

  // ---- piers under the viaducts ----
  for (const pier of piers) {
    const f = frameAt(track, pier.s);
    const t = tangentOf(f);
    const capTop = deck;
    const across = sub(trackPoint(f, R.capWidth / 2, 0), trackPoint(f, 0, 0));
    structures.box(trackPoint(f, 0, capTop - R.capDepth / 2), across, scale(UP, R.capDepth / 2), scale(t, R.capLength / 2), concrete, { top: true });
    for (const d of [-R.columnOffset, R.columnOffset]) {
      const top = trackPoint(f, d, capTop - R.capDepth);
      const bottom = f.y - pier.foot;
      if (top[1] <= bottom) continue;
      const mid: V3 = [top[0], (top[1] + bottom) / 2, top[2]];
      structures.box(mid, scale(leftOf(f), R.columnSize / 2), scale(UP, (top[1] - bottom) / 2), scale([f.tx, 0, f.tz], R.columnSize / 2), concrete, { top: true, bottom: true });
    }
  }

  // ---- materials and entities ----
  const dark = vertexColorMaterial('TrackFurniture', 0.45);
  const concreteMat = vertexColorMaterial('Concrete', 0.2);
  const boardMat = new pc.StandardMaterial();
  boardMat.name = 'Chevrons';
  boardMat.diffuse = new pc.Color(0.02, 0.02, 0.02);
  boardMat.emissiveMap = chevronTexture(device);
  boardMat.emissive = new pc.Color(1, 1, 1);
  boardMat.emissiveIntensity = C.emissive;
  boardMat.gloss = 0.5;
  boardMat.update();
  const glowMat = new pc.StandardMaterial();
  glowMat.name = 'LampGlow';
  glowMat.diffuse = new pc.Color(0, 0, 0);
  glowMat.emissive = new pc.Color(L.glow[0], L.glow[1], L.glow[2]);
  glowMat.emissiveIntensity = L.emissive;
  glowMat.update();

  const emit = (name: string, b: MeshBuilder, material: pc.Material, opts: { colors?: boolean; uvs?: boolean; castShadows?: boolean }): void => {
    if (b.triangleCount === 0) return;
    addMeshEntity(parent, name, b.build(device, opts), material, { castShadows: opts.castShadows ?? false });
    stats.entities++;
    stats.triangles += b.triangleCount;
  };
  emit('Furniture', furniture, dark, {});
  emit('ChevronBoards', boards, boardMat, { colors: false, uvs: true });
  emit('LampGlow', glow, glowMat, { colors: false });
  emit('Structures', structures, concreteMat, { castShadows: true });
  return stats;
}
