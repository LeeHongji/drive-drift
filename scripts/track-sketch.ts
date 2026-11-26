// Design aid: draws the segment list WITHOUT closing the loop, so a layout that does not close yet can still
// be looked at. Prints where each segment ends. Usage: tsx scripts/track-sketch.ts out.svg
import { writeFileSync } from 'node:fs';
import { TRACK } from '../src/config/track';

const DEG = Math.PI / 180;
let x = 0;
let z = 0;
let yaw = 0;
const pts: [number, number][] = [[0, 0]];
const marks: string[] = [];
TRACK.segments.forEach((seg, k) => {
  const x0 = x;
  const z0 = z;
  if (seg.kind === 'straight') {
    x += -Math.sin(yaw) * seg.length;
    z += -Math.cos(yaw) * seg.length;
    pts.push([x, z]);
  } else {
    const side = seg.dir === 'left' ? 1 : -1;
    const steps = Math.ceil(seg.angle / 3);
    const cx = x + -Math.cos(yaw) * side * seg.radius;
    const cz = z + Math.sin(yaw) * side * seg.radius;
    for (let i = 1; i <= steps; i++) {
      const a = yaw + (side * seg.angle * DEG * i) / steps;
      pts.push([cx + Math.cos(a) * side * seg.radius, cz - Math.sin(a) * side * seg.radius]);
    }
    yaw += side * seg.angle * DEG;
    [x, z] = pts[pts.length - 1];
  }
  marks.push(`<text x="${(x0 + x) / 2}" y="${(z0 + z) / 2}" font-size="22" fill="#c00">${k + 1}</text>`);
  console.log(`${String(k + 1).padStart(2)} ${seg.name}  end (${x.toFixed(0)}, ${z.toFixed(0)}) yaw ${((yaw / DEG) % 360).toFixed(0)}°`);
});
const xs = pts.map((p) => p[0]);
const zs = pts.map((p) => p[1]);
const pad = 80;
const vb = [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...zs) - Math.min(...zs) + 2 * pad];
writeFileSync(
  process.argv[2] ?? '/tmp/track-sketch.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="1400"><rect x="${vb[0]}" y="${vb[1]}" width="100%" height="100%" fill="#eee"/>
<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#333" stroke-width="18" stroke-linejoin="round"/>
<circle cx="0" cy="0" r="14" fill="#fc0"/>${marks.join('')}</svg>`,
);
