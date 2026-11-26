// Graphics device and application bootstrap. Engine-only (no Editor): we register just the systems we use.
// The post stack, dynamic sky, lens flare and auto exposure are plain engine classes (CameraFrame and its
// effects), so they need neither the script component system nor extra resource handlers.

import * as pc from 'playcanvas';

export interface AppContext {
  app: pc.AppBase;
  device: pc.GraphicsDevice;
  canvas: HTMLCanvasElement;
}

/**
 * `prefer` forces a backend (`?device=webgl2` or `?device=webgpu`); by default WebGPU is tried first.
 */
export async function createApp(canvas: HTMLCanvasElement, prefer: string | null, maxPixelRatio: number): Promise<AppContext> {
  const deviceTypes = prefer === 'webgl2' ? ['webgl2'] : prefer === 'webgpu' ? ['webgpu'] : ['webgpu', 'webgl2'];
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes,
    // Anti-aliasing is done by MSAA on the CameraFrame's scene target (src/render/post.ts); the back buffer
    // only receives the full-screen compose pass.
    antialias: false,
    powerPreference: 'high-performance',
  });
  device.maxPixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);

  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.ParticleSystemComponentSystem, pc.ScriptComponentSystem];
  options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];

  const app = new pc.AppBase(canvas);
  app.init(options);
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  window.addEventListener('resize', () => app.resizeCanvas());
  return { app, device, canvas };
}

export function loadContainer(app: pc.AppBase, name: string, url: string): Promise<pc.Asset> {
  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(name, 'container', { url });
    asset.once('load', () => resolve(asset));
    asset.once('error', (err: unknown) => reject(new Error(`failed to load ${url}: ${String(err)}`)));
    app.assets.add(asset);
    app.assets.load(asset);
  });
}
