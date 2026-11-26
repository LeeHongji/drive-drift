// HUD: drift counter, gauge, lap panel, messages. Plain DOM over the canvas; text nodes are only touched
// when their value changes.

import { CAR } from '../config/car';
import { NITRO } from '../config/nitro';
import { SCORING } from '../config/scoring';
import { KMH } from '../core/math';
import type { Bests } from '../gameplay/bests';
import type { LapEvent } from '../gameplay/laps';
import type { PickupEvent } from '../gameplay/pickups';
import type { ScoreEvent } from '../gameplay/scoring';
import type { Session } from '../gameplay/session';

/** Gauge geometry in SVG user units (viewBox 260 × 190): the rev arc and the nitro arc share this centre,
 *  start angle (degrees clockwise from 3 o'clock) and sweep. */
const GAUGE = {
  cx: 130,
  cy: 120,
  startDeg: 145,
  sweepDeg: 250,
  /** Radius of the nitro arc (the rev arc is at 110), and the radii the activation tick spans. */
  nitroRadius: 96,
  tickInner: 89,
  tickOuter: 103,
};

function gaugePoint(radius: number, fraction: number): [number, number] {
  const a = ((GAUGE.startDeg + GAUGE.sweepDeg * fraction) * Math.PI) / 180;
  return [GAUGE.cx + radius * Math.cos(a), GAUGE.cy + radius * Math.sin(a)];
}

/** SVG path for the whole sweep at `radius`. */
function gaugeArc(radius: number): string {
  const [x0, y0] = gaugePoint(radius, 0);
  const [x1, y1] = gaugePoint(radius, 1);
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${radius} ${radius} 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

const NITRO_ARC = gaugeArc(GAUGE.nitroRadius);

const TEMPLATE = `
<div id="nitroflash"></div>
<div id="badge">AUTOPILOT</div>
<div id="drift">
  <div class="label">DRIFT</div>
  <div class="row"><span class="metres">0</span><span class="unit">m</span><span class="mult hidden">×1</span></div>
  <div class="bar"><i></i></div>
</div>
<div id="result"></div>
<div id="pace"><span class="arrow">➜</span><b class="kmh">120</b><small></small></div>
<div id="coach"></div>
<div id="keys"><kbd data-k="a">A</kbd><kbd data-k="w">W</kbd><kbd data-k="s">S</kbd><kbd data-k="d">D</kbd><kbd data-k="space" class="wide">空格</kbd></div>
<div id="lapflash"></div>
<div id="laps">
  <div class="head"><span>LAP</span><b class="lap">–</b></div>
  <div class="time">0:00.000</div>
  <dl>
    <dt>LAST</dt><dd class="last">–:––.–––</dd>
    <dt>BEST</dt><dd class="best">–:––.–––</dd>
    <hr />
    <dt>LAP DRIFT</dt><dd class="lapscore score">0</dd>
    <dt>TOTAL</dt><dd class="total score">0</dd>
  </dl>
</div>
<div id="gauge">
  <svg viewBox="0 0 260 190">
    <path class="track" pathLength="100" d="M 39.9 183.1 A 110 110 0 1 1 220.1 183.1" />
    <path class="red" pathLength="100" d="M 39.9 183.1 A 110 110 0 1 1 220.1 183.1" />
    <path class="rev" pathLength="100" d="M 39.9 183.1 A 110 110 0 1 1 220.1 183.1" />
    <path class="ntrack" pathLength="100" d="${NITRO_ARC}" />
    <path class="nlock" pathLength="100" d="${NITRO_ARC}" />
    <path class="nfill" pathLength="100" d="${NITRO_ARC}" />
    <line class="ntick" />
  </svg>
  <div class="gear">1</div>
  <div class="speed"><b>0</b><span>KM/H</span></div>
  <div class="nitro"><span>NITRO</span><b>MAX</b></div>
</div>
<div id="hint">
  <span class="k"><kbd>W</kbd>油门</span><span class="k"><kbd>S</kbd>刹车</span><span class="k"><kbd>A</kbd><kbd>D</kbd>转向</span>
  <span class="k">按住转向 + 点<kbd>空格</kbd>= 漂移</span><span class="k"><kbd>N</kbd>氮气</span><span class="k"><kbd>O</kbd>看演示</span><span class="k"><kbd>R</kbd>重置</span>
  <span class="p"><kbd>RT</kbd>油门</span><span class="p"><kbd>LT</kbd>刹车</span><span class="p"><kbd>左摇杆</kbd>转向</span>
  <span class="p">按住转向 + 点<kbd class="face">X</kbd>= 漂移</span><span class="p"><kbd class="face">A</kbd>氮气</span><span class="p"><kbd class="face">Y</kbd>重置</span><span class="p"><kbd>START</kbd>暂停</span>
</div>`;

/** What the pace note shows for the corner ahead. */
export interface PaceNote {
  /** +1 = left, −1 = right. */
  dir: number;
  /** Suggested drift entry speed, km/h; null = flat out. */
  kmh: number | null;
  /** Distance to the corner, metres. */
  dist: number;
  /** How the current speed compares: fine, a little fast, or brake now. */
  state: 'ok' | 'warn' | 'brake';
}

export function formatTime(t: number | null): string {
  if (t === null) return '–:––.–––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

/** Sets textContent only when it changed. */
class Text {
  private last = '';
  constructor(private readonly el: Element) {}
  set(v: string): void {
    if (v !== this.last) {
      this.last = v;
      this.el.textContent = v;
    }
  }
}

function replay(el: HTMLElement, cls: string): void {
  el.classList.remove('banked', 'wiped', 'show', 'best', 'bump');
  void el.offsetWidth; // restart the CSS animation
  el.className = cls;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly drift: HTMLElement;
  private readonly multEl: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly result: HTMLElement;
  private readonly lapflash: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly rev: SVGPathElement;
  private readonly nitroFill: SVGPathElement;
  private readonly nitroFlash: HTMLElement;
  private shownNitro = '';
  private readonly hint: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly pace: HTMLElement;
  private readonly paceArrow: HTMLElement;
  private readonly coachEl: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly keyEls: Record<string, HTMLElement> = {};
  private coachText = '';
  private readonly t: Record<string, Text> = {};
  private shownMult = 1;
  private hintTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = TEMPLATE;
    const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
    this.drift = q('#drift');
    this.multEl = q('#drift .mult');
    this.bar = q('#drift .bar i');
    this.result = q('#result');
    this.lapflash = q('#lapflash');
    this.gauge = q('#gauge');
    this.rev = q('#gauge .rev');
    this.nitroFill = q('#gauge .nfill');
    this.nitroFlash = q('#nitroflash');
    this.hint = q('#hint');
    this.badge = q('#badge');
    this.pace = q('#pace');
    this.paceArrow = q('#pace .arrow');
    this.coachEl = q('#coach');
    this.keysEl = q('#keys');
    this.keysEl.querySelectorAll<HTMLElement>('kbd').forEach((el) => (this.keyEls[el.dataset.k!] = el));
    for (const [key, sel] of Object.entries({
      metres: '#drift .metres', mult: '#drift .mult', lap: '#laps .lap', time: '#laps .time', last: '#laps .last',
      best: '#laps .best', lapscore: '#laps .lapscore', total: '#laps .total', gear: '#gauge .gear', speed: '#gauge .speed b',
      paceKmh: '#pace .kmh', paceDist: '#pace small', badge: '#badge',
    })) {
      this.t[key] = new Text(q(sel));
    }
    const red = q<SVGPathElement>('#gauge .red');
    const redFrom = (CAR.rpmRedline / CAR.rpmGaugeMax) * 100;
    red.setAttribute('stroke-dasharray', `0 ${redFrom} ${100 - redFrom}`);
    // Nitro arc: the first stretch is the part of the tank that cannot start a boost, closed by a tick.
    const lock = NITRO.minStart * 100;
    q<SVGPathElement>('#gauge .nlock').setAttribute('stroke-dasharray', `${lock} ${100 - lock}`);
    const tick = q<SVGLineElement>('#gauge .ntick');
    const [x1, y1] = gaugePoint(GAUGE.tickInner, NITRO.minStart);
    const [x2, y2] = gaugePoint(GAUGE.tickOuter, NITRO.minStart);
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) tick.setAttribute(k, v.toFixed(1));
  }

  show(): void {
    this.root.classList.add('on');
  }

  onScore(e: ScoreEvent): void {
    if (e.type === 'banked') {
      this.result.innerHTML = `<b>+${e.points.toLocaleString('en-US')}</b><small>${Math.round(e.metres)} m × ${e.mult}</small>`;
      replay(this.result, 'banked');
    } else if (e.type === 'wiped') {
      this.result.innerHTML = `<b>${Math.round(e.metres * e.mult).toLocaleString('en-US')}</b><small>WIPED OUT</small>`;
      replay(this.result, 'wiped');
    } else if (e.type === 'link') {
      this.multEl.classList.remove('bump');
      void this.multEl.offsetWidth;
      this.multEl.classList.add('bump');
    }
  }

  /** Nitro feedback: a glow on the gauge for a shard, a screen-edge flash when the tank becomes full. */
  onPickup(e: PickupEvent): void {
    const el = e.type === 'full' ? this.nitroFlash : this.gauge;
    const cls = e.type === 'full' ? 'go' : 'n-gain';
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  onLap(e: LapEvent): void {
    this.lapflash.innerHTML = `${formatTime(e.time)}<small>LAP ${e.lap}${e.best ? ' · BEST' : ''}</small>`;
    replay(this.lapflash, e.best ? 'show best' : 'show');
  }

  /** Pace note for the next drift corner, or null to hide it. */
  setPace(note: PaceNote | null): void {
    this.pace.classList.toggle('show', note !== null);
    if (!note) return;
    this.pace.dataset.state = note.state;
    this.paceArrow.style.transform = note.dir > 0 ? 'scaleX(-1)' : '';
    this.t.paceKmh.set(note.kmh === null ? '全油门' : String(note.kmh));
    this.t.paceDist.set(note.kmh === null ? `${Math.round(note.dist / 10) * 10} m` : `KM/H 入弯 · ${Math.round(note.dist / 10) * 10} m`);
  }

  /** One-line coaching prompt (HTML), or '' to hide it. */
  setCoach(html: string): void {
    if (html === this.coachText) return;
    this.coachText = html;
    if (html) this.coachEl.innerHTML = html;
    this.coachEl.classList.toggle('show', html !== '');
  }

  /** Light up the on-screen keys (shown while the demo drives). */
  setKeys(input: { steer: number; throttle: number; brake: number; handbrake: boolean } | null): void {
    this.keysEl.classList.toggle('show', input !== null);
    if (!input) return;
    this.keyEls.a.classList.toggle('on', input.steer < 0);
    this.keyEls.d.classList.toggle('on', input.steer > 0);
    this.keyEls.w.classList.toggle('on', input.throttle > 0);
    this.keyEls.s.classList.toggle('on', input.brake > 0);
    this.keyEls.space.classList.toggle('on', input.handbrake);
  }

  update(session: Session, bests: Bests, mode: 'manual' | 'autopilot' | 'demo', driven: boolean, dt: number): void {
    const { car, score, laps } = session;

    // ---- drift counter ----
    this.drift.classList.toggle('show', score.active);
    if (score.active) {
      this.t.metres.set(String(Math.floor(score.chain)));
      if (score.mult !== this.shownMult) {
        this.shownMult = score.mult;
        this.t.mult.set(`×${score.mult}`);
        this.multEl.classList.toggle('hidden', score.mult < 2);
        this.multEl.classList.toggle('max', score.mult >= SCORING.maxMultiplier);
      }
      this.drift.classList.toggle('linking', !car.drift);
      this.bar.style.transform = `scaleX(${Math.max(0, score.window / SCORING.linkWindow).toFixed(3)})`;
    } else if (this.shownMult !== 1) {
      this.shownMult = 1;
      this.t.mult.set('×1');
      this.multEl.classList.add('hidden');
      this.multEl.classList.remove('max');
    }

    // ---- gauge ----
    // Speed over the ground: in a drift the car travels faster than its nose-forward component.
    this.t.speed.set(String(Math.round(Math.hypot(car.vx, car.vz) / KMH)));
    this.t.gear.set(car.gear === 0 ? 'R' : String(car.gear));
    const frac = car.rpm * (CAR.rpmRedline / CAR.rpmGaugeMax) * 100;
    this.rev.setAttribute('stroke-dasharray', `${frac.toFixed(1)} 100`);
    this.gauge.classList.toggle('redline', car.rpm > 0.965);
    const tank = `${(car.nitro * 100).toFixed(1)} 100`;
    if (tank !== this.shownNitro) {
      this.shownNitro = tank;
      this.nitroFill.setAttribute('stroke-dasharray', tank);
    }
    this.gauge.classList.toggle('n-on', car.boost);
    this.gauge.classList.toggle('n-surge', car.surge > 0);
    this.gauge.classList.toggle('n-full', car.nitro > NITRO.full);
    // Too little in the tank to start a boost (one already running may carry on down to empty).
    this.gauge.classList.toggle('n-low', !car.boost && car.nitro <= NITRO.minStart);

    // ---- laps ----
    this.t.lap.set(laps.started ? String(laps.count + 1) : '–');
    this.t.time.set(formatTime(laps.started ? laps.time : 0));
    this.t.last.set(formatTime(laps.last));
    this.t.best.set(formatTime(bests.lap));
    this.t.lapscore.set(score.lapPoints.toLocaleString('en-US'));
    this.t.total.set(score.total.toLocaleString('en-US'));

    // ---- hints: go away a few seconds after the driver starts moving ----
    if (driven && Math.abs(car.speed) > 8) this.hintTimer += dt;
    this.hint.classList.toggle('hide', this.hintTimer > 6 || mode !== 'manual');
    this.badge.classList.toggle('show', mode !== 'manual');
    this.t.badge.set(mode === 'demo' ? '漂移演示 · 按 O 退出' : 'AUTOPILOT');
  }
}
