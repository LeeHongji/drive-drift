// The shell around the game: start menu, loading screen, pause screen, credits, mute indicator.
// Plain DOM. This module is part of the entry chunk, so it must never import the engine or src/game.ts
// (types only); the game bundle is fetched by the `launch` callback that src/main.ts supplies.
//
// States: menu → loading → playing ⇄ paused, or loading → failed. Credits is a dialog on top of the menu
// or the pause screen. Wording lives in shell-text.ts, layout in shell.css.

import type { GameHandle } from '../game';
import {
  CREDITS,
  GAMEPAD_CONTROLS,
  KEY_CONTROLS,
  QUALITY_OPTIONS,
  TEXT,
  TIPS,
  TOUCH_CONTROLS,
  type QualityName,
} from './shell-text';

const SHELL = {
  /** Seconds each loading tip stays up, and the length of the fade between two tips. */
  tipInterval: 4.5,
  tipFade: 0.25,
  /** Seconds the loading screen takes to fade out; matches the `#loading` transition in hud.css, plus a margin. */
  loadingFade: 0.8,
  /** localStorage key for the quality chosen in the menu. */
  qualityKey: 'drive.quality',
  /** URL parameters that skip the menu and start at once (verification runs and direct links). */
  autostartParams: ['play', 'demo', 'autopilot', 'debug', 'cam'],
  /** URL parameters that mark a verification run: no auto-pause on blur, so background tabs keep running. */
  unattendedParams: ['demo', 'autopilot', 'debug', 'cam', 'nopause'],
  /** "Back to menu" reloads the page with this hash, which shows the menu even on an autostart URL. */
  menuHash: '#menu',
};

export interface ShellOptions {
  /** Empty container the shell builds its screens in. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The page's URL parameters. */
  params: URLSearchParams;
  /** Fetches the game bundle and starts it; `params` carries the quality chosen in the menu as `q`. */
  launch: (params: URLSearchParams, progress: (text: string, fraction: number) => void) => Promise<GameHandle>;
}

type State = 'menu' | 'loading' | 'playing' | 'paused' | 'failed';
type Child = Node | string;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = h('button', { type: 'button', class: className }, label);
  node.addEventListener('click', onClick);
  return node;
}

function link(label: string, url: string): HTMLAnchorElement {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function title(tag: 'h1' | 'h2', id?: string): HTMLElement {
  const [head, accent, tail] = TEXT.title;
  const node = h(tag, { class: 'shell-title', 'aria-label': TEXT.title.join('') }, head, h('em', {}, accent), tail);
  if (id) node.id = id;
  return node;
}

/** Storage can throw (private mode, sandboxed frames); the menu then simply forgets the choice. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

function isQuality(name: string | null): name is QualityName {
  return QUALITY_OPTIONS.some((o) => o.name === name);
}

/** The keyboard, gamepad and touch summary shown on the menu and the pause screen. */
function buildControls(): HTMLElement {
  const keys = h('dl', { class: 'shell-keys' });
  for (const row of KEY_CONTROLS) {
    const caps = h('dt');
    row.keys.forEach((k) => caps.append(h('kbd', {}, k)));
    if (row.alt) {
      caps.append(h('span', { class: 'or' }, '/'));
      row.alt.forEach((k) => caps.append(h('kbd', {}, k)));
    }
    keys.append(h('div', {}, caps, h('dd', {}, row.label)));
  }
  return h(
    'section',
    { class: 'shell-controls', 'aria-label': TEXT.controls },
    h('h3', { class: 'shell-label' }, TEXT.controls),
    // The stylesheet moves the touch line to the top on touch devices.
    h(
      'div',
      { class: 'shell-controls-body' },
      keys,
      h('p', { class: 'shell-device' }, h('b', {}, TEXT.gamepad), GAMEPAD_CONTROLS),
      h('p', { class: 'shell-device touch' }, h('b', {}, TEXT.touch), TOUCH_CONTROLS),
    ),
  );
}

/** Decorative only: a ribbon of track with two tyre marks, drawn behind the menu. */
const BACKDROP_SVG = `
<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <g fill="none" stroke-linecap="round">
    <path class="edge" d="M-120 800 C 380 720 520 380 860 400 S 1260 640 1720 100" />
    <path class="road" d="M-120 800 C 380 720 520 380 860 400 S 1260 640 1720 100" />
    <path class="mark" d="M-120 780 C 380 700 540 370 860 386 S 1250 610 1720 70" />
    <path class="mark" d="M-120 816 C 390 740 520 400 860 420 S 1270 660 1720 136" />
  </g>
</svg>`;

class Shell {
  private state: State = 'menu';
  private game: GameHandle | null = null;
  private muted = false;
  private quality: QualityName;
  private readonly autoPause: boolean;
  /** Keys whose press the shell consumed; their repeats and their release are kept away from buttons. */
  private readonly held = new Set<string>();

  private readonly menu: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly credits: HTMLElement;
  private readonly mutedBadge: HTMLElement;

  private readonly startButton: HTMLButtonElement;
  private readonly qualityButtons = new Map<QualityName, HTMLButtonElement>();
  private readonly qualityHint = h('p', { class: 'quality-hint', 'aria-live': 'polite' });
  private readonly stage = h('div', { class: 'stage', role: 'status' });
  private readonly meter = h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i'));
  private readonly tip = h('p', { class: 'tip-text' });
  private readonly resumeButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly creditsBack: HTMLButtonElement;
  /** What had the focus when credits opened, to give it back on close. */
  private creditsOpener: HTMLElement | null = null;
  private tipTimer = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor(private readonly opts: ShellOptions) {
    const { params, root } = opts;
    const fromUrl = params.get('q');
    const stored = readStored(SHELL.qualityKey);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.quality = isQuality(fromUrl) ? fromUrl : isQuality(stored) ? stored : coarse ? 'low' : 'normal';
    this.autoPause = !SHELL.unattendedParams.some((p) => params.has(p));

    this.startButton = button(TEXT.start, 'shell-start', () => void this.start(true));
    this.resumeButton = button(TEXT.resume, 'shell-btn', () => this.resume());
    this.soundButton = button(TEXT.soundOn, 'shell-btn', () => this.setMuted(!this.muted));
    this.creditsBack = button(TEXT.back, 'shell-btn', () => this.closeCredits());

    this.menu = this.buildMenu();
    this.loading = this.buildLoading();
    this.pauseScreen = this.buildPause();
    this.credits = this.buildCredits();
    this.mutedBadge = h('div', { id: 'muted', role: 'status', hidden: '' }, TEXT.muted, h('kbd', {}, 'M'));
    root.append(this.menu, this.loading, this.pauseScreen, this.credits, this.mutedBadge);
    this.selectQuality(this.quality, false);
    this.setMuted(false);

    // Capture phase: the shell sees keys before the game's own keyboard handler does.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    window.addEventListener('blur', () => {
      this.held.clear();
      if (this.autoPause) this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.autoPause) this.pause();
    });

    // "Back to menu" reloads with the menu hash, so the menu shows even when the URL would skip it.
    const forcedMenu = location.hash === SHELL.menuHash;
    if (forcedMenu) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        // The hash stays; the menu just keeps showing on reload.
      }
    }
    if (!forcedMenu && SHELL.autostartParams.some((p) => params.has(p))) {
      // Direct start: the URL alone decides the quality, as it did before the menu existed.
      void this.start(false);
    } else {
      this.setState('menu');
      this.menu.hidden = false;
      this.startButton.focus();
    }
  }

  // ---------- screens ----------

  private buildMenu(): HTMLElement {
    const options = h('div', { class: 'quality-options' });
    for (const o of QUALITY_OPTIONS) {
      const b = button(o.label, 'quality-option', () => this.selectQuality(o.name, true));
      this.qualityButtons.set(o.name, b);
      options.append(b);
    }
    const quality = h(
      'div',
      { class: 'quality', role: 'group', 'aria-labelledby': 'quality-label' },
      h('h3', { class: 'shell-label', id: 'quality-label' }, TEXT.quality),
      options,
      this.qualityHint,
    );
    const backdrop = h('div', { class: 'shell-backdrop' });
    backdrop.innerHTML = BACKDROP_SVG;
    return h(
      'section',
      { id: 'menu', class: 'shell-screen', 'aria-labelledby': 'menu-title', hidden: '' },
      backdrop,
      h(
        'div',
        { class: 'menu-layout' },
        h('header', { class: 'menu-head' }, title('h1', 'menu-title'), h('p', { class: 'shell-tagline' }, TEXT.tagline)),
        h('div', { class: 'menu-main' }, this.startButton, quality),
        h('div', { class: 'menu-side' }, buildControls()),
        h('footer', { class: 'menu-foot' }, button(TEXT.credits, 'shell-link', () => this.openCredits())),
      ),
    );
  }

  private buildLoading(): HTMLElement {
    return h(
      'section',
      { id: 'loading', 'aria-label': TEXT.loadingEngine, hidden: '' },
      title('h1'),
      this.meter,
      this.stage,
      h('div', { class: 'tip' }, h('span', { class: 'shell-label' }, TEXT.tip), this.tip),
    );
  }

  private buildPause(): HTMLElement {
    const actions = h(
      'div',
      { class: 'shell-actions' },
      this.resumeButton,
      button(TEXT.restart, 'shell-btn', () => this.restart()),
      this.soundButton,
      button(TEXT.credits, 'shell-btn', () => this.openCredits()),
      button(TEXT.toMenu, 'shell-btn', () => this.backToMenu()),
    );
    return h(
      'section',
      { id: 'pause', class: 'shell-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title', hidden: '' },
      h(
        'div',
        { class: 'pause-layout' },
        h('h2', { class: 'shell-heading', id: 'pause-title' }, TEXT.paused),
        actions,
        h('div', { class: 'pause-side' }, buildControls()),
      ),
    );
  }

  private buildCredits(): HTMLElement {
    const { model, engine, notice } = CREDITS;
    return h(
      'section',
      { id: 'credits', class: 'shell-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'credits-title', hidden: '' },
      h(
        'div',
        { class: 'credits-layout' },
        h('h2', { class: 'shell-heading', id: 'credits-title' }, TEXT.credits),
        h('h3', { class: 'shell-label' }, model.heading),
        h(
          'p',
          {},
          `${model.basedOn} `,
          link(`“${model.title}”`, model.titleUrl),
          `，${model.by} `,
          link(model.author, model.authorUrl),
          `，${model.under} `,
          link(model.licence, model.licenceUrl),
          ` ${model.licensed}`,
        ),
        h('p', {}, model.changes),
        h('h3', { class: 'shell-label' }, engine.heading),
        h('p', {}, link(engine.name, engine.url), '，', link(engine.licence, engine.licenceUrl), '。'),
        h('h3', { class: 'shell-label' }, notice.heading),
        h('p', {}, notice.body),
        this.creditsBack,
      ),
    );
  }

  // ---------- state ----------

  private setState(state: State): void {
    this.state = state;
    this.opts.root.dataset.state = state;
  }

  private selectQuality(name: QualityName, remember: boolean): void {
    this.quality = name;
    for (const [key, b] of this.qualityButtons) b.setAttribute('aria-pressed', String(key === name));
    this.qualityHint.textContent = QUALITY_OPTIONS.find((o) => o.name === name)?.hint ?? '';
    if (remember) writeStored(SHELL.qualityKey, name);
  }

  /** `fromMenu`: use the quality picked in the menu; otherwise leave the URL parameters as they are. */
  private async start(fromMenu: boolean): Promise<void> {
    if (this.state !== 'menu') return;
    this.setState('loading');
    this.closeCredits();
    this.menu.hidden = true;
    this.loading.hidden = false;
    this.progress(TEXT.loadingEngine, 0.08);
    this.startTips();

    const params = new URLSearchParams(this.opts.params);
    if (fromMenu) {
      params.set('q', this.quality);
      writeStored(SHELL.qualityKey, this.quality);
    }
    try {
      this.game = await this.opts.launch(params, (text, fraction) => this.progress(text, fraction));
    } catch (err) {
      this.fail(err);
      return;
    }
    if (this.muted) this.game.setMuted(true);
    this.setState('playing');
    this.loading.classList.add('done');
    window.setTimeout(() => {
      this.loading.hidden = true;
      this.stopTips();
    }, SHELL.loadingFade * 1000);
    if (this.autoPause && document.hidden) this.pause();
  }

  private progress(text: string, fraction: number): void {
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    this.stage.textContent = text;
    (this.meter.firstElementChild as HTMLElement).style.width = `${percent}%`;
    this.meter.setAttribute('aria-valuenow', String(percent));
  }

  private fail(err: unknown): void {
    console.error(err);
    this.setState('failed');
    this.stopTips();
    this.stage.textContent = '';
    const reload = button(TEXT.reload, 'shell-btn', () => location.reload());
    this.loading.append(
      h('div', { class: 'error', role: 'alert' }, `${TEXT.failed}${err instanceof Error ? err.message : String(err)}`),
      reload,
    );
    reload.focus();
  }

  private startTips(): void {
    this.tip.textContent = TIPS[this.tipIndex % TIPS.length];
    this.tipTimer = window.setInterval(() => {
      this.tip.classList.add('swap');
      window.setTimeout(() => {
        this.tipIndex++;
        this.tip.textContent = TIPS[this.tipIndex % TIPS.length];
        this.tip.classList.remove('swap');
      }, SHELL.tipFade * 1000);
    }, SHELL.tipInterval * 1000);
  }

  private stopTips(): void {
    window.clearInterval(this.tipTimer);
  }

  get paused(): boolean {
    return this.state === 'paused';
  }

  pause(): void {
    if (this.state !== 'playing' || !this.game) return;
    this.game.pause();
    this.setState('paused');
    this.pauseScreen.hidden = false;
    this.resumeButton.focus();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.game) return;
    this.closeCredits();
    this.pauseScreen.hidden = true;
    this.setState('playing');
    this.game.resume();
    this.opts.canvas.focus();
  }

  togglePause(): void {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  private restart(): void {
    if (!this.game) return;
    this.game.restart();
    this.resume();
  }

  private backToMenu(): void {
    try {
      history.replaceState(null, '', SHELL.menuHash);
    } catch {
      location.hash = SHELL.menuHash;
    }
    location.reload();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.game?.setMuted(muted);
    this.mutedBadge.hidden = !muted;
    this.soundButton.textContent = muted ? TEXT.soundOff : TEXT.soundOn;
    this.soundButton.setAttribute('aria-pressed', String(muted));
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private openCredits(): void {
    if (!this.credits.hidden) return;
    this.creditsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.menu.inert = true;
    this.pauseScreen.inert = true;
    this.credits.hidden = false;
    this.credits.scrollTop = 0;
    this.creditsBack.focus();
  }

  private closeCredits(): void {
    if (this.credits.hidden) return;
    this.credits.hidden = true;
    this.menu.inert = false;
    this.pauseScreen.inert = false;
    this.creditsOpener?.focus();
    this.creditsOpener = null;
  }

  // ---------- keyboard and focus ----------

  /** The screen that currently takes input, or null while the game (or the loading bar) has it. */
  topScreen(): HTMLElement | null {
    if (!this.credits.hidden) return this.credits;
    if (this.state === 'paused') return this.pauseScreen;
    if (this.state === 'menu') return this.menu;
    if (this.state === 'failed') return this.loading;
    return null;
  }

  private focusables(screen: HTMLElement): HTMLElement[] {
    return [...screen.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')].filter((el) => el.getClientRects().length > 0);
  }

  /** Move the focus to the next (+1) or previous (−1) control of the open screen, wrapping round. */
  navigate(dir: 1 | -1): void {
    const screen = this.topScreen();
    if (!screen) return;
    const items = this.focusables(screen);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (dir > 0 ? 0 : items.length - 1) : (at + dir + items.length) % items.length;
    items[next].focus();
  }

  /** Press the focused control of the open screen; with nothing focused, its first button (开始, 继续, 返回). */
  activate(): void {
    const screen = this.topScreen();
    if (!screen) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.focusables(screen).includes(focused)) focused.click();
    else screen.querySelector('button')?.click();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const swallow = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.repeat) {
      // A key that pressed a button must not go on to drive the car while it is still held.
      if (this.held.has(e.code)) swallow();
      return;
    }
    if (e.code === 'KeyM') {
      this.setMuted(!this.muted);
      swallow();
      return;
    }
    if (e.code === 'Escape') {
      if (!this.credits.hidden) this.closeCredits();
      else this.togglePause();
      swallow();
      return;
    }
    if (!this.topScreen()) return;
    switch (e.code) {
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'KeyW':
      case 'KeyA':
        this.navigate(-1);
        break;
      case 'ArrowDown':
      case 'ArrowRight':
      case 'KeyS':
      case 'KeyD':
        this.navigate(1);
        break;
      case 'Tab':
        // Keeps the focus inside the open screen.
        this.navigate(e.shiftKey ? -1 : 1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        // Links keep their native Enter behaviour (open in a new tab).
        if (e.code !== 'Space' && document.activeElement instanceof HTMLAnchorElement) {
          e.stopPropagation();
          return;
        }
        this.activate();
        break;
      default:
        return;
    }
    this.held.add(e.code);
    swallow();
  }

  private onKeyUp(e: KeyboardEvent): void {
    // Some browsers click a focused button on Space release; the press already did that.
    if (this.held.delete(e.code)) e.preventDefault();
  }
}

let shell: Shell | null = null;

/** Build the shell and show the menu, or start at once when the URL asks for it. Call once. */
export function initShell(opts: ShellOptions): void {
  shell ??= new Shell(opts);
}

// ---------- for the input layer (gamepad Start, touch pause button, D-pad in menus) ----------
// All of these are safe to call at any time; they do nothing when they do not apply.

/** Pause the running game, or resume it from the pause screen. */
export function togglePause(): void {
  shell?.togglePause();
}

export function pauseGame(): void {
  shell?.pause();
}

export function resumeGame(): void {
  shell?.resume();
}

/** True while the pause screen is up. */
export function isPaused(): boolean {
  return shell?.paused ?? false;
}

/** True while the menu, the pause screen or credits takes input, so driving input should be ignored. */
export function isMenuOpen(): boolean {
  return (shell?.topScreen() ?? null) !== null;
}

/** Move the focus within the open screen: +1 next, −1 previous. */
export function menuNavigate(dir: 1 | -1): void {
  shell?.navigate(dir);
}

/** Press the focused control of the open screen. */
export function menuActivate(): void {
  shell?.activate();
}

export function toggleMute(): void {
  shell?.setMuted(!shell.isMuted);
}
