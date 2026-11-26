# CLAUDE.md — 兰博基尼漂移赛车（代号 DRIVE）

浏览器端街机漂移赛车游戏。主车是后驱兰博基尼 **Huracán STO**，单车在山谷赛道上跑圈，按漂移距离 × 连击倍率计分。
引擎、架构和画面目标对标 OVERDRIVE（PlayCanvas 官方风格的 Claude artifact 作品），但代码、赛道、资产全部自己做。

**当前阶段：M1、M2 已完成（2026-11-25）；M3「可发布」的功能和性能优化已做完并验证（2026-11-26，记录见 `docs/verification/M3/README.md`），还差两项只有人能做的确认：听一遍声音、在真手机和真手柄上试一次。** 漂移手感已由项目负责人试玩确认。

## 文档索引（动手前先读对应文档）

公开仓库（GitHub `LeeHongji/drive-drift`，MIT）**不包含**：`docs/research/` 里除 `02-playcanvas-engine.md` 以外的文档、`reference/`、`assets-src/` 里的原始下载模型、`docs/verification/M2/00-compare-with-reference.jpg`（项目负责人 2026-11-26 决定，规则写在 `.gitignore`）。这些只在本地，新增同类材料也不要提交。

| 文档 | 内容 |
| --- | --- |
| `docs/research/01-reference-teardown.md` | OVERDRIVE 拆解：交付形态、资源清单、玩法规则、HUD、宣传片逐镜 |
| `docs/research/02-playcanvas-engine.md` | 引擎版本、能力清单、官方示例/脚本对照、选型理由 |
| `docs/research/03-inferred-prompt.md` | 原作构建方式与核心 prompt 推理、我们的主 prompt |
| `docs/research/04-screamer-video-study.md` | 《Screamer》（UE5）实机片段拆解：状态主题色、KO 反馈时序、HUD、环境引导，以及映射到本项目的升级方案（未实现）；关键帧在 `reference/screamer/` |
| `docs/research/vehicle.md` | 参考作品车辆物理/漂移/计分/氮气/音频源码逆向（原始数值） |
| `docs/research/world.md` | 参考作品赛道/地形/植被/光照源码逆向（原始数值） |
| `docs/research/rendering.md` | 参考作品渲染管线/相机/特效源码逆向（原始数值） |
| `docs/design/drift-gameplay.md` | **我们的**漂移手感、状态机、计分、氮气规则与参数表 |
| `docs/design/track-and-world.md` | **我们的**赛道设计、生成规则、场景与道具 |
| `docs/design/car-model-spec.md` | 车型选择、候选模型、节点/材质命名规范、预算、版权 |
| `docs/design/rendering-and-camera.md` | **我们的**后处理配置、画质档、相机、特效清单 |
| `reference/frames/` | 宣传片关键帧（仅内部视觉参考，不进构建） |
| `assets-src/car/README.md` | 已下载车模 A/B 的检查结果、轮组节点坐标、来源判断、署名文本、车模导入步骤 |
| `docs/verification/M1/README.md` | M1 验收记录：测试结果、手感场景实测值、截图、性能、已知不足 |
| `docs/verification/M2/README.md` | M2 验收记录：氮气实测值、与参考帧的并排对比、性能、没做或没验证的 |
| `docs/verification/M3/README.md` | M3 验收记录：三种输入各跑一圈、画质档实测、性能与内存优化的前后对比、没做或没验证的 |

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器，http://localhost:5183（引擎用调试构建，帧率偏低） |
| `npm test` | 全部单测和输入回放（Vitest） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | 类型检查 + 生产构建到 `dist/`；量性能用它（`npx vite preview`） |
| `npm run track:report` | 打印赛道长度、各段半径/坡度/间距，并写俯视 SVG。改 `src/config/track.ts` 后必跑 |
| `npx tsx scripts/track-sketch.ts out.svg` | 赛道还没闭合时先画草图 |
| `npm run car:build` | 从 `assets-src/car/A-…` 生成运行时车模 `public/assets/models/huracan-sto.glb` 和署名文件 |
| `node scripts/inspect-model.mjs <scene.gltf\|.glb> [--tree] [--all]` | 打印 glTF 的节点树、面数、尺寸、材质、贴图分辨率和轮子候选，零依赖。任何新模型进项目前先跑一遍 |

不带参数打开是主菜单。URL 参数：`?play` 跳过菜单直接开车，`?nopause` 失焦时不自动暂停（后台跑测量用），`?nowarm` 跳过着色器预热，`#menu` 强制回主菜单，`?demo` 漂移演示，`?q=low|normal|high|ultra` 画质档（默认：上次在菜单里选的；没选过时触屏 low、其余 normal），`?sky=static` 换回静态天空，`?debug` 调参面板 + mini-stats，`?autopilot` 沿中心线的自动驾驶，`?device=webgl2|webgpu` 指定后端，`?cam=aerial|trackside|orbit` 固定机位（`&s=` 路边机位的弧长，`&az=&dist=&h=` 环绕机位）。键盘：W/S/A/D 或方向键、空格漂移、N 或 Alt 氮气、R 重置、O 漂移演示、P 自动驾驶、Esc 暂停、M 静音。手柄：左摇杆、RT、LT、X 漂移、A 氮气、Y 重置、Start 暂停。带 `demo`、`autopilot`、`debug`、`cam` 任一参数时也会跳过菜单。

`docs/research/` 记录"参考作品是怎么做的"，`docs/design/` 记录"我们要怎么做"。两者冲突时以 `design/` 为准；改设计时同步改 `design/` 文档。

## 技术栈（锁定，改动需先更新本节）

- 引擎：`playcanvas` npm 包，纯代码，不用 PlayCanvas Editor。起步锁 **2.24.3 精确版本**（已核对：动态天空、镜头光晕、体积雾、自动曝光、平面反射、CameraFrame 自定义特效都有；只缺 `app.precompile()`，先手动预热着色器）。2.25 正式版发布后整体升级并做视觉回归。
- 官方脚本：按需从 `playcanvas/scripts/esm/*.mjs` 导入（`lens-flare`、`blurred-planar-reflection`、`camera-frame-effect`、`dynamic-sky` 等）。
- 构建：Vite，`base: './'`（产物必须能作为静态站点或 Claude artifact 发布）。菜单代码与引擎主包分包，点 Drive 后再动态导入主包。
- 语言：TypeScript（`strict`）。单测：Vitest，只测纯逻辑。
- 设备：WebGPU 优先，WebGL2 回退。自定义 shader 必须同时提供 GLSL 和 WGSL。
- 物理：**不用 Ammo**，自写街机车辆模型；碰撞用"相对赛道中心线的横向距离"判定。
- UI：HTML/CSS 覆盖层（HUD、菜单、加载、暂停），不用 PlayCanvas UI 组件。

## 目录结构

```
index.html         画布 + HUD 容器 + 加载页
src/
  main.ts          入口（轻量，不 import 引擎）：启动菜单外壳，点「开始」后动态导入主包
  game.ts          主包入口（动态导入）：建场景、主循环、`window.__game` 调试句柄
  config/          全部调参常量：sim / car / drift / scoring / nitro / camera / track / quality / render / post /
                   lens-effects / wet-road / world / vfx / audio / input
  core/            app 与设备创建、固定步长累加器、种子随机数、数学工具、每帧状态 FrameState、
                   上传后释放网格与贴图源数据（memory.ts）
  track/           段落表 → 中心线、赛道查询（投影、横向距离、曲率、倾角）、弯道识别。纯逻辑
  vehicle/         车辆物理、漂移状态机、氮气、变速箱。纯逻辑
  gameplay/        计分与连击、圈速、拾取碎片、Session（无渲染整体）、最佳成绩存储
  world/           天空与太阳、赛道网格、湿路面材质、地形（高度场、着色）、湖、植被、道具、防雪走廊
  render/          图层、后处理（CameraFrame）、路面平面反射、速度模糊与镜头水滴、车模表现、车灯
  vfx/             轮胎（啸叫、胎痕、胎烟）、氮气尾焰、擦墙火花、后轮水雾、碎片表现
  camera/          追车相机
  input/           键盘、手柄、触屏 → 统一输入状态（InputManager 合并三者；logic.ts 是纯逻辑）
  audio/           程序化音频（Web Audio，无音频文件）：合成（synth.ts）、映射（mapping.ts，纯逻辑）、音频图
  ui/              HUD（DOM + CSS）：漂移计数、仪表与氮气条、圈速、弯道提示、教学提示、演示按键显示；
                   外壳 shell（菜单、加载、暂停、致谢）、按设备换词的教学文案、触屏控件样式
  debug/           键盘式漂移机器人（演示 + 可玩性测试）、中心线自动驾驶、`?debug` 调参面板、固定验收机位
  types/           引擎 ESM 脚本的类型声明
public/assets/     运行时资产 + 每个第三方资产的署名 .txt（车模由 `npm run car:build` 生成）
assets-src/        原始资产（下载的原始模型），不进构建
scripts/           车模构建、模型检查、赛道报告与草图
tests/             Vitest 单测；`replay-runner.ts` + `replays/*.json` 是手感回放
docs/verification/ 各里程碑的验收记录、截图与性能数据
```

`vehicle/`、`track/`、`gameplay/` 不能 import 引擎，它们要能在 Node 里无渲染地跑（测试和回放靠这个）；`world/` 里的 `noise`、`layout`、`heightfield`、`terrain-shade`、`placement` 也是无引擎模块，`audio/` 的 `synth`、`mapping` 和 `input/logic` 同样如此。

画面系统的接法：每个系统导出一个创建函数，返回带 `update(frame: FrameState)` 的对象，在 `src/game.ts` 里加进 `systems` 数组；后处理必须排在最后，镜头效果排在它前面。

## 开发约定

- **坐标与单位**：Y 轴向上，车头朝 −Z；内部一律米、秒、弧度，km/h 只出现在 UI 层。
- **调参集中**：所有手感/计分/相机/画质数值放 `src/config/`，每个常量注释单位和含义；代码里不出现魔法数字。
- **模拟与渲染分离**：车辆与计分在固定步长里更新（**1/120 s，每帧最多 8 步**，定义在 `src/config/`），渲染插值；同样输入必须得到同样结果，便于单测和回放。
- **程序化生成要种子化**：赛道、地形、植被、广告板排布都用同一个种子 RNG，结果可复现。
- **赛道是唯一真相**：路面、路肩、护栏、广告板、拾取物、碰撞、圈速检查点都从同一条中心线派生；中心线由 `src/config/track.ts` 的直线/圆弧段落表生成，改赛道只改段落表，改完跑 `npm run track:report`。
- **弯道要和漂移模型配**：打满方向的漂移走线半径由车速决定（`drift-gameplay.md` 第 2.2 节）。新增或修改漂移弯时，半径取 35–75 m，弯后留 ≥ 130 m 直线（S 弯内部除外），改完必须让 `npm test` 里的 playability 测试（键盘式机器人 3 圈不碰墙）通过。调 `src/config/drift.ts` 或车的推力/刹车后同样要过这条测试。
- **图层**：除引擎的 World 层外有一个自定义的 Road 层（`src/render/layers.ts`），放路面、草、树、胎痕、车底阴影——这些不进路面的平面反射。普通灯用 `LIT_LAYERS`，只照地面的灯用 `ROAD_ONLY_LAYERS`。
- **画质档**：模块从 `QUALITY`（`src/config/quality.ts`）读阴影、反射、雾、草密度等，不要自己写死。
- **坐标符号**：偏航角绕 +Y，车头方向 = (−sin ψ, −cos ψ)，左转偏航角增大；赛道横向偏移 d 以左为正；输入的 steer 以右为正。
- **参考作品可以照着做，但不照搬原文**（项目负责人 2026-11-25 确认）：它的机制、公式、数值、实现思路都可以直接参考（`docs/research/` 里有），这样做得快；它的源码原文和美术/音频资产不复制，赛道、车、贴图用我们自己的。PlayCanvas 引擎自带的资源（如镜头光晕贴图，MIT）可以用。
- 每个第三方资产旁放同名 `.txt` 署名（作者、链接、许可证、改动）。不用 CC BY-NC 资产，除非项目负责人明确决定永不商用。
- 参考作品的源码与资源**没有也不应放进本仓库**；分析结论全部在 `docs/research/`。需要复查原始实现时，按 `docs/research/01-reference-teardown.md` 里的 artifact 链接重新获取，只放 `/tmp`。

## 环境注意

- 项目在 exFAT 外接盘上，macOS 会给每个文件生成 `._*` 元数据文件（已在 `.gitignore` 忽略）；不要把它们当成项目文件读取或提交。
- `dist/` 里也会出现 `._*` 文件（系统在写入时生成，不是构建产物）。发布前用 `dot_clean -m dist` 清掉，或把 `dist/` 复制到非 exFAT 盘再上传。
- exFAT 不支持符号链接和 Unix 权限位：`node_modules` 里依赖符号链接的工具（如 pnpm）可能出问题，包管理器用 npm。
- 浏览器页面不在前台时 `requestAnimationFrame` 会停，游戏不推进，实时测试的数据不可信。这时用 `window.__game.freeze(true)` 加 `step(n, 输入)` 按固定步数推进模拟（结果与实时一致），截图前等相机稳定约 1 秒。

## 验证要求

每条改动都要落到下面某一层验证上；报告时区分"已运行验证"（贴命令和输出/截图路径）和"只看过代码推断"。

| 层 | 验什么 | 怎么验 |
| --- | --- | --- |
| 1. 单测 | 纯逻辑：赛道查询、物理步进、漂移状态机、计分与连击、圈速与半圈检查点、氮气 | `npm test`（Vitest）。改这些代码必须跑并贴结果 |
| 2. 输入回放 | 手感回归 | `tests/replays/*.json` 存固定输入序列，无渲染地跑模拟，断言漂移角、漂移距离、圈速区间、是否撞墙。调参后全部回放必须仍在区间内，或者有意更新区间并说明原因 |
| 3. 浏览器实测 | 画面、手感、UI | `npm run dev` 后在浏览器打开，用调试句柄 `window.__game`（`state()` 读速度、漂移状态、连击、圈数、fps、draw call；`teleport`、`freeze`、`step`、`setCamera`、`setAutopilot` 摆出要验的场面）和固定机位截图，存到 `docs/verification/<里程碑>/`。WebGPU 和 WebGL2（`?device=webgl2`）都要看。只编译通过不算完成 |
| 4. 性能 | 帧时间 | 用生产构建，自动驾驶跑整圈逐帧采样；Normal 档在 Apple M1 级 Mac 上 60 fps。每个里程碑结束记录一次帧时间与 draw call（M1 基线：1080p 平均 8.3 ms、98–169 个 draw call；M2：平均 8.5 ms、338–595 个 draw call；M3：平均 8.4 ms、P99 9.4 ms、313–599 个 draw call、纹理显存 66–72 MB、JS 堆 21–65 MB；均为 Apple M5） |

两个机器人都是验证工具：
- **漂移演示**（O 键 / `?demo`，`src/debug/drift-bot.ts`）：只输出键盘能给的输入，用游戏教的手法漂移。它既是给玩家看的演示，也是"键盘能不能开"的自动化判据。
- **自动驾驶**（P 键 / `?autopilot`）：纯追踪中心线、不漂移，用来做机位截图。原计划发布构建去掉，现在还在（性能测量要用生产构建 + 调试句柄）；正式对外发布前再决定去掉还是藏到参数后面。

`window.__game.coDrive(fn)` 让漂移机器人只"报出想按什么"，由测试脚本转成真实的键盘、手柄、触屏事件，用来验证每种设备的整条输入路径（M3 的三种输入各跑一圈就是这么做的）。

量每帧垃圾和 GC 不要用 `performance.memory` 的差值（M3 里因此得出过一次错误结论），用 CDP 的 `HeapProfiler.startSampling` 按函数归因；堆大小只在全新、只加载过生产构建的页面上量。

## 里程碑（3 个垂直切片，每个结束都是能完整跑一圈的版本）

### M1 能漂起来的一圈（已完成，2026-11-25；同日做过手感返工）

范围：
- 工程：Vite + TS + PlayCanvas 2.24.3，WebGPU/WebGL2，固定步长循环，`src/config/` 集中调参，`window.__game` 调试句柄，`?debug` 调参面板。
- 赛道：段落表 → 中心线 → 路面/路肩/墙/起终点线/门架网格 → 赛道查询；3492 m，18 段，6 个漂移弯 + 3 个高速长弯，路宽 18 m（`track-and-world.md` 第 2.3 节）。
- 地面：临时的平滑山体（原计划是平整大平面，但赛道有 56 m 高差，平面上路会悬空）。
- 车：车模 A 经 `npm run car:build` 处理后接入（缩放 ×1.017、四轮 `Wheel_* → Spin`、车漆清漆、刹车灯、车底阴影）。
- 玩法：街机物理（算法与参考作品一致，推力/刹车用参考值）、漂移状态机、空格入漂缓冲、墙碰撞、计分与连击、圈速与半圈检查点、最佳成绩本地存储。
- 漂移教学与反馈：弯道提示（方向 + 建议入弯车速）、教学提示、漂移演示（O 键）、胎烟、胎痕。
- 相机与输入：追车相机（漂移朝向、随速 FOV、开场滑入、撞墙震动、不穿墙）；键盘。
- HUD：漂移计数（米、×N、1.5 s 倒计时条、入账/清零）、转速弧 + 挡位 + 速度、圈速面板、过线提示。

验收（证据见 `docs/verification/M1/README.md`）：
- [x] 单测覆盖赛道查询、漂移状态切换、计分、圈速判定（42 条全过）
- [x] 手感场景 F1–F8、F11、F12 写成回放或单测并通过；F9、F10 是氮气，归 M2
- [x] 键盘式机器人连跑 3 圈不碰墙，每个漂移弯全程保持漂移，S 弯连出 ×2
- [x] 自动驾驶能跑完整圈；俯视截图与赛道设计一致
- [x] WebGPU 与 WebGL2 都能跑
- [x] 项目负责人试玩确认漂移手感（2026-11-25）

没做的验证：Apple M1 级机器上的帧率（实测机是 M5）。

### M2 像参考作品一样好看（已完成，2026-11-25）

范围：
- 场景：噪声高度图地形（贴合赛道、远处白云岩山）、湖、实例化的草与树、虚构赞助商广告板、`>>` 牌、路灯、里程桩、桥墩、带拱窗和霓虹的防雪走廊。
- 光照与后处理：引擎动态天空（黄昏，太阳仰角 5°）、体积云、级联阴影、体积雾、自动曝光、CameraFrame（ACES、Bloom、暗角、调色、色散）、镜头光晕、速度模糊、镜头水滴。
- 湿路面：程序化沥青、光泽斑块、雨滴涟漪法线、平面反射。
- 特效：氮气尾焰、擦墙火花、后轮水雾、车灯。
- 氮气与拾取碎片（规则、HUD 氮气条、晶体表现）。

验收（证据见 `docs/verification/M2/README.md`）：
- [x] 氮气规则单测（消耗、回充、满罐冲刺、拾取），全部测试 87 条通过
- [x] 固定机位截图与 `reference/frames/` 并排对比（`docs/verification/M2/00-compare-with-reference.jpg`）
- [x] Normal 档整圈帧时间与 draw call 已记录：WebGPU 平均 8.5 ms、338–595 个 draw call（Apple M5）

留到 M3 的：着色器预热（现在首次喷氮气、首次擦墙会卡一下）。没做的：草和树的风摆、走廊里的体积光束。没验证的：Low / High / Ultra 三档的实际效果、Apple M1 级机器上的帧率。

### M3 可发布（功能完成，2026-11-26；两项验收待人确认）

范围：
- 音频：分层引擎声、事件音效、循环音、隧道混响。**全部程序化合成，没有音频文件**（不用找 V10 素材，也没有版权问题；代价是引擎声不是真实录音）。
- 流程：主菜单（开始、画质档、操作说明）、加载页（分阶段进度 + 提示）、暂停、按设备换词的教学提示、致谢页（车模署名）。
- 输入：手柄（含震动、暂停菜单导航）、触屏（左半屏拖动转向、自动油门、横屏提示）。
- 画质档菜单与四档实测、着色器预热、生产构建在静态托管上运行。
- 附加任务（项目负责人 2026-11-26 加入）：优化性能和内存占用。纹理显存 125 → 66–72 MB，每帧垃圾减少约四成，整圈不再现编着色器，P99 帧时间 16.7 → 9.4 ms。

验收（证据见 `docs/verification/M3/README.md`）：
- [x] 键盘、手柄、触屏各完整跑一圈（漂移机器人做决策，经真实的设备事件路径驱动；三圈都不碰墙）
- [x] 生产构建在静态托管上能跑
- [ ] Low 档在中端手机可玩——只在手机视口的桌面浏览器里验过，没有上真机
- [ ] 引擎声随转速平滑过渡，无爆音——整圈输出波形无削波、无硬跳变，全部测试 142 条通过，但没有人听过

没做的：自动驾驶和调试句柄没有从发布构建里去掉；草和树的风摆、走廊体积光束仍然没有。没验证的：真实手柄硬件、Apple M1 级机器上的帧率。已知但没改的性能点：路面反射相机会让阳光阴影多渲染一遍（见 M3 记录 4.4）。

发布后可选（不排进里程碑）：电影/回放相机、拍照模式、夜间版本、换色。

一次只做一个里程碑；里程碑内要加需求时先改本节。

## 待定决策（开工前由项目负责人确认）

1. ~~车型与车模~~：已定 **Huracán STO**，车模用候选 A（2026-11-25 下载并检查，见 `assets-src/car/README.md`）。两个候选来源都可疑，只适合非商业使用。
2. 游戏名与品牌露出：是否在标题/车标/车牌使用兰博基尼商标（影响后续能否商用）。
3. 发布形态：Claude artifact（像参考作品）还是独立静态站点。
