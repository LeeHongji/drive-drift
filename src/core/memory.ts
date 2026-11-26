// Memory housekeeping for data the GPU already has a copy of.
//
// Two things keep big CPU-side copies alive after upload:
//  - a pc.Mesh keeps the arrays passed to setPositions/setNormals/… so it can be updated again;
//  - a pc.Texture keeps its source (a canvas or a typed array) so it can be re-uploaded.
// Static meshes never update and procedural textures are never edited, so both copies can go.
//
// Trade-off: after a lost graphics context the engine cannot restore these textures from their sources.
// The game reloads the page on context restore instead (see `reloadOnDeviceRestore`).

import type * as pc from 'playcanvas';

/** Drop the CPU-side geometry arrays of a mesh that will never be updated again. */
export function releaseMeshData(mesh: pc.Mesh): pc.Mesh {
  // `_geometryData` is engine-internal: it is created lazily by set*() and only read by update().
  (mesh as unknown as { _geometryData: unknown })._geometryData = null;
  return mesh;
}

interface TextureInternals {
  _needsUpload: boolean;
  _needsMipmapsUpload: boolean;
  _levels: unknown[] | null;
}

/**
 * Frees texture sources once the GPU holds the pixels. Textures upload lazily, the first time they are drawn
 * (a gallery banner uploads when the car first gets there), so this is called every couple of seconds rather
 * than once. Returns the number of sources released by this call.
 */
export function releaseUploadedTextureSources(device: pc.GraphicsDevice): number {
  let released = 0;
  for (const texture of device.textures) {
    const t = texture as unknown as TextureInternals;
    if (t._needsUpload || t._needsMipmapsUpload || !t._levels) continue;
    const levels = t._levels;
    for (let i = 0; i < levels.length; i++) {
      const source = levels[i];
      if (source instanceof HTMLCanvasElement) {
        if (source.width === 0) continue;
        // Shrinking the canvas frees its bitmap; the element itself stays as a harmless placeholder.
        source.width = 0;
        source.height = 0;
        released++;
      } else if (ArrayBuffer.isView(source) && source.byteLength >= MIN_ARRAY_BYTES) {
        levels[i] = null;
        released++;
      }
    }
  }
  return released;
}

/** Typed-array sources smaller than this are not worth releasing. */
const MIN_ARRAY_BYTES = 64 * 1024;

/** Sources were released, so a restored context would show blank textures: start over instead. */
export function reloadOnDeviceRestore(device: pc.GraphicsDevice): void {
  device.on('devicerestored', () => location.reload());
}
