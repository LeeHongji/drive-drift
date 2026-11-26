#!/usr/bin/env node
// Inspect a glTF 2.0 model (.gltf + external .bin/textures, or .glb) and print what the
// car import checklist in docs/design/car-model-spec.md needs: node tree, triangle counts,
// world-space bounds, materials, texture resolutions and wheel candidates.
// Zero dependencies. Usage: node scripts/inspect-model.mjs <path/to/scene.gltf|model.glb> [--tree] [--all]
//   --tree  also print the node hierarchy      --all  list every mesh node, not just the 25 largest

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const file = process.argv[2];
const showTree = process.argv.includes('--tree');
if (!file) {
    console.error('usage: node scripts/inspect-model.mjs <scene.gltf|model.glb> [--tree]');
    process.exit(1);
}

// ---------- load ----------
let gltf;
let glbBin = null;
const raw = readFileSync(file);
if (raw.readUInt32LE(0) === 0x46546c67) { // 'glTF'
    let off = 12;
    while (off < raw.length) {
        const len = raw.readUInt32LE(off);
        const type = raw.readUInt32LE(off + 4);
        const chunk = raw.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'));
        else if (type === 0x004e4942) glbBin = chunk;
        off += 8 + len;
    }
} else {
    gltf = JSON.parse(raw.toString('utf8'));
}
const baseDir = dirname(file);

// ---------- math ----------
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { // column-major 4x4
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
};
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
    const [x, y, z, w] = q;
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [
        (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
        (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
        (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1
    ];
};
const xform = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
];
const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const grow = (b, p) => { for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], p[i]); b.max[i] = Math.max(b.max[i], p[i]); } };
const merge = (a, b) => { grow(a, b.min); grow(a, b.max); };
const valid = b => b.min[0] <= b.max[0];
const size = b => b.max.map((v, i) => v - b.min[i]);
const center = b => b.max.map((v, i) => (v + b.min[i]) / 2);
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const v3 = (v, d = 2) => `(${v.map(x => f(x, d)).join(', ')})`;

// ---------- meshes ----------
const acc = gltf.accessors || [];
const meshInfo = (gltf.meshes || []).map((m) => {
    let tris = 0, verts = 0;
    const local = emptyBox();
    const mats = new Set();
    for (const p of m.primitives) {
        const mode = p.mode ?? 4;
        const pos = acc[p.attributes.POSITION];
        verts += pos?.count ?? 0;
        if (pos?.min && pos?.max) { grow(local, pos.min); grow(local, pos.max); }
        const n = p.indices !== undefined ? acc[p.indices].count : pos?.count ?? 0;
        if (mode === 4) tris += n / 3; else if (mode === 5 || mode === 6) tris += Math.max(0, n - 2);
        if (p.material !== undefined) mats.add(p.material);
    }
    return { name: m.name, tris, verts, local, mats: [...mats], prims: m.primitives.length };
});

// ---------- scene walk ----------
const nodes = gltf.nodes || [];
const sceneIdx = gltf.scene ?? 0;
const roots = gltf.scenes?.[sceneIdx]?.nodes ?? [];
const meshNodes = [];
const treeLines = [];
const walk = (ni, parent, depth) => {
    const n = nodes[ni];
    const local = n.matrix ? n.matrix : trs(n.translation, n.rotation, n.scale);
    const world = mul(parent, local);
    let label = `${'  '.repeat(depth)}${n.name ?? `node${ni}`}`;
    if (n.mesh !== undefined) {
        const mi = meshInfo[n.mesh];
        const wb = emptyBox();
        if (valid(mi.local)) {
            for (let c = 0; c < 8; c++) {
                grow(wb, xform(world, [c & 1 ? mi.local.max[0] : mi.local.min[0], c & 2 ? mi.local.max[1] : mi.local.min[1], c & 4 ? mi.local.max[2] : mi.local.min[2]]));
            }
        }
        meshNodes.push({ ni, name: n.name ?? `node${ni}`, mesh: mi, world: wb });
        label += `  [mesh ${n.mesh} "${mi.name ?? ''}" tris=${mi.tris} mats=${mi.mats.map(m => gltf.materials?.[m]?.name).join('|')}]`;
    }
    if (n.camera !== undefined) label += '  [camera]';
    if (n.extensions?.KHR_lights_punctual) label += '  [light]';
    treeLines.push(label);
    for (const c of n.children ?? []) walk(c, world, depth + 1);
};
for (const r of roots) walk(r, ident(), 0);

const total = emptyBox();
for (const m of meshNodes) if (valid(m.world)) merge(total, m.world);
const totTris = meshNodes.reduce((s, m) => s + m.mesh.tris, 0);
const totVerts = meshNodes.reduce((s, m) => s + m.mesh.verts, 0);

// ---------- images ----------
const imageSize = (buf) => {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let o = 2;
        while (o < buf.length) {
            if (buf[o] !== 0xff) { o++; continue; }
            const marker = buf[o + 1];
            const len = buf.readUInt16BE(o + 2);
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
            o += 2 + len;
        }
    }
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return ['webp', ''];
    return ['?', '?'];
};
const bufferViewBytes = (bvIdx) => {
    const bv = gltf.bufferViews[bvIdx];
    const b = gltf.buffers[bv.buffer];
    const data = b.uri ? readFileSync(join(baseDir, decodeURIComponent(b.uri))) : glbBin;
    return data.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
};
const images = (gltf.images || []).map((img, i) => {
    let bytes, label;
    if (img.uri && !img.uri.startsWith('data:')) {
        const p = join(baseDir, decodeURIComponent(img.uri));
        bytes = readFileSync(p); label = img.uri;
    } else if (img.bufferView !== undefined) {
        bytes = bufferViewBytes(img.bufferView); label = `(embedded #${i})`;
    } else {
        bytes = Buffer.from(img.uri.split(',')[1], 'base64'); label = `(data uri #${i})`;
    }
    const [w, h] = imageSize(bytes);
    return { label, w, h, kb: bytes.length / 1024 };
});
const texImage = (ti) => gltf.textures?.[ti]?.source;

// ---------- report ----------
const out = [];
const line = (s = '') => out.push(s);
line(`# ${basename(file)}`);
const a = gltf.asset || {};
line(`generator: ${a.generator ?? '-'}   version: ${a.version}`);
if (a.extras) line(`extras: ${JSON.stringify(a.extras)}`);
line(`extensionsUsed: ${(gltf.extensionsUsed || []).join(', ') || '-'}   required: ${(gltf.extensionsRequired || []).join(', ') || '-'}`);
let fileBytes = statSync(file).size;
for (const b of gltf.buffers || []) if (b.uri && !b.uri.startsWith('data:')) fileBytes += statSync(join(baseDir, decodeURIComponent(b.uri))).size;
line(`geometry bytes (gltf+bin): ${(fileBytes / 1048576).toFixed(1)} MB`);
line(`nodes ${nodes.length}  meshes ${meshInfo.length}  mesh nodes ${meshNodes.length}  materials ${(gltf.materials || []).length}  images ${images.length}  animations ${(gltf.animations || []).length}  skins ${(gltf.skins || []).length}`);
line(`triangles (instanced in scene) ${Math.round(totTris).toLocaleString()}  vertices ${totVerts.toLocaleString()}`);
line(`world bounds min ${v3(total.min)} max ${v3(total.max)}`);
const sz = size(total);
line(`world size x=${f(sz[0])} y=${f(sz[1])} z=${f(sz[2])} m   (expect length ~4.55, width ~1.95, height ~1.22 for Huracan STO)`);
line(`world center ${v3(center(total))}`);

line('\n## Materials');
(gltf.materials || []).forEach((m, i) => {
    const p = m.pbrMetallicRoughness || {};
    const tex = [];
    if (p.baseColorTexture) tex.push(`base:${texImage(p.baseColorTexture.index)}`);
    if (p.metallicRoughnessTexture) tex.push(`mr:${texImage(p.metallicRoughnessTexture.index)}`);
    if (m.normalTexture) tex.push(`normal:${texImage(m.normalTexture.index)}`);
    if (m.occlusionTexture) tex.push(`ao:${texImage(m.occlusionTexture.index)}`);
    if (m.emissiveTexture) tex.push(`emis:${texImage(m.emissiveTexture.index)}`);
    const users = meshNodes.filter(n => n.mesh.mats.includes(i));
    const tris = users.reduce((s, n) => s + n.mesh.tris, 0);
    line(`[${i}] ${m.name}  base=${p.baseColorFactor ? v3(p.baseColorFactor.slice(0, 3)) + ' a' + f(p.baseColorFactor[3]) : '-'} metal=${f(p.metallicFactor ?? 1)} rough=${f(p.roughnessFactor ?? 1)}${m.emissiveFactor ? ' emissive=' + v3(m.emissiveFactor) : ''} ${m.alphaMode ?? ''}${m.doubleSided ? ' 2side' : ''} tex[${tex.join(' ')}] ext[${Object.keys(m.extensions || {}).join(',')}] nodes=${users.length} tris~${Math.round(tris)}`);
});

line('\n## Images');
images.forEach((im, i) => line(`[${i}] ${im.w}x${im.h}  ${im.kb.toFixed(0)} KB  ${im.label}`));

const listAll = process.argv.includes('--all');
line(`\n## ${listAll ? 'All' : 'Largest'} mesh nodes (world center / size)`);
[...meshNodes].sort((x, y) => y.mesh.tris - x.mesh.tris).slice(0, listAll ? Infinity : 25).forEach((m) => {
    line(`${String(Math.round(m.mesh.tris)).padStart(7)} tris  ${m.name.padEnd(40).slice(0, 40)} c=${v3(center(m.world))} s=${v3(size(m.world))} mats=${m.mesh.mats.map(x => gltf.materials?.[x]?.name).join('|')}`);
});

// wheel candidates: by name, or by shape (roughly round, 0.5-0.85 m diameter, near ground)
const wheelName = /wheel|tyre|tire|rim|ruot|cerch|pneum|gomm|brake|caliper|pinz|disc|disk|hub/i;
const groundY = total.min[1];
const cands = meshNodes.filter((m) => {
    if (!valid(m.world)) return false;
    const s = size(m.world);
    const dims = [...s].sort((p, q) => q - p);
    const round = dims[0] > 0.45 && dims[0] < 0.9 && Math.abs(dims[0] - dims[1]) < 0.12 && s[1] > 0.45;
    const low = m.world.min[1] - groundY < 0.25;
    return wheelName.test(m.name) || wheelName.test(m.mesh.name ?? '') || (round && low);
});
line('\n## Wheel candidates (name match, or round 0.45-0.9 m and touching the ground)');
cands.forEach((m) => line(`${m.name.padEnd(40).slice(0, 40)} c=${v3(center(m.world))} s=${v3(size(m.world))} tris=${Math.round(m.mesh.tris)} mats=${m.mesh.mats.map(x => gltf.materials?.[x]?.name).join('|')}`));
if (!cands.length) line('(none found)');

if (showTree) {
    line('\n## Node tree');
    treeLines.forEach(l => line(l));
}
console.log(out.join('\n'));
