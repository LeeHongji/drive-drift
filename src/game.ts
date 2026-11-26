// Game bundle entry: builds the world, then runs the frame loop (fixed-step simulation, interpolated render).

import * as pc from 'playcanvas';
import { createAudio } from './audio/audio';
import { ChaseCamera } from './camera/chase';
import { CAMERA } from './config/camera';
import { CAR } from './config/car';
import { DRIFT } from './config/drift';
import { RENDER } from './config/render';
import { SCORING } from './config/scoring';
import { TRACK } from './config/track';
import { createApp, loadContainer } from './core/app';
import { releaseUploadedTextureSources, reloadOnDeviceRestore } from './core/memory';
import type { FrameState, FrameSystem } from './core/frame';
import { FixedStepper } from './core/loop';
import { DEG, KMH, wrapAngle } from './core/math';
import { SIM_DT } from './config/sim';
import { autopilotInput } from './debug/autopilot';
import { BOT, DriftBot, driftSpeedFor } from './debug/drift-bot';
import { poseAerial, poseOrbit, poseTrackside, type CameraMode } from './debug/cameras';
import { loadBests, saveBests } from './gameplay/bests';
import { Session } from './gameplay/session';
import { INPUT } from './config/input';
import { InputManager } from './input/manager';
import { setQuality, QUALITY } from './config/quality';
import { CarVisual } from './render/car-visual';
import { setupLayers } from './render/layers';
import { createLensEffects } from './render/lens-effects';
import { createPost } from './render/post';
import { createRoadReflection } from './render/road-reflection';
import { arcDelta, buildTrack, findCorners } from './track/track';
import { Hud, type PaceNote } from './ui/hud';
import { createCarFx } from './vfx/car-fx';
import { PickupsVisual } from './vfx/pickups-visual';
import { TyreFx } from './vfx/tyres';
import type { CarInput } from './vehicle/car';
import { createSky } from './world/sky';
import { createTerrain } from './world/terrain';
import { createTrackVisual } from './world/track-visual';
import { COACH_TEXT } from './ui/coach-text';
import { createWorld } from './world/world';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  params: URLSearchParams;
  progress: (text: string, fraction: number) => void;
  /** Called when an input device asks to pause or resume (gamepad Start, touch pause button). */
  onPauseRequest?: () => void;
  /** Gamepad D-pad / stick and A while paused: move the focus in the pause menu, press the focused item. */
  onMenuNavigate?: (dir: 1 | -1) => void;
  onMenuAccept?: () => void;
}

/** What the shell (menu, pause screen) can do with a running game. */
export interface GameHandle {
  /** Freeze the simulation and every time-based effect; the last frame stays on screen. */
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Back to the grid with scores and laps cleared. */
  restart(): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

/** Lets the loading screen repaint between heavy synchronous build steps. */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export async function startGame(opts: GameOptions): Promise<GameHandle> {
  const { params, progress } = opts;
  const debug = params.has('debug');

  progress('创建图形设备', 0.18);
  setQuality(params.get('q'));
  const loadStart = performance.now();
  /** Milliseconds spent in each loading stage (shown by `__game.state()`, used for the performance record). */
  const loadTimings: Record<string, number> = {};
  let stageStart = loadStart;
  const stageDone = (name: string): void => {
    const now = performance.now();
    loadTimings[name] = Math.round(now - stageStart);
    stageStart = now;
  };
  const { app, device } = await createApp(opts.canvas, params.get('device'), QUALITY.pixelRatio);
  reloadOnDeviceRestore(device);
  stageDone('device');
  setupLayers(app);

  progress('生成赛道', 0.3);
  await nextFrame();
  const track = buildTrack(TRACK);
  const session = new Session(track);
  const sky = createSky(app, { dynamic: params.get('sky') !== 'static' });
  const trackVisual = createTrackVisual(app, track);
  stageDone('track+sky');

  progress('生成地形', 0.5);
  await nextFrame();
  createTerrain(app, track);
  const world = createWorld(app, track);
  stageDone('world');

  progress('装载车辆', 0.72);
  const carAsset = await loadContainer(app, 'huracan-sto', `${import.meta.env.BASE_URL}assets/models/huracan-sto.glb`);
  const carVisual = new CarVisual(app, carAsset);
  stageDone('car');
  const camera = new ChaseCamera(app);
  camera.reset(session.car, track);

  const hud = new Hud(opts.hud);
  const audio = createAudio();
  const bests = loadBests();
  const stepper = new FixedStepper();
  const input: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
  const tyres = new TyreFx(app, carVisual.rearWheels);
  /** Visual systems updated once per frame with the shared frame snapshot, in this order. */
  const post = createPost(app, camera.entity, sky);
  const carFx = createCarFx(app, carVisual);
  const lensFx = createLensEffects(app, post);
  // Order matters: the lens effects set inputs that the post stack applies in its own update.
  const systems: FrameSystem[] = [new PickupsVisual(app, track, session.pickups), carFx];
  if (lensFx) systems.push(lensFx);
  systems.push(world, post, audio);
  const reflection = createRoadReflection(app, camera.entity, trackVisual.wetRoad.material);
  if (reflection) systems.push(reflection);
  let clock = 0;
  const frame: FrameState = {
    dt: 0, time: 0, track, car: session.car, input, x: 0, y: 0, z: 0, yaw: 0,
    speedRatio: 0, boost: 0, surge: 0, screech: 0, tunnel: 0, camera: camera.entity,
  };
  // ---- shader warm-up ----
  // The engine compiles a shader the first time something needs it, which stalls the frame (up to 0.4 s on
  // WebGL2 for the first nitro flame). So before the loading screen lifts, a few frames are rendered with
  // every effect forced on: an aerial view that has the whole circuit in frame, then the chase view with
  // boost, sparks, smoke and spray, then the same inside the gallery (neon, headlamps).
  const WARM_FRAMES = 12;
  let warmLeft = params.has('nowarm') ? 0 : WARM_FRAMES;
  let warmDone: (() => void) | null = null;
  /** Stand-in car state shown to the effects while warming up: fast, sliding, boosting, scraping a wall. */
  const warmCar = { ...session.car };
  // While warming up no camera culls: every material in the scene gets drawn (and so compiled) at least once,
  // including the ones that would otherwise first come into view half a lap later.
  const culledCameras = warmLeft > 0 ? app.root.findComponents('camera').filter((c) => (c as pc.CameraComponent).frustumCulling) as pc.CameraComponent[] : [];
  for (const c of culledCameras) c.frustumCulling = false;
  const endWarmUp = (): void => {
    warmLeft = 0;
    for (const c of culledCameras) c.frustumCulling = true;
    carFx.boostOverride = null;
    carFx.surgeOverride = null;
    reset();
  };
  /** HUD refresh period, seconds, and time since the last refresh. */
  const HUD_INTERVAL = 1 / 30;
  let hudClock = HUD_INTERVAL;
  /** Seconds until the next sweep that frees texture sources the GPU already holds. */
  let sourceSweep = 2;
  /** Who drives: the player, the centre-line autopilot (verification), or the drift demo. */
  let mode: 'manual' | 'autopilot' | 'demo' = params.has('demo') ? 'demo' : params.has('autopilot') ? 'autopilot' : 'manual';
  const driftCorners = findCorners(track).filter((c) => c.radius <= BOT.driftMaxRadius && c.angle >= BOT.driftMinAngle);
  let bot = new DriftBot(track);
  /** Drifts started and links made by the player this session (drives the coaching prompts). */
  let driftCount = 0;
  let linkCount = 0;
  let wasDrifting = false;
  let boostCount = 0;
  let wasBoosting = false;
  /** True once the autopilot or the demo has driven any part of the current lap: such laps set no records. */
  let assistedLap = mode !== 'manual';
  let cameraMode: CameraMode = (params.get('cam') as CameraMode | null) ?? 'chase';
  let cameraS = Number(params.get('s') ?? TRACK.finishS + 40);
  const orbit = { az: Number(params.get('az') ?? 60), dist: Number(params.get('dist') ?? 6), height: Number(params.get('h') ?? 1.4) };
  let scoreSeen = 0;
  let pickupSeen = 0;
  let lapSeen = 0;
  let fps = 60;
  /** When set, the frame loop does not advance the simulation (tests drive it through `__game.step`). */
  let frozen = false;

  const reset = (): void => {
    session.reset();
    stepper.reset();
    scoreSeen = 0;
    pickupSeen = 0;
    lapSeen = 0;
    camera.reset(session.car, track);
    bot = new DriftBot(track);
    tyres.breakTrails();
  };
  let paused = false;
  let muted = false;
  /** Driving shortcuts do nothing while the pause screen is up. */
  const whenRunning = (fn: () => void) => (): void => {
    if (!paused) fn();
  };
  const inputs = new InputManager({
    KeyR: whenRunning(reset),
    KeyP: whenRunning(() => {
      mode = mode === 'autopilot' ? 'manual' : 'autopilot';
    }),
    KeyO: whenRunning(() => {
      mode = mode === 'demo' ? 'manual' : 'demo';
      bot = new DriftBot(track);
    }),
    // Gamepad Start, the touch pause button, and a phone turned to portrait.
    pause: () => opts.onPauseRequest?.(),
    menuUp: () => opts.onMenuNavigate?.(-1),
    menuDown: () => opts.onMenuNavigate?.(1),
    menuAccept: () => opts.onMenuAccept?.(),
  });

  // Pose before the latest step, for render interpolation.
  const prev = { x: session.car.x, y: session.car.y, z: session.car.z, yaw: session.car.yaw };
  /** See `coDrive` on the debug handle. */
  let coDriver: ((wanted: CarInput, car: Readonly<typeof session.car>) => void) | null = null;
  const coInput: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
  const stepOnce = (): void => {
    const car = session.car;
    prev.x = car.x;
    prev.y = car.y;
    prev.z = car.z;
    prev.yaw = car.yaw;
    if (mode === 'autopilot') autopilotInput(car, track, input);
    else if (mode === 'demo') bot.update(car, input, SIM_DT);
    else {
      if (coDriver) {
        // Verification only: the bot says what it would press; the test harness turns that into real
        // keyboard, gamepad or touch events, and the car is still driven by what the devices report.
        bot.update(car, coInput, SIM_DT);
        coDriver(coInput, car);
      }
      inputs.read(input);
    }
    session.step(input);
    if (car.hit > CAR.crashSpeed) camera.hit(car.hit);
    if (car.hit > 0) carFx.impact(car.hit);
    if (car.hit > 0) audio.impact(car.hit);
    if (car.hit > 0 && mode === 'manual') inputs.rumble(car.hit / INPUT.pad.rumbleFullHit);
    if (mode !== 'manual') assistedLap = true;
    if (car.drift && !wasDrifting && mode === 'manual') driftCount++;
    wasDrifting = car.drift;
    if (car.boost && !wasBoosting && mode === 'manual') boostCount++;
    wasBoosting = car.boost;
  };

  /** The drift corner ahead and the speed to enter it at; null on straights far from any corner. */
  const paceNote = (): PaceNote | null => {
    const car = session.car;
    let best: PaceNote | null = null;
    for (const c of driftCorners) {
      if (arcDelta(track, c.s1, car.loc.s) < 0) continue;
      const dist = arcDelta(track, c.s0, car.loc.s);
      if (dist <= 0 || dist > 330 || (best && dist >= best.dist)) continue;
      // Speed at which holding full lock just carves this corner.
      const rec = driftSpeedFor(c.radius * 0.92);
      const v = Math.hypot(car.vx, car.vz);
      const decel = (v * v - rec * rec) / (2 * dist);
      const flat = rec > CAR.topSpeed * 0.8;
      best = {
        dir: c.dir,
        kmh: flat ? null : Math.round(rec / KMH / 5) * 5,
        dist,
        state: flat || v <= rec + 1.5 ? 'ok' : decel > CAR.brakeDecel * 0.55 ? 'brake' : decel > CAR.brakeDecel * 0.2 ? 'warn' : 'ok',
      };
    }
    return best;
  };

  /** Teaches the technique one step at a time; each prompt stops once the player has done it a few times. */
  const coachPrompt = (note: PaceNote | null): string => {
    const T = COACH_TEXT[inputs.device];
    if (mode === 'demo') return T.demo;
    if (mode !== 'manual' || !inputs.touched) return '';
    const car = session.car;
    if (car.drift && driftCount <= 4) return T.hold;
    if (!car.drift && session.score.active && linkCount < 2) return T.link;
    if (note && note.state === 'brake' && driftCount <= 8) return T.brake;
    if (car.nitro > 0.99 && !car.boost && boostCount < 2 && (!note || note.kmh === null)) return T.nitro;
    if (note && note.kmh !== null && note.dist < 150 && driftCount < 3) return T.entry(note.dir);
    return '';
  };

  const flushEvents = (): void => {
    const picks = session.pickups.events;
    for (; pickupSeen < picks.length; pickupSeen++) {
      hud.onPickup(picks[pickupSeen]);
      audio.onPickup(picks[pickupSeen]);
    }
    const score = session.score.events;
    for (; scoreSeen < score.length; scoreSeen++) {
      const e = score[scoreSeen];
      hud.onScore(e);
      audio.onScore(e);
      if (e.type === 'link' && mode === 'manual') linkCount++;
      if (e.type === 'banked' && mode === 'manual' && e.points > bests.chain) {
        bests.chain = e.points;
        saveBests(bests);
      }
    }
    const laps = session.laps.events;
    for (; lapSeen < laps.length; lapSeen++) {
      const e = laps[lapSeen];
      // "BEST" on the HUD means an all-time best, which includes earlier sessions.
      const best = !assistedLap && (bests.lap === null || e.time < bests.lap);
      assistedLap = mode !== 'manual';
      if (best) {
        bests.lap = e.time;
        saveBests(bests);
      }
      const lapEvent = { ...e, best };
      hud.onLap(lapEvent);
      audio.onLap(lapEvent);
    }
  };

  let panel: import('./debug/panel').DebugPanel | null = null;
  if (debug) {
    const { DebugPanel } = await import('./debug/panel');
    panel = new DebugPanel({
      '重置 (R)': reset,
      '自动驾驶 (P)': () => {
        mode = mode === 'autopilot' ? 'manual' : 'autopilot';
      },
      '漂移演示 (O)': () => {
        mode = mode === 'demo' ? 'manual' : 'demo';
        bot = new DriftBot(track);
      },
    });
    try {
      new pc.MiniStats(app);
    } catch (err) {
      console.warn('mini-stats unavailable', err);
    }
  }

  app.on('update', (dt: number) => {
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;
    inputs.setSpeed(Math.hypot(session.car.vx, session.car.vz));
    if (!frozen && !paused && warmLeft === 0) {
      const steps = stepper.advance(dt);
      for (let k = 0; k < steps; k++) stepOnce();
    }
    flushEvents();

    const car = session.car;
    const a = frozen ? 1 : stepper.alpha;
    const x = prev.x + (car.x - prev.x) * a;
    const y = prev.y + (car.y - prev.y) * a;
    const z = prev.z + (car.z - prev.z) * a;
    const yaw = prev.yaw + wrapAngle(car.yaw - prev.yaw) * a;

    const warming = warmLeft > 0;
    let fxCar = car;
    if (warming) {
      if (warmLeft === WARM_FRAMES - 4) carFx.impact(20);
      if (warmLeft === 4 && world.gallery) {
        // Last phase: the same effects inside the gallery.
        session.place((world.gallery.s0 + world.gallery.s1) / 2, 0, 0);
        camera.reset(session.car, track, false);
      }
      fxCar = Object.assign(warmCar, session.car, {
        speed: 40, vx: -Math.sin(session.car.yaw) * 40, vz: -Math.cos(session.car.yaw) * 40,
        slip: 0.4, drift: true, beta: 0.5, scrape: 1, wallSide: 1, boost: true, surge: 1, onKerb: true,
      });
      carFx.boostOverride = 1;
      carFx.surgeOverride = 1;
    }

    carVisual.update(car, input, track, x, y, z, yaw, dt);
    camera.update(car, track, x, y, z, dt);
    if (warming && warmLeft > WARM_FRAMES - 4) poseAerial(camera.entity, track);
    else if (cameraMode === 'aerial') poseAerial(camera.entity, track);
    else if (cameraMode === 'trackside') poseTrackside(camera.entity, track, cameraS, x, y + 0.6, z);
    else if (cameraMode === 'orbit') poseOrbit(camera.entity, x, y, z, yaw, orbit.az, orbit.dist, orbit.height);
    // The aerial view looks through 2 km of air: fog would hide the circuit.
    app.scene.fog.density = cameraMode === 'aerial' ? 0 : RENDER.fogDensity;
    tyres.update(fxCar, input, track, x, z, yaw);
    trackVisual.wetRoad.update(clock);
    clock += dt;
    // One snapshot object, refilled every frame (no per-frame garbage).
    frame.dt = dt;
    frame.time = clock;
    frame.car = fxCar;
    frame.x = x;
    frame.y = y;
    frame.z = z;
    frame.yaw = yaw;
    frame.speedRatio = Math.min(1, Math.sqrt(car.vx * car.vx + car.vz * car.vz) / CAMERA.speedNorm);
    frame.boost = camera.boost;
    frame.surge = car.surge;
    frame.screech = tyres.screech;
    frame.tunnel = world.tunnelFactor(car.loc.s);
    if (warming) {
      frame.speedRatio = 1;
      frame.boost = 1;
      frame.surge = 1;
      frame.tunnel = 1;
    }
    // The warm-up shows the effects a fake boosting, scraping car: keep that out of the speakers.
    for (const system of systems) if (!(warming && system === audio)) system.update(frame);
    if (warming && --warmLeft === 0) {
      endWarmUp();
      warmDone?.();
    }
    sourceSweep -= dt;
    if (sourceSweep <= 0) {
      sourceSweep = 2;
      releaseUploadedTextureSources(device);
    }
    // The HUD is text: 30 updates a second read the same as 120 and cost a quarter of the DOM work.
    hudClock += dt;
    if (hudClock >= HUD_INTERVAL) {
      hud.update(session, bests, mode, inputs.touched, hudClock);
      const note = car.drift ? null : paceNote();
      hud.setPace(mode === 'autopilot' ? null : note);
      hud.setCoach(coachPrompt(note));
      hud.setKeys(mode === 'demo' ? input : null);
      hudClock = 0;
    }

    if (panel) {
      panel.setReadout(
        `${device.isWebGPU ? 'WebGPU' : 'WebGL2'}  ${fps.toFixed(0)} fps  ${app.stats.drawCalls.total} draws\n` +
          `v ${(car.speed / KMH).toFixed(0)} km/h  s ${car.loc.s.toFixed(0)}  d ${car.loc.d.toFixed(2)}\n` +
          `drift ${car.drift ? (car.way > 0 ? 'L' : 'R') : '-'}  β ${(car.beta / DEG).toFixed(1)}°  bend ${car.bend.toFixed(2)}  lull ${car.lull.toFixed(2)}\n` +
          `slip ${(car.slip / DEG).toFixed(1)}°  yawRate ${(car.yawRate / DEG).toFixed(0)}°/s  hit ${car.hit.toFixed(1)}`,
      );
    }
  });

  // Debug handle for browser tests and the console. Not a stable API.
  const handle = {
    app,
    session,
    track,
    carFx,
    post,
    inputs,
    /** The per-frame visual systems, in update order (for profiling). */
    systems,
    audio: audio.debug,
    config: { CAR, DRIFT, SCORING, CAMERA, RENDER, TRACK },
    /** A flat snapshot of what the acceptance checks read. */
    state: () => {
      const { car, score, laps } = session;
      return {
        device: device.isWebGPU ? 'webgpu' : 'webgl2',
        fps: Math.round(fps),
        drawCalls: app.stats.drawCalls.total,
        time: +session.time.toFixed(3),
        kmh: +(car.speed / KMH).toFixed(1),
        paceKmh: +(Math.hypot(car.vx, car.vz) / KMH).toFixed(1),
        s: +car.loc.s.toFixed(1),
        d: +car.loc.d.toFixed(2),
        gear: car.gear,
        rpm: +car.rpm.toFixed(2),
        drift: car.drift,
        way: car.way,
        betaDeg: +(car.beta / DEG).toFixed(1),
        nitro: +car.nitro.toFixed(3),
        boost: car.boost,
        surge: +car.surge.toFixed(2),
        chain: +score.chain.toFixed(1),
        mult: score.mult,
        chainActive: score.active,
        total: score.total,
        lapPoints: score.lapPoints,
        laps: laps.count,
        lapTime: +laps.time.toFixed(3),
        lastLap: laps.last,
        bestLap: bests.lap,
        mode,
        driftCount,
        screech: +tyres.screech.toFixed(2),
        cameraMode,
        loadTimings,
        trackEntities: trackVisual.entityCount,
        carMeshes: carVisual.meshCount,
      };
    },
    reset,
    setAutopilot: (on: boolean) => {
      mode = on ? 'autopilot' : 'manual';
    },
    /** The keyboard-style drift driver (what the O key starts). */
    setDemo: (on: boolean) => {
      mode = on ? 'demo' : 'manual';
      bot = new DriftBot(track);
    },
    /** Verification: in manual mode, call `fn` every simulation step with the inputs the drift bot would
     *  give. The caller presses real keys / pad buttons / touch points to match (null to stop). */
    coDrive: (fn: typeof coDriver) => {
      coDriver = fn;
      bot = new DriftBot(track);
    },
    /** Put the car at arc length `s`, lateral offset `d`, speed in km/h. */
    teleport: (s: number, d = 0, kmh = 0) => {
      session.place(s, d, kmh * KMH);
      stepper.reset();
      scoreSeen = 0;
      pickupSeen = 0;
      lapSeen = 0;
      camera.reset(session.car, track, false);
      bot = new DriftBot(track);
      tyres.breakTrails();
    },
    /** `s` places the trackside camera; `az`/`dist`/`height` place the orbit camera. */
    setCamera: (mode: CameraMode, o: { s?: number; az?: number; dist?: number; height?: number } = {}) => {
      cameraMode = mode;
      if (o.s !== undefined) cameraS = o.s;
      Object.assign(orbit, { az: o.az ?? orbit.az, dist: o.dist ?? orbit.dist, height: o.height ?? orbit.height });
    },
    /** Stop the frame loop from advancing the simulation; use `step` to drive it deterministically. */
    freeze: (on: boolean) => {
      frozen = on;
      stepper.reset();
    },
    /** Run `n` fixed steps with the given input held (works best with `freeze(true)`). */
    step: (n: number, held: Partial<CarInput> = {}) => {
      const was = mode;
      mode = 'manual';
      const saved = inputs.read.bind(inputs);
      inputs.read = (out: CarInput) => Object.assign(out, { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false }, held);
      for (let k = 0; k < n; k++) stepOnce();
      inputs.read = saved;
      mode = was;
    },
  };
  (window as unknown as { __game: typeof handle }).__game = handle;

  stageDone('systems');
  progress('预热着色器', 0.95);
  app.start();
  if (warmLeft > 0) {
    // Frames only render while the page is visible; do not hold the loading screen forever if it is not.
    await Promise.race([new Promise<void>((r) => (warmDone = r)), new Promise<void>((r) => setTimeout(r, 4000))]);
    if (warmLeft > 0) endWarmUp();
  }
  stageDone('warm-up');
  loadTimings.total = Math.round(performance.now() - loadStart);
  progress('就绪', 1);
  hud.show();
  opts.canvas.focus();

  return {
    pause(): void {
      if (paused) return;
      paused = true;
      // Time stops for everything driven by dt: particles, ripples, camera smoothing.
      app.timeScale = 0;
      inputs.setActive(false);
      audio.setPaused(true);
    },
    resume(): void {
      if (!paused) return;
      paused = false;
      app.timeScale = 1;
      stepper.reset();
      inputs.setActive(true);
      audio.setPaused(false);
    },
    get paused(): boolean {
      return paused;
    },
    restart: reset,
    setMuted(value: boolean): void {
      muted = value;
      audio.setMuted(value);
    },
    get muted(): boolean {
      return muted;
    },
  };
}
