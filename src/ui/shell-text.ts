// Every player-facing string of the shell (menu, loading, pause, credits) lives here, so wording can be
// edited without touching layout or logic. Numbers quoted in the tips mirror src/config/ (drift.ts,
// scoring.ts, nitro.ts) and docs/design/drift-gameplay.md §2–§3: update them together.

import type { QualityPreset } from '../config/quality';

export type QualityName = QualityPreset['name'];

export const TEXT = {
  /** The title is drawn in three parts; the middle one takes the accent colour. */
  title: ['DR', 'I', 'VE'] as const,
  tagline: '山谷赛道 · 漂移计分',
  start: '开始',
  quality: '画质',
  controls: '操作',
  credits: '致谢',
  back: '返回',
  loadingEngine: '加载引擎',
  tip: '提示',
  failed: '启动失败：',
  reload: '重新加载',
  paused: '已暂停',
  resume: '继续',
  restart: '重新开始',
  soundOn: '声音：开',
  soundOff: '声音：关',
  toMenu: '返回菜单',
  muted: '已静音',
  gamepad: '手柄',
  touch: '触屏',
};

/** Menu order, left to right. `hint` is the one-line description shown under the selector. */
export const QUALITY_OPTIONS: { name: QualityName; label: string; hint: string }[] = [
  { name: 'low', label: '低', hint: '降低分辨率，关闭路面反射、体积雾和镜头特效。适合手机和集成显卡。' },
  { name: 'normal', label: '标准', hint: '路面反射和镜头特效开启，按屏幕的标准分辨率渲染。大多数电脑选这一档。' },
  { name: 'high', label: '高', hint: '1.5 倍分辨率，4 倍抗锯齿，草更密，云更细。' },
  { name: 'ultra', label: '极致', hint: '2 倍分辨率，最高的阴影、雾和云质量。需要独立显卡。' },
];

/** Keyboard controls: `keys` are drawn as key caps, `alt` as the alternative binding. */
export const KEY_CONTROLS: { keys: string[]; alt?: string[]; label: string }[] = [
  { keys: ['W', 'S'], alt: ['↑', '↓'], label: '油门 / 刹车' },
  { keys: ['A', 'D'], alt: ['←', '→'], label: '转向' },
  { keys: ['空格'], label: '漂移：按住方向，点一下' },
  { keys: ['N'], alt: ['Alt'], label: '氮气：按住喷射' },
  { keys: ['R'], label: '回到起点重来' },
  { keys: ['O'], label: '漂移演示' },
  { keys: ['Esc'], label: '暂停' },
  { keys: ['M'], label: '静音' },
];

/** One line each. Keep in step with what src/input/ actually binds. */
export const GAMEPAD_CONTROLS = '左摇杆转向 · RT 油门 · LT 刹车 · X 漂移 · A 氮气 · Y 重置 · Start 暂停';
export const TOUCH_CONTROLS = '自动油门 · 左半屏按住左右拖动转向 · 右侧按键刹车、漂移、喷氮气 · 请横屏';

/** Loading-screen tips, shown in this order starting from a random one. */
export const TIPS: string[] = [
  '入漂：按住朝弯心的方向键，同时点一下空格。车速要在 50 km/h 以上。',
  '漂移中按住方向是收紧走线，松开是放宽。油门一直踩着，有节奏地按、松，就能贴着弯走。',
  '屏幕上方的弯道提示给出建议入弯车速。提示变红就先刹车：太快时打满方向也收不住。',
  '出弯要提前松开方向。漂移角收回要将近 1 秒，这段时间车只走直线。',
  '一次漂移结束后 1.5 秒内再次入漂，连击倍率加 1，最高 ×5。连击结束时整串一次入账。',
  '连击还没入账时重撞护栏，整串分数清零。',
  '氮气满罐时起喷会触发冲刺，能冲过平时的极速。',
  '氮气不用时自动回充，漂移时回充快得多。',
  '赛道上的发光碎片每个补 1/5 罐氮气。',
];

/** Credits page. Links open in a new tab. */
export const CREDITS = {
  model: {
    heading: '车辆模型',
    /** CC BY 4.0 attribution: title, author, source, licence, and a notice of modification. */
    title: '2023 Lamborghini Huracán STO',
    titleUrl: 'https://sketchfab.com/3d-models/2023-lamborghini-huracan-sto-19c4d3f7679e4765ac1f9c3be12c0899',
    author: 'adrianaflak09',
    authorUrl: 'https://sketchfab.com/adrianaflak09',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    basedOn: '本作品中的车辆基于',
    by: '作者',
    under: '以',
    licensed: '许可发布。',
    changes:
      '已作修改：整体缩放 ×1.0171 以对齐实车轴距；原点移到轴距中心的地面；重建节点层级；材质重新命名；' +
      '尾灯和大灯拆出独立材质；静态网格按材质合并；在排气口添加标记节点。',
  },
  engine: {
    heading: '引擎',
    name: 'PlayCanvas Engine',
    url: 'https://github.com/playcanvas/engine',
    licence: 'MIT 许可',
    licenceUrl: 'https://github.com/playcanvas/engine/blob/main/LICENSE',
  },
  notice: {
    heading: '声明',
    body:
      '本作品是非商业性质的爱好者项目，与任何汽车制造商均无关联，也未获得其认可、赞助或授权。' +
      '文中出现的车型名称和标识归各自权利人所有，仅用于说明模型来源。',
  },
};
