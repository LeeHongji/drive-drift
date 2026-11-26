// Planar reflection for the wet road: a mirrored camera renders the scene (without the Road layer) into an
// HDR texture with gaussian mipmaps, and the asphalt material samples it, blurrier where it is less glossy.
// The mirror plane is the banked, sloping road surface under the car, so the reflection is exact near the
// car and approximate far away, where the road has curved off that plane.

import * as pc from 'playcanvas';
import { PlanarRenderer } from 'playcanvas/scripts/esm/planar-renderer.mjs';
import { QUALITY } from '../config/quality';
import type { FrameState, FrameSystem } from '../core/frame';
import { frameAt, makeFrame } from '../track/track';
import { REFLECTION_CAMERA_LAYERS } from './layers';

/** Returns null when the quality preset turns reflections off. */
export function createRoadReflection(app: pc.AppBase, camera: pc.Entity, material: pc.StandardMaterial): FrameSystem | null {
  if (QUALITY.reflectionScale <= 0) return null;

  const entity = new pc.Entity('RoadReflectionCamera');
  entity.addComponent('camera', {
    layers: REFLECTION_CAMERA_LAYERS,
    // Before the main camera, so this frame's reflection is ready when the road is drawn.
    priority: -1,
    clearColor: new pc.Color(0, 0, 0),
  });
  entity.addComponent('script');
  app.root.addChild(entity);
  const planar = entity.script!.create(PlanarRenderer, {
    properties: {
      sceneCameraEntity: camera,
      mode: 'reflection',
      scale: QUALITY.reflectionScale,
      mipmaps: true,
      mipmapFilter: 'gaussian',
      hdr: true,
    },
  }) as PlanarRenderer;

  let bound: pc.Texture | null = null;
  const roadFrame = makeFrame();
  return {
    update(frame: FrameState): void {
      // Road plane under the car: a point on the centreline and the surface normal from grade and bank.
      const f = frameAt(frame.track, frame.car.loc.s, 0, roadFrame);
      const tan = Math.tan(f.bank);
      // Surface height = y0 + grade·(along) − tan(bank)·(left); its gradient gives the normal.
      const nx = -f.grade * f.tx + tan * f.lx;
      const nz = -f.grade * f.tz + tan * f.lz;
      planar.planePoint.set(f.x, f.y, f.z);
      planar.planeNormal.set(nx, 1, nz).normalize();

      const texture = planar.frameUpdate();
      material.planarReflectionMatrix = planar.viewProjectionMatrix;
      if (texture !== bound) {
        bound = texture;
        material.planarReflectionMap = texture;
        material.update();
      }
    },
  };
}
