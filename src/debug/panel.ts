// `?debug` tuning panel: live readouts plus number fields for every scalar in the config objects.
// Edits apply immediately to the running game. "复制" copies the current values as JSON to paste back
// into src/config/. Development only.

import { CAMERA } from '../config/camera';
import { CAR } from '../config/car';
import { DRIFT } from '../config/drift';
import { SCORING } from '../config/scoring';

const CSS = `
#dbg{position:fixed;left:10px;top:54px;width:268px;max-height:calc(100vh - 200px);overflow:auto;background:rgba(9,11,13,.86);
color:#f4f5f0;font:12px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;z-index:5;border-left:3px solid #ff8a1f}
#dbg pre{margin:0 0 6px;white-space:pre-wrap;color:#d7f205}
#dbg details{border-top:1px solid rgba(255,255,255,.14);padding:3px 0}
#dbg summary{cursor:pointer;font-weight:700;letter-spacing:.08em}
#dbg label{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:1px 0}
#dbg input[type=number]{width:86px;background:#16191c;color:#f4f5f0;border:1px solid #333;font:inherit;padding:1px 3px}
#dbg input[type=checkbox]{margin:0}
#dbg button{font:inherit;background:#d7f205;color:#0b0d0f;border:0;padding:3px 8px;margin:4px 6px 0 0;cursor:pointer;font-weight:700}
#dbg .changed{color:#ff8a1f}`;

type Dict = Record<string, unknown>;

export class DebugPanel {
  private readonly readout: HTMLPreElement;

  constructor(actions: Record<string, () => void>) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'dbg';
    this.readout = document.createElement('pre');
    el.appendChild(this.readout);

    const groups: [string, Dict][] = [['DRIFT', DRIFT], ['CAR', CAR], ['SCORING', SCORING], ['CAMERA', CAMERA]];
    for (const [title, obj] of groups) {
      const details = document.createElement('details');
      details.open = title === 'DRIFT';
      details.innerHTML = `<summary>${title}</summary>`;
      for (const key of Object.keys(obj)) {
        const initial = obj[key];
        if (typeof initial !== 'number' && typeof initial !== 'boolean') continue;
        const label = document.createElement('label');
        label.textContent = key;
        const input = document.createElement('input');
        if (typeof initial === 'boolean') {
          input.type = 'checkbox';
          input.checked = initial;
          input.addEventListener('change', () => {
            obj[key] = input.checked;
            label.classList.toggle('changed', input.checked !== initial);
          });
        } else {
          input.type = 'number';
          input.value = String(Number(initial.toPrecision(6)));
          input.step = String(Math.abs(initial) >= 10 ? 1 : Math.abs(initial) >= 1 ? 0.1 : 0.01);
          input.addEventListener('input', () => {
            const v = Number(input.value);
            if (Number.isFinite(v)) {
              obj[key] = v;
              label.classList.toggle('changed', v !== initial);
            }
          });
        }
        label.appendChild(input);
        details.appendChild(label);
      }
      el.appendChild(details);
    }

    const button = (text: string, fn: () => void): void => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => {
        fn();
        b.blur(); // keep the keyboard on the car
      });
      el.appendChild(b);
    };
    button('复制 JSON', () => void navigator.clipboard?.writeText(JSON.stringify({ DRIFT, CAR, SCORING, CAMERA }, null, 2)));
    for (const [text, fn] of Object.entries(actions)) button(text, fn);
    document.body.appendChild(el);
  }

  setReadout(text: string): void {
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }
}
