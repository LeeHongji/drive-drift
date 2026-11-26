// Touch controls → CarInput, and the DOM overlay that draws them (styles: src/ui/touch.css).
//
// Left part of the screen: a virtual steering wheel appears under the thumb. Steering follows the thumb's
// SIDEWAYS travel from where it landed, and the wheel graphic turns to show the result. A wheel read by
// the thumb's angle around the centre was rejected: near the centre the angle is undefined, a few pixels
// straight to the side already mean 90° (full lock), and fine control needs wide circles that a thumb
// pivoting at its base cannot draw. Sideways travel is proportional, has one obvious centre, and "hold
// to tighten, release to widen" (drift-gameplay.md §2) becomes "push the thumb over, let go".
// Right part: 漂移, 氮气 and 刹车 buttons. Throttle is automatic once the screen has been touched.
//
// Pointers are tracked by id and hit-tested against cached button circles, so a thumb can slide off a
// button (releases it) or roll from one button onto the next. Layout is only read in `measure`.

import '../ui/touch.css';
import { INPUT, type FluidSize } from '../config/input';
import { clamp, DEG } from '../core/math';
import type { CarInput } from '../vehicle/car';
import { clearInput, followAnchor, hitButton, touchTravelScale, wheelAngle, type HitCircle } from './logic';

const NONE = -1;
/** Button indices in `buttonEls`, `circles` and `held`. */
const BRAKE = 0;
const NITRO = 1;
const DRIFT = 2;

const TEMPLATE = `
<div class="wheel"><i></i><span>拖动转向</span></div>
<div class="btn brake">刹车</div>
<div class="btn nitro">氮气</div>
<div class="btn drift">漂移</div>
<div class="pause" aria-label="暂停"></div>
<div class="rotate"><b>请横屏</b><small>把设备横过来再开车</small></div>`;

const fluid = (s: FluidSize): string => `clamp(${s.min}px, ${s.vmin}vmin, ${s.max}px)`;

export interface TouchHost {
  /** A finger went down on the game: touch is the device in use. */
  used(): void;
  /** The pause button was tapped. */
  pause(): void;
  /** The device was turned to portrait. */
  portrait(): void;
}

export class TouchControls {
  /** Driving speed, m/s: steering needs more thumb travel as this rises. */
  speed = 0;
  private readonly root: HTMLElement;
  private readonly wheelEl: HTMLElement;
  private readonly rimEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly buttonEls: HTMLElement[];
  private readonly circles: HitCircle[] = [
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
  ];
  private readonly held = [false, false, false];
  /** Fingers on the button side: pointer id (NONE = free slot) and the button under it (−1 = none). */
  private readonly slotId: number[] = new Array<number>(INPUT.touch.maxPointers).fill(NONE);
  private readonly slotBtn: number[] = new Array<number>(INPUT.touch.maxPointers).fill(-1);
  private readonly orientation: MediaQueryList;
  /** The controls are on screen (touch is the device in use). */
  private shown = false;
  /** False while the game is paused. */
  private active = true;
  private isPortrait = false;
  /** Auto-throttle is armed by the first touch. */
  private started = false;
  private steerId = NONE;
  private anchorX = 0;
  private anchorY = 0;
  private thumbX = 0;
  /** Viewport width and the full-lock thumb travel at low speed, CSS px (cached by `measure`). */
  private width = 1;
  private height = 1;
  private travel: number = INPUT.touch.travelMin;
  private wheelX = NaN;
  private wheelY = NaN;
  private wheelDeg = 0;

  constructor(private readonly host: TouchHost) {
    const T = INPUT.touch;
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = TEMPLATE;
    // Sizes reach touch.css as custom properties.
    for (const [name, size] of Object.entries({
      'wheel-size': T.wheelSize, 'drift-size': T.driftSize, 'nitro-size': T.nitroSize, 'brake-size': T.brakeSize,
      'pause-size': T.pauseSize, gap: T.gap, edge: T.edge,
    })) {
      root.style.setProperty(`--${name}`, fluid(size));
    }
    const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
    this.root = root;
    this.wheelEl = q('.wheel');
    this.rimEl = q('.wheel i');
    this.pauseEl = q('.pause');
    this.buttonEls = [q('.brake'), q('.nitro'), q('.drift')];
    document.body.appendChild(root);

    this.orientation = window.matchMedia('(orientation: portrait)');
    this.isPortrait = this.orientation.matches;
    this.orientation.addEventListener('change', () => {
      this.isPortrait = this.orientation.matches;
      this.release();
      this.measure();
      if (this.isPortrait) this.host.portrait();
    });
    window.addEventListener('resize', () => this.measure());
    window.addEventListener('blur', () => this.release());
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    // A long press would otherwise open the context menu in the middle of a drift.
    window.addEventListener('contextmenu', (e) => {
      if (this.shown && this.ours(e.target)) e.preventDefault();
    });
  }

  /** Show or hide the controls (the input manager shows them while touch is the device in use). */
  setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.release();
    if (on) this.measure();
    else this.started = false;
  }

  /** Paused: the controls disappear and ignore fingers until the game runs again. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.root.classList.toggle('off', !on);
    this.release();
    if (on) this.measure();
  }

  read(out: CarInput): CarInput {
    if (!this.shown || !this.active || this.isPortrait) return clearInput(out);
    out.steer = this.steerId === NONE ? 0 : this.angle() / INPUT.touch.wheelMaxAngle;
    const brake = this.held[BRAKE];
    out.brake = brake ? 1 : 0;
    out.throttle = this.started && !brake ? 1 : 0;
    out.handbrake = this.held[DRIFT];
    out.nitro = this.held[NITRO];
    return out;
  }

  /** Wheel angle for the current thumb position and speed, radians. */
  private angle(): number {
    return wheelAngle(this.anchorX, this.thumbX, this.travel * touchTravelScale(this.speed));
  }

  /** The game canvas and our own elements take touches; menus and debug panels keep theirs. */
  private ours(target: EventTarget | null): boolean {
    return target instanceof HTMLCanvasElement || (target instanceof Node && this.root.contains(target));
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || !this.active || !this.ours(e.target)) return;
    e.preventDefault();
    this.host.used(); // shows the controls (and measures them) if another device was in use
    if (this.isPortrait) return;
    if (e.target === this.pauseEl) {
      this.host.pause();
      return;
    }
    this.started = true;
    const x = e.clientX;
    const y = e.clientY;
    if (x < this.width * INPUT.touch.steerZone) {
      if (this.steerId !== NONE) return;
      this.steerId = e.pointerId;
      this.anchorX = x;
      this.anchorY = y;
      this.thumbX = x;
      this.wheelEl.classList.add('on');
      this.drawWheel();
      return;
    }
    const slot = this.slotId.indexOf(NONE);
    if (slot < 0) return;
    this.slotId[slot] = e.pointerId;
    this.slotBtn[slot] = hitButton(x, y, this.circles);
    this.syncButtons();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.steerId) {
      this.thumbX = e.clientX;
      this.anchorX = followAnchor(this.anchorX, this.thumbX, this.travel * touchTravelScale(this.speed));
      this.drawWheel();
      return;
    }
    const slot = this.slotId.indexOf(e.pointerId);
    if (slot < 0) return;
    const btn = hitButton(e.clientX, e.clientY, this.circles);
    if (btn !== this.slotBtn[slot]) {
      this.slotBtn[slot] = btn;
      this.syncButtons();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.steerId) {
      this.steerId = NONE;
      this.wheelEl.classList.remove('on');
      this.drawWheel();
      return;
    }
    const slot = this.slotId.indexOf(e.pointerId);
    if (slot < 0) return;
    this.slotId[slot] = NONE;
    this.slotBtn[slot] = -1;
    this.syncButtons();
  };

  /** Let go of everything (focus lost, paused, rotated, another device took over). */
  private release(): void {
    this.steerId = NONE;
    this.wheelEl.classList.remove('on');
    this.slotId.fill(NONE);
    this.slotBtn.fill(-1);
    this.syncButtons();
    this.drawWheel();
  }

  /** Recompute which buttons are held from the tracked fingers; touch the DOM only for buttons that changed. */
  private syncButtons(): void {
    for (let b = 0; b < this.held.length; b++) {
      const on = this.slotBtn.indexOf(b) >= 0;
      if (on !== this.held[b]) {
        this.held[b] = on;
        this.buttonEls[b].classList.toggle('on', on);
      }
    }
  }

  /** Put the wheel under the thumb (or at its resting place) and turn it; writes only what changed. */
  private drawWheel(): void {
    const steering = this.steerId !== NONE;
    const x = Math.round(steering ? this.anchorX : this.width * INPUT.touch.wheelHome[0]);
    const y = Math.round(steering ? this.anchorY : this.height * INPUT.touch.wheelHome[1]);
    if (x !== this.wheelX || y !== this.wheelY) {
      this.wheelX = x;
      this.wheelY = y;
      this.wheelEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    const deg = steering ? Math.round(this.angle() / DEG) : 0;
    if (deg !== this.wheelDeg) {
      this.wheelDeg = deg;
      this.rimEl.style.transform = `rotate(${deg}deg)`;
    }
  }

  /** Cache the viewport size and where the buttons are. The only place that reads layout. */
  private measure(): void {
    if (!this.shown || !this.active) return;
    const T = INPUT.touch;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.travel = clamp(Math.min(this.width, this.height) * T.travel, T.travelMin, T.travelMax);
    for (let b = 0; b < this.buttonEls.length; b++) {
      const rect = this.buttonEls[b].getBoundingClientRect();
      const c = this.circles[b];
      c.x = rect.left + rect.width / 2;
      c.y = rect.top + rect.height / 2;
      c.r = rect.width / 2;
    }
    this.drawWheel();
  }
}
