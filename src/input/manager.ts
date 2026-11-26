// One input source for the game: keyboard, gamepad and touch merged into a plain CarInput.
// The simulation never sees a device: steering adds up (clamped), pedals take the larger value, buttons
// are OR-ed. `device` is the device used last; it only drives presentation (glyphs, touch controls)
// through a class on <html>: input-keys, input-pad or input-touch.

import { INPUT } from '../config/input';
import type { CarInput } from '../vehicle/car';
import { GamepadReader } from './gamepad';
import { Keyboard } from './keyboard';
import { mergeInputs } from './logic';
import { TouchControls } from './touch';

export type InputDevice = 'keys' | 'pad' | 'touch';

export interface InputActions {
  /** Gamepad Start, the touch pause button, and turning a touch device to portrait while driving.
   *  From Start and the pause button it is called on every press, paused or not: the receiver toggles. */
  pause?: () => void;
  /** Keyboard M. */
  mute?: () => void;
  /** Gamepad Y or Select. Defaults to the `KeyR` action. */
  reset?: () => void;
  /** Gamepad D-pad / left stick up, down and the A button, only while the game is paused (`setActive(false)`):
   *  they drive the pause menu. */
  menuUp?: () => void;
  menuDown?: () => void;
  menuAccept?: () => void;
  /** One-shot keyboard actions by `KeyboardEvent.code` (KeyR, KeyP, KeyO, Escape …). */
  [code: string]: (() => void) | undefined;
}

const neutral = (): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false });

export class InputManager {
  /** The device used last. */
  device: InputDevice = 'keys';
  private readonly keyboard: Keyboard;
  private readonly pad: GamepadReader;
  private readonly touch: TouchControls;
  private readonly fromKeys = neutral();
  private readonly fromTouch = neutral();
  /** A pad or the touch screen has been used to drive. */
  private driven = false;
  private active = true;
  private lastPoll = -Infinity;
  private padLoop = false;

  constructor(actions: InputActions) {
    const html = document.documentElement;
    this.keyboard = new Keyboard(actions.mute ? { ...actions, KeyM: actions.mute } : actions, () => this.use('keys'));
    this.pad = new GamepadReader({
      pause: () => actions.pause?.(),
      reset: () => (actions.reset ?? actions.KeyR)?.(),
      navigate: (dir) => {
        if (!this.active) (dir < 0 ? actions.menuUp : actions.menuDown)?.();
      },
      accept: () => {
        if (!this.active) actions.menuAccept?.();
      },
    });
    this.touch = new TouchControls({
      used: () => {
        this.driven = true;
        this.use('touch');
      },
      pause: () => actions.pause?.(),
      portrait: () => {
        if (this.device === 'touch' && this.active) actions.pause?.();
      },
    });
    html.classList.add('input-keys');
    // Phones and tablets get their controls before the first touch.
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) this.use('touch');

    const wake = (): void => {
      this.pad.wake();
      if (this.padLoop) return;
      this.padLoop = true;
      requestAnimationFrame(this.padFrame);
    };
    window.addEventListener('gamepadconnected', wake);
    window.addEventListener('gamepaddisconnected', wake);
    wake(); // a pad may already be connected
  }

  /** True once the player has driven with any device (used to hide the control hints). */
  get touched(): boolean {
    return this.keyboard.touched || this.driven;
  }

  /** Current input, merged over all devices. Allocation-free; call it once per simulation step. */
  read(out: CarInput): CarInput {
    if (this.pad.present) this.samplePad();
    return mergeInputs(out, this.keyboard.read(this.fromKeys), this.pad.state, this.touch.read(this.fromTouch));
  }

  /** Driving speed in m/s, once per frame: touch steering gets less sensitive as it rises. */
  setSpeed(mps: number): void {
    this.touch.speed = mps;
  }

  /** Call with false when the game pauses and true when it resumes: held keys and fingers are dropped and
   *  the touch controls hide while paused. Gamepad Start still reaches `actions.pause`. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.keyboard.clear();
    this.touch.setActive(active);
  }

  /** Shake the gamepad (wall hits). `strength` 0…1. Does nothing unless a pad is the device in use. */
  rumble(strength: number, ms: number = INPUT.pad.rumbleMs): void {
    if (this.device === 'pad') this.pad.rumble(strength, ms);
  }

  private use(device: InputDevice): void {
    if (device === this.device) return;
    const list = document.documentElement.classList;
    list.remove(`input-${this.device}`);
    list.add(`input-${device}`);
    this.device = device;
    this.touch.setShown(device === 'touch');
  }

  /** Sample the pads, at most once per INPUT.pollInterval however often it is asked. */
  private samplePad(): void {
    const now = performance.now();
    if (now - this.lastPoll < INPUT.pollInterval) return;
    this.lastPoll = now;
    if (this.pad.poll()) {
      this.driven = true;
      this.use('pad');
    }
  }

  /** Keeps polling while a pad is connected, so Start works while the simulation is paused. */
  private readonly padFrame = (): void => {
    this.samplePad();
    if (this.pad.present) requestAnimationFrame(this.padFrame);
    else this.padLoop = false;
  };
}
