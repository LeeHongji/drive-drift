// Prints the generated track's metrics (length, per-segment radius and grade, clearances) and writes a
// top-down SVG. Run after every layout change: `npm run track:report [-- out.svg]`.
import { writeFileSync } from 'node:fs';
import { TRACK } from '../src/config/track';
import { buildTrack } from '../src/track/track';

const out = process.argv[2] ?? 'docs/verification/M1/track-top.svg';
const t = buildTrack(TRACK);
const f1 = (v: number): string => v.toFixed(1);

let yMin = Infinity;
let yMax = -Infinity;
let gMin = Infinity;
let gMax = -Infinity;
for (let i = 0; i < t.n; i++) {
  yMin = Math.min(yMin, t.y[i]);
  yMax = Math.max(yMax, t.y[i]);
  gMin = Math.min(gMin, t.grade[i]);
  gMax = Math.max(gMax, t.grade[i]);
}
console.log(`length ${f1(t.length)} m   samples ${t.n}   spacing ${t.spacing.toFixed(4)} m`);
console.log(`height ${f1(yMin)} … ${f1(yMax)} m   grade ${(gMin * 100).toFixed(1)} % … ${(gMax * 100).toFixed(1)} %`);
console.log('\n#  segment                 s0–s1 (m)        len   design R   min R(actual)  bank°   y0→y1');
t.spans.forEach((sp, k) => {
  const i0 = Math.round(sp.s0 / t.spacing);
  const i1 = Math.round(sp.s1 / t.spacing);
  let kMax = 0;
  let bMax = 0;
  for (let i = i0; i < i1; i++) {
    kMax = Math.max(kMax, Math.abs(t.curv[i % t.n]));
    bMax = Math.max(bMax, Math.abs(t.bank[i % t.n]));
  }
  const r = sp.kind === 'arc' ? `${sp.radius > 0 ? 'L' : 'R'}${Math.abs(sp.radius)}` : '—';
  const rAct = kMax > 1e-4 ? f1(1 / kMax) : '∞';
  console.log(
    `${String(k + 1).padStart(2)} ${sp.name.padEnd(14, '　')} ${f1(sp.s0).padStart(7)}–${f1(sp.s1).padEnd(7)} ${f1(sp.s1 - sp.s0).padStart(6)}  ${r.padStart(6)}   ${rAct.padStart(8)}      ${((bMax * 180) / Math.PI).toFixed(1).padStart(4)}   ${f1(t.y[i0 % t.n])}→${f1(t.y[i1 % t.n])}`,
  );
});

// Clearance: closest approach between centreline samples that are more than 120 m apart along the track.
let minGap = Infinity;
let gapAt = [0, 0];
for (let i = 0; i < t.n; i += 2) {
  for (let j = i + 60; j < t.n; j += 2) {
    if (t.n - j + i < 60) continue;
    const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
    if (d < minGap) {
      minGap = d;
      gapAt = [i, j];
    }
  }
}
console.log(
  `\nclosest approach of two different road sections: ${f1(minGap)} m centre to centre at s=${f1(gapAt[0] * t.spacing)} / ${f1(gapAt[1] * t.spacing)} (walls need > ${2 * t.wallOffset + 2} m)`,
);

// SVG, north (−Z) up.
let x0 = Infinity;
let x1 = -Infinity;
let z0 = Infinity;
let z1 = -Infinity;
for (let i = 0; i < t.n; i++) {
  x0 = Math.min(x0, t.x[i]);
  x1 = Math.max(x1, t.x[i]);
  z0 = Math.min(z0, t.z[i]);
  z1 = Math.max(z1, t.z[i]);
}
// Square view box so thumbnailers that crop to a square still show the whole circuit.
const side = Math.max(x1 - x0, z1 - z0) + 120;
const vx = (x0 + x1) / 2 - side / 2;
const vz = (z0 + z1) / 2 - side / 2;
const pts: string[] = [];
for (let i = 0; i < t.n; i++) pts.push(`${f1(t.x[i])},${f1(t.z[i])}`);
const labels = t.spans
  .map((sp, k) => {
    const i = Math.round((sp.s0 + sp.s1) / 2 / t.spacing) % t.n;
    return `<text x="${f1(t.x[i])}" y="${f1(t.z[i])}" font-size="16" fill="#111" text-anchor="middle" dy="5">${k + 1}</text>`;
  })
  .join('');
const fi = Math.round(TRACK.finishS / t.spacing);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(vx)} ${f1(vz)} ${f1(side)} ${f1(side)}" width="1400" height="1400">
<rect x="${f1(vx)}" y="${f1(vz)}" width="${f1(side)}" height="${f1(side)}" fill="#e9efe4"/>
<polygon points="${pts.join(' ')}" fill="none" stroke="#8a8f96" stroke-width="${2 * t.wallOffset}" stroke-linejoin="round"/>
<polygon points="${pts.join(' ')}" fill="none" stroke="#33373d" stroke-width="${2 * TRACK.halfWidth}" stroke-linejoin="round"/>
<circle cx="${f1(t.x[fi])}" cy="${f1(t.z[fi])}" r="12" fill="#ffd500"/>
<path d="M ${f1(t.x[fi])} ${f1(t.z[fi])} l ${f1(t.tx[fi] * 60)} ${f1(t.tz[fi] * 60)}" stroke="#ffd500" stroke-width="5"/>
${labels.replace(/fill="#111"/g, 'fill="#fff"')}
</svg>`;
writeFileSync(out, svg);
console.log(`\nwrote ${out}`);
