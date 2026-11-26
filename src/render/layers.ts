// Render layers. Besides the engine's World layer there is one custom layer, "Road", drawn right after it.
// It holds what must NOT show up in the road's planar reflection or be lit by car-body-only lights:
// the road surface itself, grass, trees, skid marks and the contact shadow. Everything else stays in World.

import * as pc from 'playcanvas';

export const ROAD_LAYER_ID = 100;

/** Layers a normal scene light should affect (sun, tunnel lights, dipped beams). */
export const LIT_LAYERS = [pc.LAYERID_WORLD, ROAD_LAYER_ID];
/** For lights that should fall on the ground only (nitro glow, main beams). */
export const ROAD_ONLY_LAYERS = [ROAD_LAYER_ID];
/** Layers the main camera renders. */
export const MAIN_CAMERA_LAYERS = [pc.LAYERID_WORLD, ROAD_LAYER_ID, pc.LAYERID_DEPTH, pc.LAYERID_SKYBOX, pc.LAYERID_IMMEDIATE, pc.LAYERID_UI];
/** Layers the road reflection camera renders (no Road layer: the road must not reflect itself). */
export const REFLECTION_CAMERA_LAYERS = [pc.LAYERID_WORLD, pc.LAYERID_SKYBOX];

/** Create the Road layer and slot it in after World, for both opaque and transparent passes. Call once. */
export function setupLayers(app: pc.AppBase): pc.Layer {
  const comp = app.scene.layers;
  const world = comp.getLayerById(pc.LAYERID_WORLD)!;
  const road = new pc.Layer({ name: 'Road', id: ROAD_LAYER_ID });
  comp.insertOpaque(road, comp.getOpaqueIndex(world) + 1);
  comp.insertTransparent(road, comp.getTransparentIndex(world) + 1);
  return road;
}
