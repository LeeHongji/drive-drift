// Two custom CameraFrame effects in the scene slot: speed blur (radial zoom blur + speed lines, driven by
// nitro) and lens droplets (rain beads on the lens that refract the scene; they dry up inside the gallery).
// Each ships its shader in GLSL and WGSL. Both work in "image space" (y up on every backend) through the
// engine's getImageEffectUV, which is its own inverse, so the two languages share the same maths.

import * as pc from 'playcanvas';
import { LENS } from '../config/lens-effects';
import { QUALITY } from '../config/quality';
import type { FrameState, FrameSystem } from '../core/frame';
import { damp } from '../core/math';
import type { Post } from './post';

const SPEED_BLUR_GLSL = /* glsl */ `
uniform vec4 speedBlurParams; // amount, streaks, time, aspect
float sbHash(float n) { return fract(sin(n * 91.345) * 47453.21); }
vec4 applySpeedBlur(vec4 scene, vec2 uv) {
    float amount = speedBlurParams.x;
    float streaks = speedBlurParams.y;
    if (amount <= 0.0005 && streaks <= 0.0005) return scene;
    vec2 p = getImageEffectUV(uv);
    // Zoom toward a point just below the middle, where the car sits; the centre stays sharp.
    vec2 dir = p - vec2(0.5, 0.46);
    float r2 = dot(dir, dir);
    float mask = smoothstep(0.012, 0.2, r2) * amount;
    vec3 col = scene.rgb;
    if (mask > 0.0005) {
        vec3 acc = vec3(0.0);
        float jitter = sbHash(dot(p, vec2(641.7, 377.3)) + speedBlurParams.z);
        for (int i = 0; i < 8; i++) {
            float t = (float(i) + jitter) / 8.0;
            acc += texture2D(sceneTexture, getImageEffectUV(p - dir * mask * t)).rgb;
        }
        col = acc / 8.0;
    }
    // Speed lines: thin streaks in one lane out of five, sliding outward.
    float lanes = atan(dir.y, dir.x * speedBlurParams.w) * 110.0 / 6.2831853;
    float h = sbHash(floor(lanes));
    float t = fract(sqrt(r2) * (1.5 + h) - speedBlurParams.z * (1.4 + 2.2 * h) + 7.0 * h);
    float line = max(0.0, 1.0 - abs(fract(lanes) - 0.5) * (9.0 + 12.0 * h));
    float window = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.2, 0.7, t));
    float streak = line * window * step(0.8, h) * smoothstep(0.06, 0.34, r2);
    col += streak * streaks * vec3(0.85, 0.92, 1.0);
    return vec4(col, scene.a);
}
`;

const SPEED_BLUR_WGSL = /* wgsl */ `
uniform speedBlurParams: vec4f; // amount, streaks, time, aspect
fn sbHash(n: f32) -> f32 { return fract(sin(n * 91.345) * 47453.21); }
fn applySpeedBlur(scene: vec4f, uv: vec2f) -> vec4f {
    let amount = uniform.speedBlurParams.x;
    let streaks = uniform.speedBlurParams.y;
    if (amount <= 0.0005 && streaks <= 0.0005) { return scene; }
    let p = getImageEffectUV(uv);
    let dir = p - vec2f(0.5, 0.46);
    let r2 = dot(dir, dir);
    let mask = smoothstep(0.012, 0.2, r2) * amount;
    var col = scene.rgb;
    if (mask > 0.0005) {
        var acc = vec3f(0.0);
        let jitter = sbHash(dot(p, vec2f(641.7, 377.3)) + uniform.speedBlurParams.z);
        for (var i = 0; i < 8; i++) {
            let t = (f32(i) + jitter) / 8.0;
            acc += textureSampleLevel(sceneTexture, sceneTextureSampler, getImageEffectUV(p - dir * mask * t), 0.0).rgb;
        }
        col = acc / 8.0;
    }
    let lanes = atan2(dir.y, dir.x * uniform.speedBlurParams.w) * 110.0 / 6.2831853;
    let h = sbHash(floor(lanes));
    let t = fract(sqrt(r2) * (1.5 + h) - uniform.speedBlurParams.z * (1.4 + 2.2 * h) + 7.0 * h);
    let line = max(0.0, 1.0 - abs(fract(lanes) - 0.5) * (9.0 + 12.0 * h));
    let window = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.2, 0.7, t));
    let streak = line * window * step(0.8, h) * smoothstep(0.06, 0.34, r2);
    col += streak * streaks * vec3f(0.85, 0.92, 1.0);
    return vec4f(col, scene.a);
}
`;

const DROPLETS_GLSL = /* glsl */ `
uniform vec4 dropletsParams; // time, amount, aspect, pixel height in uv
vec3 dpHash(vec2 c, float seed) {
    vec3 q = vec3(dot(c, vec2(127.1, 311.7)) + seed, dot(c, vec2(269.5, 183.3)) + seed * 1.7, dot(c, vec2(419.2, 371.9)) + seed * 2.3);
    return fract(sin(q) * 43758.5453);
}
// One layer of beads: a grid of n cells per screen height, at most one bead per cell.
float dpBeads(vec2 s, float n, float t, float seed, float sparse) {
    vec2 g = s * n;
    vec2 cell = floor(g);
    vec3 h = dpHash(cell, seed);
    // Beads gather toward the rim; the middle of the lens stays clear.
    vec2 cc = (cell + 0.5) / n;
    float rim = length(vec2(cc.x / dropletsParams.z, cc.y) - 0.5);
    float keep = mix(1.0, sparse, smoothstep(0.12, 0.42, rim));
    if (h.z < keep) return 0.0;
    float life = fract(t * (0.015 + 0.025 * h.z) + 7.0 * h.x);
    float r = (0.1 + 0.18 * h.y) * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.6, 1.0, life));
    float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.4);
    if (r <= 0.0 || d >= r) return 0.0;
    return sqrt(1.0 - d * d / (r * r)) * r / n;
}
float dpHeight(vec2 s) {
    float t = dropletsParams.x;
    return max(dpBeads(s, 22.0, t, 0.0, 0.7), dpBeads(s, 40.0, t * 1.3, 4.1, 0.8)) * dropletsParams.y;
}
vec4 applyDroplets(vec4 scene, vec2 uv) {
    if (dropletsParams.y <= 0.001) return scene;
    vec2 p = getImageEffectUV(uv);
    vec2 s = vec2(p.x * dropletsParams.z, p.y);
    float h = dpHeight(s);
    if (h <= 0.0) return scene;
    float e = 1.5 * dropletsParams.w;
    vec2 slope = vec2(dpHeight(s + vec2(e, 0.0)) - dpHeight(s - vec2(e, 0.0)), dpHeight(s + vec2(0.0, e)) - dpHeight(s - vec2(0.0, e))) / (2.0 * e);
    // A bead is a tiny lens: look through it at an offset, slightly cooler.
    vec2 off = -slope * 0.025;
    vec3 seen = texture2D(sceneTexture, getImageEffectUV(p + vec2(off.x / dropletsParams.z, off.y))).rgb * vec3(1.06, 1.09, 1.15);
    return vec4(mix(scene.rgb, seen, smoothstep(0.0, 0.004, h)), scene.a);
}
`;

const DROPLETS_WGSL = /* wgsl */ `
uniform dropletsParams: vec4f; // time, amount, aspect, pixel height in uv
fn dpHash(c: vec2f, seed: f32) -> vec3f {
    let q = vec3f(dot(c, vec2f(127.1, 311.7)) + seed, dot(c, vec2f(269.5, 183.3)) + seed * 1.7, dot(c, vec2f(419.2, 371.9)) + seed * 2.3);
    return fract(sin(q) * 43758.5453);
}
fn dpBeads(s: vec2f, n: f32, t: f32, seed: f32, sparse: f32) -> f32 {
    let g = s * n;
    let cell = floor(g);
    let h = dpHash(cell, seed);
    let cc = (cell + 0.5) / n;
    let rim = length(vec2f(cc.x / uniform.dropletsParams.z, cc.y) - 0.5);
    let keep = mix(1.0, sparse, smoothstep(0.12, 0.42, rim));
    if (h.z < keep) { return 0.0; }
    let life = fract(t * (0.015 + 0.025 * h.z) + 7.0 * h.x);
    let r = (0.1 + 0.18 * h.y) * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.6, 1.0, life));
    let d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.4);
    if (r <= 0.0 || d >= r) { return 0.0; }
    return sqrt(1.0 - d * d / (r * r)) * r / n;
}
fn dpHeight(s: vec2f) -> f32 {
    let t = uniform.dropletsParams.x;
    return max(dpBeads(s, 22.0, t, 0.0, 0.7), dpBeads(s, 40.0, t * 1.3, 4.1, 0.8)) * uniform.dropletsParams.y;
}
fn applyDroplets(scene: vec4f, uv: vec2f) -> vec4f {
    if (uniform.dropletsParams.y <= 0.001) { return scene; }
    let p = getImageEffectUV(uv);
    let s = vec2f(p.x * uniform.dropletsParams.z, p.y);
    let h = dpHeight(s);
    if (h <= 0.0) { return scene; }
    let e = 1.5 * uniform.dropletsParams.w;
    let slope = vec2f(dpHeight(s + vec2f(e, 0.0)) - dpHeight(s - vec2f(e, 0.0)), dpHeight(s + vec2f(0.0, e)) - dpHeight(s - vec2f(0.0, e))) / (2.0 * e);
    let off = -slope * 0.025;
    let seen = textureSampleLevel(sceneTexture, sceneTextureSampler, getImageEffectUV(p + vec2f(off.x / uniform.dropletsParams.z, off.y)), 0.0).rgb * vec3f(1.06, 1.09, 1.15);
    return vec4f(mix(scene.rgb, seen, smoothstep(0.0, 0.004, h)), scene.a);
}
`;

class ParamEffect extends pc.CameraFrameEffect {
  readonly params = new Float32Array(4);
  constructor(device: pc.GraphicsDevice, id: string, private readonly uniformName: string, glsl: string, wgsl: string) {
    super(device, id, { slot: pc.COMPOSESLOT_SCENE, glsl, wgsl });
  }
  update(): void {
    this.setUniform(this.uniformName, this.params);
  }
}

/** Returns null when the quality preset turns lens effects off. Add it to the frame systems BEFORE the post
 *  stack: it sets the effect inputs that `post.update` then applies. */
export function createLensEffects(app: pc.AppBase, post: Post): FrameSystem | null {
  if (!QUALITY.lensEffects) return null;
  const device = app.graphicsDevice;
  const blur = new ParamEffect(device, 'speedBlur', 'speedBlurParams', SPEED_BLUR_GLSL, SPEED_BLUR_WGSL);
  const drops = new ParamEffect(device, 'droplets', 'dropletsParams', DROPLETS_GLSL, DROPLETS_WGSL);
  post.addEffect(blur);
  post.addEffect(drops);
  let wet = LENS.dropletsBase;

  return {
    update(frame: FrameState): void {
      const aspect = device.width / Math.max(1, device.height);
      const s = frame.speedRatio;
      blur.params[0] = frame.boost * LENS.blurBoost + frame.surge * LENS.blurSurge;
      blur.params[1] = s * s * LENS.streaksSpeed + frame.boost * LENS.streaksBoost + frame.surge * LENS.streaksSurge;
      blur.params[2] = frame.time;
      blur.params[3] = aspect;

      // Rain on the lens builds with speed and dries off inside the gallery.
      const target = (LENS.dropletsBase + LENS.dropletsSpeed * s) * (1 - frame.tunnel);
      wet += (target - wet) * damp(target < wet ? LENS.dryRate : LENS.wetRate, frame.dt);
      drops.params[0] = frame.time;
      drops.params[1] = wet;
      drops.params[2] = aspect;
      drops.params[3] = 1 / Math.max(1, device.height);
    },
  };
}
