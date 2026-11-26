// Verification cameras, selected with `?cam=aerial|trackside|orbit` (`&s=<arc length>` for trackside,
// `&az=&dist=&h=` for orbit) or from `window.__game.setCamera`.
// They replace the chase camera's transform so screenshots are repeatable.

import type * as pc from 'playcanvas';
import { frameAt, type Track } from '../track/track';

export type CameraMode = 'chase' | 'aerial' | 'trackside' | 'orbit';

/** Straight down over the whole circuit, north (−Z) up. Matches scripts/track-report.ts's SVG. */
export function poseAerial(camera: pc.Entity, track: Track): void {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < track.n; i++) {
    x0 = Math.min(x0, track.x[i]);
    x1 = Math.max(x1, track.x[i]);
    z0 = Math.min(z0, track.z[i]);
    z1 = Math.max(z1, track.z[i]);
  }
  const fov = 40;
  const aspect = camera.camera!.aspectRatio;
  const half = Math.max((z1 - z0) / 2 + 80, ((x1 - x0) / 2 + 80) / aspect);
  const height = half / Math.tan((fov / 2) * (Math.PI / 180));
  camera.camera!.fov = fov;
  camera.setPosition((x0 + x1) / 2, height, (z0 + z1) / 2);
  camera.setEulerAngles(-90, 0, 0);
}

/** On the outside of the road at arc length `s`, 3 m above it, watching the given point. */
export function poseTrackside(camera: pc.Entity, track: Track, s: number, lookX: number, lookY: number, lookZ: number): void {
  const f = frameAt(track, s);
  const side = f.curv <= 0 ? 1 : -1; // outside of the corner; left on straights
  const d = side * (track.wallOffset + 4);
  camera.camera!.fov = 38;
  camera.setPosition(f.x + f.lx * d, f.y + 3, f.z + f.lz * d);
  camera.lookAt(lookX, lookY, lookZ);
}

/**
 * Fixed to the car: `az` degrees around it (0 = behind, 90 = its right side, 180 = in front), `dist` metres
 * away, `height` metres up. For close-up checks of the model, wheels and lights.
 */
export function poseOrbit(camera: pc.Entity, x: number, y: number, z: number, yaw: number, az: number, dist: number, height: number): void {
  const a = yaw + Math.PI - (az * Math.PI) / 180; // direction from the car to the camera, as a yaw
  camera.camera!.fov = 40;
  camera.setPosition(x - Math.sin(a) * dist, y + height, z - Math.cos(a) * dist);
  camera.lookAt(x, y + 0.55, z);
}
