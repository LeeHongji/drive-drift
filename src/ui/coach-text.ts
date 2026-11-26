// The teaching prompts, worded for the device in use (keyboard, gamepad, touch). `src/game.ts` decides
// which prompt applies; this file only supplies the words. HTML: <kbd> marks a key or button.

import type { InputDevice } from '../input/manager';

export interface CoachText {
  /** Shown during the drift demo (the demo drives with keyboard-style inputs). */
  demo: string;
  /** While drifting, the first few times. */
  hold: string;
  /** Right after a drift, until the player has linked two. */
  link: string;
  /** Approaching a drift corner too fast. */
  brake: string;
  /** Tank full on a straight. */
  nitro: string;
  /** Approaching a drift corner: `dir` > 0 is a left-hander. */
  entry: (dir: number) => string;
}

const side = (dir: number): string => (dir > 0 ? '左' : '右');

export const COACH_TEXT: Record<InputDevice, CoachText> = {
  keys: {
    demo: '看左下角按键：<kbd>按住方向</kbd> + 点<kbd>空格</kbd>入漂 · 按住收紧 · 松开放宽',
    hold: '按住方向 = 收紧走线 · 松开 = 放宽 · <kbd>W</kbd> 油门别松',
    link: '1.5 秒内再次入漂 → 连击倍率 +1',
    brake: '太快了：先踩 <kbd>S</kbd> 减到提示车速再入弯',
    nitro: '氮气满了：直道上按住 <kbd>N</kbd> 喷射，满罐起喷冲得更快',
    entry: (dir) => `入弯：按住 <kbd>${dir > 0 ? 'A' : 'D'}</kbd> 朝弯心，同时点一下 <kbd>空格</kbd>`,
  },
  pad: {
    demo: '看左下角按键：<kbd>按住方向</kbd> + 点一下漂移键入漂 · 按住收紧 · 松开放宽',
    hold: '推住摇杆 = 收紧走线 · 回中 = 放宽 · <kbd>RT</kbd> 油门别松',
    link: '1.5 秒内再次入漂 → 连击倍率 +1',
    brake: '太快了：先按 <kbd>LT</kbd> 减到提示车速再入弯',
    nitro: '氮气满了：直道上按住 <kbd>A</kbd> 喷射，满罐起喷冲得更快',
    entry: (dir) => `入弯：摇杆推向${side(dir)}朝弯心，同时点一下 <kbd>X</kbd>`,
  },
  touch: {
    demo: '演示：按住方向 + 点一下漂移入漂 · 按住收紧 · 松开放宽',
    hold: '手指拖住 = 收紧走线 · 回中 = 放宽 · 油门是自动的',
    link: '1.5 秒内再次入漂 → 连击倍率 +1',
    brake: '太快了：先按 <kbd>刹车</kbd> 减到提示车速再入弯',
    nitro: '氮气满了：直道上按住 <kbd>氮气</kbd> 喷射，满罐起喷冲得更快',
    entry: (dir) => `入弯：向${side(dir)}拖住朝弯心，同时点一下 <kbd>漂移</kbd>`,
  },
};
