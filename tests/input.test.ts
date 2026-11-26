// Input devices: gamepad response, touch steering maths, device merging (drift-gameplay.md §5).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INPUT } from '../src/config/input';
import { DEG, KMH } from '../src/core/math';
import { GamepadReader } from '../src/input/gamepad';
import { Keyboard } from '../src/input/keyboard';
import { followAnchor, hitButton, mergeInputs, stickSteer, touchTravelScale, triggerPedal, wheelAngle } from '../src/input/logic';
import { InputManager } from '../src/input/manager';
import type { CarInput } from '../src/vehicle/car';

const input = (o: Partial<CarInput> = {}): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, ...o });

afterEach(() => vi.unstubAllGlobals());

describe('gamepad stick and triggers', () => {
  it('ignores the stick inside the dead zone and starts from zero just outside it', () => {
    expect(INPUT.pad.deadZone).toBe(0.12);
    expect(stickSteer(0)).toBe(0);
    expect(stickSteer(0.12)).toBe(0);
    expect(stickSteer(-0.119)).toBe(0);
    expect(stickSteer(0.13)).toBeGreaterThan(0);
    expect(stickSteer(0.13)).toBeLessThan(0.01); // no jump at the edge of the dead zone
    expect(stickSteer(NaN)).toBe(0);
  });

  it('reaches full lock at full deflection, is odd, and never decreases', () => {
    expect(stickSteer(1)).toBe(1);
    expect(stickSteer(-1)).toBe(-1);
    expect(stickSteer(1.3)).toBe(1); // out-of-range axes stay clamped
    let last = -1;
    for (let a = -1; a <= 1.0001; a += 0.01) {
      const s = stickSteer(a);
      expect(s).toBeGreaterThanOrEqual(last);
      expect(s).toBeCloseTo(-stickSteer(-a), 12);
      last = s;
    }
  });

  it('has a gentle curve: finer than linear around the centre', () => {
    const linear = (0.5 - 0.12) / (1 - 0.12);
    expect(stickSteer(0.5)).toBeLessThan(linear);
    expect(stickSteer(0.5)).toBeGreaterThan(linear * 0.6);
    // Drift entry needs |steer| > 0.3 (DRIFT entry rule): half deflection must still be enough.
    expect(stickSteer(0.5)).toBeGreaterThan(0.3);
    expect(stickSteer(0.5, 0.12, 1)).toBeCloseTo(linear, 12);
  });

  it('maps triggers linearly past a small rest dead zone', () => {
    expect(triggerPedal(0)).toBe(0);
    expect(triggerPedal(INPUT.pad.triggerDeadZone)).toBe(0);
    expect(triggerPedal(1)).toBe(1);
    expect(triggerPedal(0.525)).toBeCloseTo(0.5, 6);
  });
});

describe('touch steering', () => {
  const T = INPUT.touch;
  const travel = 80;

  it('turns the wheel with sideways thumb travel, right = positive, up to ±90°', () => {
    expect(T.wheelMaxAngle).toBeCloseTo(90 * DEG, 12);
    expect(wheelAngle(200, 200, travel)).toBe(0);
    expect(wheelAngle(200, 200 + travel * T.deadZone * 0.9, travel)).toBe(0); // resting thumb
    expect(wheelAngle(200, 240, travel)).toBeGreaterThan(0);
    expect(wheelAngle(200, 160, travel)).toBeCloseTo(-wheelAngle(200, 240, travel), 12);
    expect(wheelAngle(200, 280, travel)).toBeCloseTo(90 * DEG, 12);
    expect(wheelAngle(200, 500, travel)).toBeCloseTo(90 * DEG, 12);
    expect(wheelAngle(200, -500, travel)).toBeCloseTo(-90 * DEG, 12);
  });

  it('is proportional between the dead zone and full lock', () => {
    const half = 200 + travel * (T.deadZone + (1 - T.deadZone) / 2);
    expect(wheelAngle(200, half, travel)).toBeCloseTo(45 * DEG, 9);
    let last = -Infinity;
    for (let x = 100; x <= 300; x += 2) {
      const a = wheelAngle(200, x, travel);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
  });

  it('gets less sensitive as speed rises, but full lock stays reachable', () => {
    expect(touchTravelScale(0)).toBe(1);
    expect(touchTravelScale(80 * KMH)).toBeCloseTo(1, 12);
    expect(touchTravelScale(160 * KMH)).toBeCloseTo(1 + (T.travelScaleFast - 1) / 2, 9);
    expect(touchTravelScale(240 * KMH)).toBeCloseTo(T.travelScaleFast, 12);
    expect(touchTravelScale(400 * KMH)).toBeCloseTo(T.travelScaleFast, 12);
    expect(touchTravelScale(-30)).toBe(touchTravelScale(30)); // reversing counts as speed too
    expect(T.travelScaleFast).toBeGreaterThan(1);

    // The same thumb offset steers less at 250 km/h than at 60 km/h …
    const steerAt = (kmh: number, dx: number): number => wheelAngle(0, dx, travel * touchTravelScale(kmh * KMH)) / T.wheelMaxAngle;
    expect(steerAt(250, 50)).toBeLessThan(steerAt(60, 50));
    let last = Infinity;
    for (let kmh = 0; kmh <= 320; kmh += 20) {
      const s = steerAt(kmh, 50);
      expect(s).toBeLessThanOrEqual(last);
      last = s;
    }
    // … and pushing further still gives full lock.
    expect(steerAt(250, travel * T.travelScaleFast)).toBeCloseTo(1, 12);
  });

  it('drags the wheel centre along when the thumb overshoots, so unwinding starts at once', () => {
    expect(followAnchor(200, 250, travel)).toBe(200);
    expect(followAnchor(200, 280, travel)).toBe(200);
    expect(followAnchor(200, 330, travel)).toBe(250);
    expect(followAnchor(200, 60, travel)).toBe(140);
    // Thumb pushed 50 px past full lock, then pulled back 20 px: the wheel has already left full lock.
    const anchor = followAnchor(200, 330, travel);
    expect(wheelAngle(anchor, 330, travel)).toBeCloseTo(90 * DEG, 12);
    expect(wheelAngle(anchor, 310, travel)).toBeLessThan(90 * DEG);
    expect(wheelAngle(200, 310, travel)).toBeCloseTo(90 * DEG, 12); // a fixed centre would still be pinned
  });
});

describe('touch buttons', () => {
  const brake = { x: 100, y: 300, r: 35 };
  const nitro = { x: 220, y: 180, r: 40 };
  const drift = { x: 220, y: 300, r: 55 };
  const buttons = [brake, nitro, drift];

  it('finds the button under a finger, with a margin around it', () => {
    expect(hitButton(220, 300, buttons, 14)).toBe(2);
    expect(hitButton(100, 300, buttons, 14)).toBe(0);
    expect(hitButton(100 - 35 - 13, 300, buttons, 14)).toBe(0); // inside the margin
    expect(hitButton(100 - 35 - 15, 300, buttons, 14)).toBe(-1); // just outside: sliding off releases
    expect(hitButton(20, 20, buttons, 14)).toBe(-1);
  });

  it('gives a finger between two buttons to the one whose edge is nearer', () => {
    // Between nitro (bottom edge at y = 220) and drift (top edge at y = 245).
    expect(hitButton(220, 226, buttons, 14)).toBe(1);
    expect(hitButton(220, 240, buttons, 14)).toBe(2);
  });

  it('never matches buttons that have not been measured yet', () => {
    const unmeasured = [{ x: 0, y: 0, r: 0 }];
    expect(hitButton(300, 200, unmeasured, 14)).toBe(-1);
  });
});

describe('merging devices', () => {
  it('adds steering (clamped), takes the larger pedal, ORs the buttons', () => {
    const out = input();
    const keys = input({ steer: -1, throttle: 1 });
    const pad = input({ steer: 0.4, throttle: 0.3, brake: 0.6, nitro: true });
    const touch = input({ handbrake: true });
    expect(mergeInputs(out, keys, pad, touch)).toBe(out); // written in place
    expect(out.steer).toBeCloseTo(-0.6, 12);
    expect(out).toMatchObject({ throttle: 1, brake: 0.6, handbrake: true, nitro: true });

    mergeInputs(out, input({ steer: 1 }), input({ steer: 0.8 }), input({ steer: 0.5 }));
    expect(out.steer).toBe(1);
    mergeInputs(out, input(), input(), input());
    expect(out).toEqual(input());
  });

  it('keeps the result a plain CarInput whatever the devices hold', () => {
    const out = mergeInputs(input(), input({ steer: 1, throttle: 1, brake: 1 }), input({ steer: -1 }), input({ brake: 0.2 }));
    expect(Object.keys(out).sort()).toEqual(['brake', 'handbrake', 'nitro', 'steer', 'throttle']);
    expect(out).toEqual({ steer: 0, throttle: 1, brake: 1, handbrake: false, nitro: false });
  });
});

describe('gamepad reader', () => {
  const B = INPUT.pad.buttons;
  interface FakePad {
    connected: boolean;
    mapping: string;
    axes: number[];
    buttons: { value: number; pressed: boolean; touched: boolean }[];
    vibrationActuator?: unknown;
  }
  const makePad = (o: { axis?: number; buttons?: Record<number, number>; mapping?: string; connected?: boolean } = {}): FakePad => ({
    connected: o.connected ?? true,
    mapping: o.mapping ?? 'standard',
    axes: [o.axis ?? 0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => {
      const value = o.buttons?.[i] ?? 0;
      return { value, pressed: value > 0.5, touched: value > 0 };
    }),
  });
  /** Stub navigator.getGamepads with a list that the test can replace. */
  const plug = (...initial: (FakePad | null)[]): { pads: (FakePad | null)[] } => {
    const slot = { pads: initial };
    vi.stubGlobal('navigator', { getGamepads: () => slot.pads });
    return slot;
  };

  it('reads the standard mapping: stick, analog triggers, X = drift, A = nitro', () => {
    const slot = plug(makePad({ axis: 1, buttons: { [B.throttle]: 1, [B.drift]: 1 } }));
    const reader = new GamepadReader();
    reader.wake();
    reader.poll();
    expect(reader.present).toBe(true);
    expect(reader.state).toEqual({ steer: 1, throttle: 1, brake: 0, handbrake: true, nitro: false });

    slot.pads = [makePad({ axis: -0.5, buttons: { [B.throttle]: 0.525, [B.brake]: 1, [B.nitro]: 1 } })];
    reader.poll();
    expect(reader.state.steer).toBeCloseTo(stickSteer(-0.5), 12);
    expect(reader.state.steer).toBeLessThan(0); // stick left = steer left
    expect(reader.state.throttle).toBeCloseTo(0.5, 6);
    expect(reader.state).toMatchObject({ brake: 1, handbrake: false, nitro: true });

    slot.pads = [makePad({ axis: 0.05 })];
    reader.poll();
    expect(reader.state).toEqual(input());
  });

  it('treats a trigger that only reports pressed/not pressed as fully down', () => {
    const pad = makePad();
    pad.buttons[B.throttle] = { value: 0, pressed: true, touched: true };
    plug(pad);
    const reader = new GamepadReader();
    reader.poll();
    expect(reader.state.throttle).toBe(1);
  });

  it('ignores pads without the standard mapping, empty slots and disconnected pads', () => {
    const held = { axis: 1, buttons: { [B.throttle]: 1, [B.drift]: 1, [B.start]: 1 } };
    let pauses = 0;
    plug(null, makePad({ ...held, mapping: '' }), makePad({ ...held, connected: false }));
    const reader = new GamepadReader({ pause: () => pauses++ });
    reader.wake();
    expect(reader.poll()).toBe(false);
    expect(reader.state).toEqual(input());
    expect(pauses).toBe(0);
    expect(reader.present).toBe(false); // nothing usable: the manager stops polling until the next connect
  });

  it('merges several standard pads', () => {
    plug(makePad({ axis: 1 }), makePad({ buttons: { [B.throttle]: 1, [B.nitro]: 1 } }));
    const reader = new GamepadReader();
    reader.poll();
    expect(reader.state).toEqual({ steer: 1, throttle: 1, brake: 0, handbrake: false, nitro: true });
  });

  it('fires pause once per Start press and reset once per Y or Select press', () => {
    let pauses = 0;
    let resets = 0;
    const slot = plug(makePad());
    const reader = new GamepadReader({ pause: () => pauses++, reset: () => resets++ });
    reader.poll();
    slot.pads = [makePad({ buttons: { [B.start]: 1 } })];
    reader.poll();
    reader.poll();
    reader.poll();
    expect(pauses).toBe(1);
    slot.pads = [makePad()];
    reader.poll();
    slot.pads = [makePad({ buttons: { [B.start]: 1 } })];
    reader.poll();
    expect(pauses).toBe(2);

    slot.pads = [makePad({ buttons: { [B.reset]: 1 } })];
    reader.poll();
    reader.poll();
    expect(resets).toBe(1);
    slot.pads = [makePad()];
    reader.poll();
    slot.pads = [makePad({ buttons: { [B.select]: 1 } })];
    reader.poll();
    expect(resets).toBe(2);
    expect(pauses).toBe(2);
  });

  it('reports the moment the player starts using the pad, not stick noise', () => {
    const slot = plug(makePad({ axis: 0.2 }));
    const reader = new GamepadReader();
    expect(reader.poll()).toBe(false); // a drifting stick does not take over from the keyboard
    slot.pads = [makePad({ axis: 0.8 })];
    expect(reader.poll()).toBe(true);
    expect(reader.poll()).toBe(false); // only on the rising edge
    slot.pads = [makePad()];
    expect(reader.poll()).toBe(false);
    slot.pads = [makePad({ buttons: { [B.nitro]: 1 } })];
    expect(reader.poll()).toBe(true);
  });

  it('goes neutral when the pad is unplugged, and survives a browser without the Gamepad API', () => {
    const slot = plug(makePad({ axis: 1, buttons: { [B.throttle]: 1 } }));
    const reader = new GamepadReader();
    reader.poll();
    expect(reader.state.throttle).toBe(1);
    slot.pads = [null];
    reader.poll();
    expect(reader.state).toEqual(input());
    expect(reader.present).toBe(false);

    vi.stubGlobal('navigator', {
      getGamepads: () => {
        throw new Error('SecurityError');
      },
    });
    reader.wake();
    expect(reader.poll()).toBe(false);
    expect(reader.present).toBe(false);
    vi.stubGlobal('navigator', {});
    reader.wake();
    expect(reader.poll()).toBe(false);
  });

  it('rumbles the pad in use, one effect at a time, and only where haptics exist', () => {
    const calls: { type: string; strong: number; duration: number }[] = [];
    const pad = makePad({ buttons: { [B.throttle]: 1 } });
    pad.vibrationActuator = {
      playEffect: (type: string, p: { duration: number; strongMagnitude: number }) => {
        calls.push({ type, strong: p.strongMagnitude, duration: p.duration });
        return Promise.resolve('complete');
      },
    };
    const bare = makePad({ buttons: { [B.throttle]: 1 } });
    const slot = plug(bare);
    const clock = { now: 5000 };
    vi.stubGlobal('performance', { now: () => clock.now });
    const reader = new GamepadReader();
    reader.rumble(1, 100); // before any poll: no pad known
    reader.poll();
    reader.rumble(1, 100); // this pad has no actuator
    expect(calls).toEqual([]);

    slot.pads = [pad];
    reader.poll();
    reader.rumble(INPUT.pad.rumbleMin / 2, 100); // too weak to bother
    expect(calls).toEqual([]);
    reader.rumble(3, 100);
    clock.now += 60;
    reader.rumble(0.5, 100); // the first effect is still playing
    expect(calls).toEqual([{ type: 'dual-rumble', strong: 1, duration: 100 }]);
    clock.now += 60;
    reader.rumble(0.5, 100);
    expect(calls.length).toBe(2);
    expect(calls[1].strong).toBe(0.5);
  });
});

describe('keyboard', () => {
  it('reports each handled key press, skips missing actions, and forgets held keys on clear', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal('window', { addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h) });
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    let uses = 0;
    let mutes = 0;
    const kb = new Keyboard({ KeyM: () => mutes++, KeyR: undefined, pause: () => undefined }, () => uses++);
    const down = (code: string): boolean => {
      let prevented = false;
      handlers.keydown({ code, metaKey: false, ctrlKey: false, repeat: false, target: null, preventDefault: () => (prevented = true) });
      return prevented;
    };
    expect(down('KeyM')).toBe(true);
    expect(mutes).toBe(1);
    expect(down('KeyR')).toBe(false); // no action bound: the key is left to the browser
    expect(down('KeyQ')).toBe(false);
    expect(uses).toBe(1);
    expect(kb.touched).toBe(false); // an action key is not driving

    down('ArrowRight');
    down('ArrowUp');
    expect(uses).toBe(3);
    expect(kb.touched).toBe(true);
    const out = input();
    expect(kb.read(out)).toEqual({ steer: 1, throttle: 1, brake: 0, handbrake: false, nitro: false });
    kb.clear();
    expect(kb.read(out)).toEqual(input());
  });
});

// The manager and the touch controls need a page. This is the smallest stand-in that lets their event
// handling run headless: elements with a class list and a rectangle, a window that records listeners.
describe('input manager on a fake page', () => {
  class FakeNode {}
  class FakeElement extends FakeNode {
    id = '';
    innerHTML = '';
    rect = { left: 0, top: 0, width: 0, height: 0 };
    readonly classes = new Set<string>();
    readonly kids = new Map<string, FakeElement>();
    readonly style = { transform: '', setProperty: (): void => undefined };
    readonly classList = {
      add: (c: string): void => void this.classes.add(c),
      remove: (c: string): void => void this.classes.delete(c),
      toggle: (c: string, on: boolean): void => void (on ? this.classes.add(c) : this.classes.delete(c)),
    };
    querySelector(sel: string): FakeElement {
      if (!this.kids.has(sel)) this.kids.set(sel, new FakeElement());
      return this.kids.get(sel)!;
    }
    contains(node: unknown): boolean {
      return node === this || [...this.kids.values()].some((k) => k.contains(node));
    }
    appendChild(el: FakeElement): void {
      this.kids.set(`#${el.id}`, el);
    }
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
      return this.rect;
    }
  }
  class FakeCanvas extends FakeElement {}

  /** A 800 × 400 landscape page. Buttons sit where touch.css would put them at that size. */
  const page = (o: { coarse?: boolean } = {}) => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const frames: (() => void)[] = [];
    const html = new FakeElement();
    const body = new FakeElement();
    const canvas = new FakeCanvas();
    const portrait = { matches: false, change: (): void => undefined };
    const clock = { now: 1000 };
    vi.stubGlobal('Node', FakeNode);
    vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('document', { documentElement: html, body, createElement: () => new FakeElement() });
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => frames.push(f));
    vi.stubGlobal('performance', { now: () => clock.now });
    vi.stubGlobal('window', {
      innerWidth: 800,
      innerHeight: 400,
      addEventListener: (type: string, h: (e: unknown) => void) => (listeners[type] ??= []).push(h),
      matchMedia: (query: string) =>
        query.includes('orientation')
          ? { get matches() { return portrait.matches; }, addEventListener: (_: string, h: () => void) => (portrait.change = h) }
          : { matches: o.coarse ?? false, addEventListener: () => undefined },
    });
    const pads: { list: unknown[] } = { list: [] };
    vi.stubGlobal('navigator', { getGamepads: () => pads.list });

    const calls = { pause: 0, mute: 0, reset: 0 };
    const manager = new InputManager({ pause: () => calls.pause++, mute: () => calls.mute++, KeyR: () => calls.reset++ });
    const root = body.kids.get('#touch')!;
    const place = (sel: string, cx: number, cy: number, r: number): void => {
      root.querySelector(sel).rect = { left: cx - r, top: cy - r, width: 2 * r, height: 2 * r };
    };
    place('.drift', 732, 332, 54);
    place('.nitro', 746, 226, 40);
    place('.brake', 628, 348, 38);

    const fire = (type: string, e: object = {}): void => {
      clock.now += 20;
      for (const h of listeners[type] ?? []) h({ preventDefault: () => undefined, ...e });
    };
    const pointer = (type: 'down' | 'move' | 'up' | 'cancel', id: number, x: number, y: number, target: unknown = canvas, pointerType = 'touch'): void =>
      fire(`pointer${type}`, { pointerId: id, pointerType, clientX: x, clientY: y, target });
    const key = (code: string): void => fire('keydown', { code, metaKey: false, ctrlKey: false, repeat: false, target: null });
    /** Run the animation frames queued so far (the manager's pad polling loop). */
    const frame = (): void => {
      clock.now += 16;
      for (const f of frames.splice(0)) f();
    };
    const read = (): CarInput => {
      clock.now += 8;
      return manager.read(input());
    };
    return { manager, html, root, canvas, portrait, pads, calls, frames, pointer, key, frame, read, fire };
  };
  /** Thumb travel for full lock at low speed on the fake page: 17 % of the 400 px short side. */
  const travel = 400 * INPUT.touch.travel;

  it('starts on the keyboard on a desktop and on touch on a phone', () => {
    const desk = page();
    expect(desk.manager.device).toBe('keys');
    expect([...desk.html.classes]).toEqual(['input-keys']);
    expect(desk.manager.touched).toBe(false);
    expect(desk.read()).toEqual(input());

    const phone = page({ coarse: true });
    expect(phone.manager.device).toBe('touch');
    expect([...phone.html.classes]).toEqual(['input-touch']);
    expect(phone.read()).toEqual(input()); // no auto-throttle before the first touch
  });

  it('switches to touch on the first finger: auto-throttle, and the wheel follows the thumb sideways', () => {
    const p = page();
    p.pointer('down', 1, 120, 300, p.canvas, 'mouse');
    expect(p.manager.device).toBe('keys'); // a mouse click is not a touch
    p.pointer('down', 1, 120, 300);
    expect(p.manager.device).toBe('touch');
    expect([...p.html.classes]).toEqual(['input-touch']);
    expect(p.manager.touched).toBe(true);
    expect(p.read()).toEqual({ steer: 0, throttle: 1, brake: 0, handbrake: false, nitro: false });
    expect(p.root.querySelector('.wheel').classes.has('on')).toBe(true);
    expect(p.root.querySelector('.wheel').style.transform).toBe('translate3d(120px, 300px, 0)');

    p.pointer('move', 1, 120 + travel / 2, 250); // vertical movement does not matter
    const half = p.read().steer;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.5);
    p.pointer('move', 1, 120 + travel, 300);
    expect(p.read().steer).toBeCloseTo(1, 9);
    expect(p.root.querySelector('.wheel i').style.transform).toBe('rotate(90deg)');
    p.pointer('move', 1, 120 - travel, 300);
    expect(p.read().steer).toBeCloseTo(-1, 9);

    // Same thumb position, more speed: less steering.
    p.pointer('move', 1, 120 - travel * 0.8, 300);
    const slow = p.read().steer;
    p.manager.setSpeed(250 * KMH);
    const fast = p.read().steer;
    expect(fast).toBeGreaterThan(slow); // both negative: nearer zero
    expect(fast).toBeLessThan(-0.3); // still enough to start a drift

    p.pointer('up', 1, 0, 0);
    expect(p.read().steer).toBe(0);
    expect(p.root.querySelector('.wheel').classes.has('on')).toBe(false);
    expect(p.root.querySelector('.wheel i').style.transform).toBe('rotate(0deg)');
  });

  it('holds buttons per finger: sliding off releases, rolling onto the next button presses it', () => {
    const p = page();
    p.pointer('down', 1, 120, 300); // steering thumb stays down throughout
    p.pointer('move', 1, 120 - travel, 300);
    p.pointer('down', 2, 732, 332);
    expect(p.read()).toEqual({ steer: -1, throttle: 1, brake: 0, handbrake: true, nitro: false });
    expect(p.root.querySelector('.drift').classes.has('on')).toBe(true);

    p.pointer('move', 2, 732, 332 - 54 - INPUT.touch.hitPad - 20); // between drift and nitro: nitro's edge is nearer
    expect(p.read()).toMatchObject({ handbrake: false, nitro: true });
    p.pointer('move', 2, 500, 120); // off every button
    expect(p.read()).toMatchObject({ handbrake: false, nitro: false, steer: -1 });
    expect(p.root.querySelector('.drift').classes.has('on')).toBe(false);
    p.pointer('move', 2, 746, 226);
    expect(p.read().nitro).toBe(true);

    p.pointer('down', 3, 628, 348); // a third finger brakes: throttle lifts
    expect(p.read()).toMatchObject({ throttle: 0, brake: 1, nitro: true });
    p.pointer('cancel', 3, 628, 348);
    expect(p.read()).toMatchObject({ throttle: 1, brake: 0, nitro: true });
    p.pointer('up', 2, 746, 226);
    expect(p.read()).toEqual({ steer: -1, throttle: 1, brake: 0, handbrake: false, nitro: false });

    p.pointer('down', 4, 300, 200); // a second finger on the steering side changes nothing
    expect(p.read().steer).toBe(-1);
    p.fire('blur');
    expect(p.read()).toEqual({ steer: 0, throttle: 1, brake: 0, handbrake: false, nitro: false });
  });

  it('leaves touches on other UI alone and pauses from the pause button', () => {
    const p = page({ coarse: true });
    p.pointer('down', 1, 120, 300, new FakeElement()); // e.g. a menu button
    expect(p.read()).toEqual(input());
    p.pointer('down', 2, 400, 20, p.root.querySelector('.pause'));
    expect(p.calls.pause).toBe(1);
    expect(p.read()).toEqual(input()); // the pause tap neither steers nor starts the car
  });

  it('hands over to the keyboard and back, dropping what the other device held', () => {
    const p = page();
    p.pointer('down', 1, 120, 300);
    p.pointer('move', 1, 120 + travel, 300);
    expect(p.read()).toMatchObject({ steer: 1, throttle: 1 });
    p.key('KeyA');
    expect(p.manager.device).toBe('keys');
    expect([...p.html.classes]).toEqual(['input-keys']);
    expect(p.read()).toEqual({ steer: -1, throttle: 0, brake: 0, handbrake: false, nitro: false });
    p.key('KeyM');
    p.key('KeyR');
    expect(p.calls).toEqual({ pause: 0, mute: 1, reset: 1 });

    p.pointer('down', 5, 700, 100);
    expect(p.manager.device).toBe('touch');
    expect(p.read()).toMatchObject({ steer: -1, throttle: 1 }); // A is still held on the keyboard
  });

  it('goes neutral in portrait and asks for a pause once', () => {
    const p = page({ coarse: true });
    p.pointer('down', 1, 120, 300);
    expect(p.read().throttle).toBe(1);
    p.portrait.matches = true;
    p.portrait.change();
    expect(p.calls.pause).toBe(1);
    expect(p.read()).toEqual(input());
    p.pointer('down', 2, 120, 300);
    expect(p.read()).toEqual(input());
    p.portrait.matches = false;
    p.portrait.change();
    expect(p.calls.pause).toBe(1);
    // Back in landscape the fingers have been released but auto-throttle stays armed.
    expect(p.read()).toEqual({ steer: 0, throttle: 1, brake: 0, handbrake: false, nitro: false });
  });

  it('drops held input while paused and ignores fingers until resumed', () => {
    const p = page({ coarse: true });
    p.pointer('down', 1, 120, 300);
    p.pointer('down', 2, 732, 332);
    p.key('KeyW');
    p.pointer('down', 3, 120, 300); // back to touch
    p.manager.setActive(false);
    expect(p.root.classes.has('off')).toBe(true);
    expect(p.read()).toEqual(input());
    p.pointer('down', 4, 732, 332);
    expect(p.read()).toEqual(input());
    p.portrait.matches = true;
    p.portrait.change();
    expect(p.calls.pause).toBe(0); // already paused: turning the phone must not toggle it back
    p.portrait.matches = false;
    p.portrait.change();
    p.manager.setActive(true);
    expect(p.root.classes.has('off')).toBe(false);
    p.pointer('down', 5, 732, 332);
    expect(p.read()).toMatchObject({ throttle: 1, handbrake: true });
  });

  it('polls a connected pad once per frame, switches the glyphs to it, and hears Start while paused', () => {
    const B = INPUT.pad.buttons;
    const pad = (axis: number, held: Record<number, number> = {}): unknown => ({
      connected: true,
      mapping: 'standard',
      axes: [axis],
      buttons: Array.from({ length: 17 }, (_, i) => ({ value: held[i] ?? 0, pressed: (held[i] ?? 0) > 0.5 })),
    });
    const p = page();
    p.frame(); // the start-up check finds no pad and stops
    expect(p.frames.length).toBe(0);

    let polls = 0;
    p.pads.list = [pad(0)];
    vi.stubGlobal('navigator', { getGamepads: () => (polls++, p.pads.list) });
    p.fire('gamepadconnected');
    p.frame();
    expect(p.frames.length).toBe(1); // keeps polling while the pad is there
    expect(p.manager.device).toBe('keys'); // connected but not used yet

    p.pads.list = [pad(-1, { [B.throttle]: 0.525, [B.drift]: 1 })];
    polls = 0;
    const out = input();
    for (let k = 0; k < 8; k++) p.manager.read(out); // eight simulation steps in one frame
    expect(polls).toBe(0); // already sampled this frame
    const merged = p.read();
    expect(polls).toBe(1);
    expect(merged.steer).toBe(-1);
    expect(merged.throttle).toBeCloseTo(0.5, 6);
    expect(merged.handbrake).toBe(true);
    expect(p.manager.device).toBe('pad');
    expect([...p.html.classes]).toEqual(['input-pad']);
    expect(p.manager.touched).toBe(true);

    p.key('KeyD'); // keyboard and pad together: steering adds up, the keyboard takes the glyphs back
    expect(p.read().steer).toBe(0);
    expect(p.manager.device).toBe('keys');

    p.manager.setActive(false);
    p.pads.list = [pad(0, { [B.start]: 1 })];
    p.frame();
    p.frame();
    expect(p.calls.pause).toBe(1);
    p.pads.list = [pad(0, { [B.reset]: 1 })];
    p.frame();
    expect(p.calls.reset).toBe(1); // Y falls back to the R action

    p.pads.list = [];
    p.fire('gamepaddisconnected');
    p.frame();
    expect(p.frames.length).toBe(0);
    expect(p.read()).toEqual(input());
  });
});
