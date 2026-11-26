#!/usr/bin/env node
// Turns the raw Sketchfab model A into the runtime car: public/assets/models/huracan-sto.glb (+ attribution .txt).
// What it does (docs/design/car-model-spec.md §4, assets-src/car/README.md):
//   - scales the model so the wheelbase matches the real car, origin on the ground under the wheelbase centre
//   - rebuilds the hierarchy as Car → Body / Wheel_FL|FR|RL|RR → Spin, wheel pivots at the tyre centres
//   - renames materials to the fixed names the game looks up, and splits tail/head lights into their own
//   - merges static meshes that share a material
//   - adds empty marker nodes Exhaust_L / Exhaust_R at the two tailpipe outlets (their +Z is the jet direction)
// Usage: node scripts/build-car.mjs        then check with: node scripts/inspect-model.mjs <out> --tree
import { writeFileSync } from 'node:fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, join, prune } from '@gltf-transform/functions';

const SRC = 'assets-src/car/A-adrianaflak09-sto-2023/gltf/scene.gltf';
const OUT = 'public/assets/models/huracan-sto.glb';
const REAL_WHEELBASE = 2.62; // metres, Huracán STO

const MATERIAL_NAMES = {
  'car_chassis.etc': 'Chassis',
  '2021_lamborghini_huracan_sto_ext_blu_laufey.etc': 'Paint',
  '2021_lamborghini_huracan_sto_lights.etc': 'Lights',
  '2021_lamborghini_huracan_sto_misc.etc': 'Trim',
  '2021_lamborghini_huracan_sto_cab_blu_laufey.etc': 'Cabin',
  Gloss_Black: 'GlossBlack',
  'car_windows_02.etc': 'Glass',
  '2021_lamborghini_huracan_sto_badges.etc': 'Badge',
  'car_tyre_tread_pirelli_02.etc': 'Tyre',
  '2021_lamborghini_huracan_sto_wheel.etc': 'Rim',
  Chrome: 'Chrome',
};
// Source wheel group node → runtime wheel name.
const WHEELS = { Wheel_50: 'Wheel_FL', 'Wheel (1)_53': 'Wheel_FR', 'Rear Wheels_56': 'Wheel_RL', 'Rear Wheels (1)_59': 'Wheel_RR' };
// Source node holding both tailpipes (one mesh, mirrored about X = 0).
const EXHAUST = /^LOD_A_EXHAUST_/;
// Parent-node name patterns whose `Lights` meshes get their own material, so the game can light them separately.
const LIGHT_SPLITS = [
  [/TAILLIGHT_LENS_.*_mm_lights|REARBUMPER_mm_lights/, 'Light_Tail'],
  [/HEADLIGHT_LENS_.*_mm_lights/, 'Light_Head'],
];

// ---- column-major 4×4 helpers ----
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const scaleTranslate = (s, tx, ty, tz) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, tx, ty, tz, 1];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const oldNodes = root.listNodes();

// ---- measure the source ----
const wheelGroups = Object.fromEntries(oldNodes.filter((n) => WHEELS[n.getName()]).map((n) => [WHEELS[n.getName()], n]));
if (Object.keys(wheelGroups).length !== 4) throw new Error('expected 4 wheel groups in the source model');
const tyreCentre = {};
const tyreRadius = {};
for (const [name, group] of Object.entries(wheelGroups)) {
  // The tyre is the mesh with the Tyre material; its bounds give the true wheel centre and radius.
  let tyreNode;
  group.traverse((n) => {
    const mat = n.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName();
    if (mat === 'car_tyre_tread_pirelli_02.etc') tyreNode = n;
  });
  const { min, max } = getBounds(tyreNode);
  tyreCentre[name] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  tyreRadius[name] = (max[1] - min[1]) / 2;
}
const frontZ = (tyreCentre.Wheel_FL[2] + tyreCentre.Wheel_FR[2]) / 2;
const rearZ = (tyreCentre.Wheel_RL[2] + tyreCentre.Wheel_RR[2]) / 2;
const k = REAL_WHEELBASE / (rearZ - frontZ);
const midZ = (frontZ + rearZ) / 2;
const midX = (tyreCentre.Wheel_FL[0] + tyreCentre.Wheel_FR[0] + tyreCentre.Wheel_RL[0] + tyreCentre.Wheel_RR[0]) / 4;
// Ground = lowest tyre point.
const groundY = Math.min(...Object.keys(tyreCentre).map((n) => tyreCentre[n][1] - tyreRadius[n]));
const S = scaleTranslate(k, -midX * k, -groundY * k, -midZ * k);
const toCar = (p) => [p[0] * k + S[12], p[1] * k + S[13], p[2] * k + S[14]];

// Tailpipe outlets: split the exhaust mesh's vertices by side; each pipe's X/Y bounds centre is its axis and
// its rearmost Z is the outlet plane.
const exhaustNode = oldNodes.find((n) => EXHAUST.test(n.getName()));
if (!exhaustNode) throw new Error('exhaust node not found in the source model');
const pipes = { Exhaust_L: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, Exhaust_R: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } };
exhaustNode.traverse((n) => {
  const m = n.getWorldMatrix();
  for (const prim of n.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const w = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
      // The car's right side is +X (assets-src/car/README.md).
      const pipe = pipes[w[0] < midX ? 'Exhaust_L' : 'Exhaust_R'];
      for (let a = 0; a < 3; a++) {
        pipe.min[a] = Math.min(pipe.min[a], w[a]);
        pipe.max[a] = Math.max(pipe.max[a], w[a]);
      }
    }
  }
});
const exhausts = Object.fromEntries(
  Object.entries(pipes).map(([name, { min, max }]) => {
    if (!Number.isFinite(min[0])) throw new Error(`${name}: no tailpipe geometry on that side`);
    return [name, { outlet: toCar([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]]), radius: ((max[0] - min[0] + max[1] - min[1]) / 4) * k }];
  }),
);

// ---- materials ----
for (const m of root.listMaterials()) {
  const name = MATERIAL_NAMES[m.getName()];
  if (!name) throw new Error(`unknown material "${m.getName()}": add it to MATERIAL_NAMES`);
  m.setName(name);
  // The game overrides glass and paint itself; drop transmission so no importer tries to honour it.
  for (const ext of m.listExtensions()) ext.dispose();
}
const lights = root.listMaterials().find((m) => m.getName() === 'Lights');
const splitMaterials = Object.fromEntries(LIGHT_SPLITS.map(([, name]) => [name, lights.clone().setName(name)]));

// ---- new hierarchy ----
const car = doc.createNode('Car');
const body = doc.createNode('Body');
car.addChild(body);
const wheelSpin = {};
for (const name of Object.keys(wheelGroups)) {
  const c = toCar(tyreCentre[name]);
  const steer = doc.createNode(name).setTranslation(c);
  const spin = doc.createNode('Spin');
  steer.addChild(spin);
  car.addChild(steer);
  wheelSpin[name] = { spin, centre: c };
}
const wheelOf = (node) => {
  for (let p = node; p; p = p.getParentNode()) if (WHEELS[p.getName()]) return WHEELS[p.getName()];
  return null;
};

let meshCount = 0;
for (const node of oldNodes) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const parentName = node.getParentNode()?.getName() ?? '';
  let outMesh = mesh;
  const split = LIGHT_SPLITS.find(([re]) => re.test(parentName));
  if (split) {
    outMesh = doc.createMesh(split[1]);
    for (const prim of mesh.listPrimitives()) outMesh.addPrimitive(prim.clone().setMaterial(splitMaterials[split[1]]));
  }
  const world = mul(S, node.getWorldMatrix());
  const wheel = wheelOf(node);
  const out = doc.createNode(parentName.replace(/^LOD_A_/, '').replace(/_\d+$/, '') || node.getName()).setMesh(outMesh);
  if (wheel) {
    const c = wheelSpin[wheel].centre;
    out.setMatrix(mul(scaleTranslate(1, -c[0], -c[1], -c[2]), world));
    wheelSpin[wheel].spin.addChild(out);
  } else {
    out.setMatrix(world);
    body.addChild(out);
  }
  meshCount++;
}
for (const n of oldNodes) n.dispose();
scene.addChild(car);

for (const ext of root.listExtensionsUsed()) ext.dispose();
// Materials are left out of dedup on purpose: Light_Tail and Light_Head start as copies of Lights.
await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), join({ keepNamed: false }), prune());

// Give the merged body meshes readable names: one node per material.
for (const n of body.listChildren()) {
  const mat = n.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName();
  if (mat) n.setName(`Body_${mat}`);
}
for (const { spin } of Object.values(wheelSpin)) {
  for (const n of spin.listChildren()) n.setName(n.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? n.getName());
}

// Added after the transforms above: `prune` drops empty leaf nodes. No rotation: the car's back is +Z already.
for (const [name, { outlet }] of Object.entries(exhausts)) car.addChild(doc.createNode(name).setTranslation(outlet));

await io.write(OUT, doc);
writeFileSync(
  OUT.replace(/\.glb$/, '.txt'),
  `huracan-sto.glb

This work is based on "2023 Lamborghini Huracán STO"
(https://sketchfab.com/3d-models/2023-lamborghini-huracan-sto-19c4d3f7679e4765ac1f9c3be12c0899)
by adrianaflak09 (https://sketchfab.com/adrianaflak09)
licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Changes: uniformly scaled ×${k.toFixed(4)} to the real wheelbase, origin moved to the ground under the wheelbase
centre, hierarchy rebuilt (Car → Body, Wheel_FL/FR/RL/RR → Spin), materials renamed, tail and head light meshes
given their own materials, static meshes merged per material, empty marker nodes Exhaust_L / Exhaust_R added at
the tailpipe outlets. Built by scripts/build-car.mjs.
`,
);

const r = (v) => v.map((x) => x.toFixed(3)).join(', ');
console.log(`source meshes ${meshCount}   scale ×${k.toFixed(4)}   wrote ${OUT}`);
for (const name of Object.keys(wheelSpin)) {
  console.log(`${name}  centre (${r(wheelSpin[name].centre)})  radius ${(tyreRadius[name] * k).toFixed(3)} m`);
}
for (const [name, { outlet, radius }] of Object.entries(exhausts)) console.log(`${name}  outlet (${r(outlet)})  pipe radius ${radius.toFixed(3)} m`);
console.log(`track width front ${(Math.abs(tyreCentre.Wheel_FR[0] - tyreCentre.Wheel_FL[0]) * k).toFixed(3)} m, rear ${(Math.abs(tyreCentre.Wheel_RR[0] - tyreCentre.Wheel_RL[0]) * k).toFixed(3)} m`);
