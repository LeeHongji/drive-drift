// Gamepad → CarInput. Polled, never event-driven: the Gamepad API only reports state on request.
// Only pads the browser exposes with the W3C "standard" mapping are read; anything else (wheels, flight
// sticks, unmapped pads) is ignored rather than guessed at. Several standard pads are merged.

import { INPUT } from '../config/input';
import type { CarInput } from '../vehicle/car';
import { clearInput, stickSteer, triggerPedal } from './logic';

export interface PadActions {
  /** Start pressed. */
  pause?: () => void;
  /** Y or Select pressed. */
  reset?: () => void;
  /** D-pad or left stick pushed up (−1) or down (+1); fires once per push. */
  navigate?: (dir: 1 | -1) => void;
  /** A pressed. The receiver decides whether a menu is open. */
  accept?: () => void;
}

/** Analog value of button `i`; some browsers report triggers as pressed/not pressed only. */
function buttonValue(buttons: readonly GamepadButton[], i: number): number {
  const b = buttons[i];
  return b ? b.value || (b.pressed ? 1 : 0) : 0;
}

export class GamepadReader {
  /** What the pads hold as of the last poll. */
  readonly state: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
  /** True while polling is worthwhile: set by `wake` and by a poll that finds a usable pad, cleared by one
   *  that finds none. */
  present = false;
  private active = false;
  private startHeld = false;
  private resetHeld = false;
  private acceptHeld = false;
  /** Menu direction held at the last poll: −1 up, +1 down, 0 none. */
  private navHeld = 0;
  /** Index (in navigator.getGamepads()) of the pad used last: the one that rumbles. */
  private lastIndex = -1;
  private rumbleUntil = 0;

  constructor(private readonly actions: PadActions = {}) {}

  /** A pad may have appeared or gone: poll again. Call on gamepadconnected / gamepaddisconnected. */
  wake(): void {
    this.present = true;
  }

  /**
   * Sample every connected standard pad into `state` and fire the one-shot actions.
   * Returns true on the poll where the player starts using a pad (idle → button, trigger or stick).
   */
  poll(): boolean {
    const P = INPUT.pad;
    const B = P.buttons;
    let pads: readonly (Gamepad | null)[] | null = null;
    try {
      // Missing in insecure contexts; throws inside frames without the "gamepad" permission.
      pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      pads = null;
    }

    let found = false;
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let drift = false;
    let nitro = false;
    let start = false;
    let reset = false;
    let nav = 0;
    let active = false;
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected || pad.mapping !== 'standard') continue;
        found = true;
        const b = pad.buttons;
        const axis = pad.axes[P.steerAxis] || 0;
        const rt = buttonValue(b, B.throttle);
        const lt = buttonValue(b, B.brake);
        const x = buttonValue(b, B.drift) > P.press;
        const a = buttonValue(b, B.nitro) > P.press;
        const st = buttonValue(b, B.start) > P.press;
        const rs = buttonValue(b, B.reset) > P.press || buttonValue(b, B.select) > P.press;
        steer += stickSteer(axis);
        throttle = Math.max(throttle, triggerPedal(rt));
        brake = Math.max(brake, triggerPedal(lt));
        drift = drift || x;
        nitro = nitro || a;
        start = start || st;
        reset = reset || rs;
        const stickY = pad.axes[P.menuAxis] || 0;
        if (buttonValue(b, B.up) > P.press || stickY < -P.menuStick) nav = -1;
        else if (buttonValue(b, B.down) > P.press || stickY > P.menuStick) nav = 1;
        if (x || a || st || rs || rt > P.wake || lt > P.wake || Math.abs(axis) > P.wake) {
          active = true;
          this.lastIndex = i;
        }
      }
    }

    const s = this.state;
    if (!found) {
      this.present = false;
      this.active = false;
      this.startHeld = false;
      this.resetHeld = false;
      this.acceptHeld = false;
      this.navHeld = 0;
      clearInput(s);
      return false;
    }
    this.present = true;
    s.steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
    s.throttle = throttle;
    s.brake = brake;
    s.handbrake = drift;
    s.nitro = nitro;

    const claimed = active && !this.active;
    this.active = active;
    const startPressed = start && !this.startHeld;
    const resetPressed = reset && !this.resetHeld;
    this.startHeld = start;
    this.resetHeld = reset;
    const acceptPressed = nitro && !this.acceptHeld;
    const navPressed = nav !== 0 && nav !== this.navHeld;
    this.acceptHeld = nitro;
    this.navHeld = nav;
    if (startPressed) this.actions.pause?.();
    if (resetPressed) this.actions.reset?.();
    if (navPressed) this.actions.navigate?.(nav as 1 | -1);
    if (acceptPressed) this.actions.accept?.();
    return claimed;
  }

  /** Shake the pad used last. `strength` 0…1; does nothing where the browser or the pad has no haptics. */
  rumble(strength: number, ms: number): void {
    const P = INPUT.pad;
    if (!this.present || this.lastIndex < 0 || !(strength >= P.rumbleMin)) return;
    const now = performance.now();
    if (now < this.rumbleUntil) return; // one effect at a time: a wall scrape reports a hit on every step
    try {
      const actuator = navigator.getGamepads()[this.lastIndex]?.vibrationActuator;
      if (!actuator || typeof actuator.playEffect !== 'function') return;
      this.rumbleUntil = now + ms;
      const strong = Math.min(1, strength);
      actuator
        .playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong * P.rumbleWeak })
        .catch(() => undefined);
    } catch {
      // Haptics are optional.
    }
  }
}
