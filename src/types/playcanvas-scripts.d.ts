// Typings for the engine's ESM scripts we import directly (they ship as untyped .mjs).
declare module 'playcanvas/scripts/esm/planar-renderer.mjs' {
  import { Entity, Mat4, Script, Texture, Vec3 } from 'playcanvas';

  export class PlanarRenderer extends Script {
    sceneCameraEntity: Entity | null;
    mode: 'reflection' | 'refraction';
    /** Render target size as a fraction of the scene camera's. */
    scale: number;
    mipmaps: boolean;
    mipmapFilter: 'box' | 'gaussian';
    depth: boolean;
    hdr: boolean;
    planePoint: Vec3;
    planeNormal: Vec3;
    obliqueClipping: boolean;
    clipBias: number;
    get viewProjectionMatrix(): Mat4;
    /** Mirror the camera for this frame; returns the texture being rendered, or null when disabled. */
    frameUpdate(): Texture | null;
  }
}
