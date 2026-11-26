// Keyboard → CarInput. One-shot actions (reset, autopilot toggle) are delivered through callbacks.

import type { CarInput } from '../vehicle/car';

const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'AltLeft', 'AltRight', 'KeyN']);

export class Keyboard {
  private readonly down = new Set<string>();
  /** True once any driving key has been pressed (used to hide the control hints). */
  touched = false;

  /**
   * @param actions one-shot actions by `KeyboardEvent.code`; entries that are not key codes are ignored.
   * @param onUse called on every key press this class handles (lets the input manager see which device is in use).
   */
  constructor(actions: Record<string, (() => void) | undefined>, onUse?: () => void) {
    window.addEventListener('keydown', (e) => {
      // Alt is the nitro key, so altKey must not block the other keys: steering has to work while it is held.
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const action = actions[e.code];
      if (DRIVE_KEYS.has(e.code)) {
        e.preventDefault();
        this.down.add(e.code);
        this.touched = true;
        onUse?.();
      } else if (!e.repeat && action) {
        e.preventDefault();
        onUse?.();
        action();
      }
    });
    window.addEventListener('keyup', (e) => {
      // Releasing Alt on its own would otherwise focus the browser's menu bar on Windows and Linux.
      if (this.down.delete(e.code) && e.code.startsWith('Alt')) e.preventDefault();
    });
    // Keys released while the window is unfocused never send keyup.
    window.addEventListener('blur', () => this.clear());
  }

  /** Forget every held key (focus lost, game paused). */
  clear(): void {
    this.down.clear();
  }

  read(out: CarInput): CarInput {
    const d = this.down;
    out.steer = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    out.throttle = d.has('KeyW') || d.has('ArrowUp') ? 1 : 0;
    out.brake = d.has('KeyS') || d.has('ArrowDown') ? 1 : 0;
    out.handbrake = d.has('Space');
    out.nitro = d.has('AltLeft') || d.has('AltRight') || d.has('KeyN');
    return out;
  }
}
