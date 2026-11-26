# PlayCanvas 引擎能力与选型

> 结论：用 **`playcanvas` npm 包做纯代码开发（不用 Editor）+ Vite**，与 OVERDRIVE 同构。版本锁定 **2.24.x 稳定版**起步，需要 2.25 才有的 API（参考作品用的是 2.25.0-beta.5）时再整体升级到 2.25 正式版。物理不用 Ammo，自写街机车辆模型。

调研日期：2026-11-25。来源：[playcanvas/engine](https://github.com/playcanvas/engine)（MIT，约 1.7 万 star）、npm dist-tags、官方 examples 与 `scripts/esm`。

## 1. 版本

| 通道 | 版本 | 备注 |
| --- | --- | --- |
| latest | 2.24.3 | 2026-11-23 发布，起步用这个 |
| beta | 2.25.0-beta.13 | 参考作品用 2.25.0-beta.5 |
| lts | 1.77.0 | 旧 API，不考虑 |

API 演进快（几乎每周一个补丁版），`package.json` 用精确版本号，不用 `^`。升级前先读 release notes 再跑一遍视觉回归。

参考作品依赖的较新 API，逐个核对了 v2.24.3 标签的源码树（2026-11-25）：

| API | v2.24.3 |
| --- | --- |
| CameraFrame 可组合特效（slot、自定义 effect）、体积雾 | 有 |
| `dynamic-sky`、`lens-flare`、`auto-exposure`、`camera-frame-effect`、`blurred-planar-reflection` | 有（`src/extras/effects/*` 与 `scripts/esm/*`） |
| `StandardMaterial.planarReflectionMap` | 有 |
| `app.precompile()`（着色器预编译） | **没有**，只在 main 分支 → 先用手动预热，2.25 正式版后切换 |

## 2. 包结构与导入方式

```js
import * as pc from 'playcanvas';                                    // 核心
import { CameraFrame } from 'playcanvas';                            // 后处理管线（core 内）
import { LensFlareEffectScript } from 'playcanvas/scripts/esm/lens-flare.mjs';
import { BlurredPlanarReflection } from 'playcanvas/scripts/esm/blurred-planar-reflection.mjs';
import { CameraFrameEffectScript } from 'playcanvas/scripts/esm/camera-frame-effect.mjs';
```

- `exports` 提供 `production`/`development`(`playcanvas/debug`)/`profiler` 三种构建；开发期用 debug 构建能拿到断言和告警。
- `playcanvas/scripts/esm/*` 是随引擎版本发布的现成脚本，不在核心包里，按需 import。

## 3. 与本项目相关的能力清单

| 需求 | 引擎能力 | 对应官方示例 / 脚本 |
| --- | --- | --- |
| 设备 | WebGPU 优先、WebGL2 回退（`createGraphicsDevice` 传 `deviceTypes`） | 全部示例 |
| 车模加载 | glTF 2.0 container 资源，Draco（`dracoDecoder` WASM）、KTX2/Basis | `loaders/glb`、`demos/car-showcase` |
| 车漆 | `StandardMaterial` 清漆层 `clearCoat`/`clearCoatGloss`、金属度、各向异性 | `materials/clear-coat`、`car-showcase` |
| 车灯 | 自发光 + Bloom；示例里把灯材质亮度调到远超 glTF 值让它泛光 | `car-showcase` |
| 后处理 | `CameraFrame`：TAA、色散 fringing、CAS 锐化、景深 DOF、SSAO、体积雾、Bloom、colorEnhance、调色 grading、LUT、暗角；`rendering.renderTargetScale` 做动态分辨率；`toneMapping`；可挂自定义 effect | `camera-frame/*` 13 个示例 |
| 自定义后处理 | `CameraFrameEffectScript` 基类（`createEffect`/`updateEffect`） | `camera-frame/custom-compose-shader` |
| 镜头光晕 | `LensFlareEffectScript` + 内置形状库（glow_soft、halo、burst_star、anamorphic_streak 等） | `camera-frame/lens-flare` |
| 湿路反射 | `BlurredPlanarReflection`（带距离模糊的平面反射）、`PlanarRenderer` | `graphics/reflection-planar-blurred` |
| 天空 | `DynamicSky`（太阳位置与方向光同步、昼夜、云、光照分辨率）、`procedural-sky` | `camera-frame/dynamic-sky`、`graphics/procedural-sky` |
| 阴影 | 方向光级联阴影、软阴影、`shadow-catcher` | `lights-and-shadows/shadow-cascades`、`shadow-soft` |
| 雾 | 场景雾、地面雾 shader、体积雾（含光束） | `shaders/ground-fog`、`camera-frame/volumetric-fog*` |
| 植被 | 风动树 shader、实例化、多重绘制 | `shaders/trees`、`graphics/instancing-*`、`graphics-advanced/multi-draw-instanced` |
| 地形 | 程序化网格生成、视差地形、细节贴图 | `graphics/mesh-generation`、`materials/parallax-terrain`、`test/detail-map` |
| 胎痕 | 网格贴花 / 动态 trail mesh | `graphics/mesh-decals`、`graphics/mesh-deformation` |
| 粒子 | CPU `ParticleSystem`；WebGPU 下有 compute 粒子 | `particles/spark`、`particles/impact-effects`、`compute/particles` |
| 音频 | Web Audio 封装、3D 定位音 | `sound/positional` |
| 输入 | 键盘、鼠标、手柄、触摸 | `input/*` |
| 调试 | mini-stats、GPU 计时、线框/调试线 | `debug/mini-stats`、`debug/lines` |
| 物理（不采用） | Ammo.js 刚体 + `physics/vehicle` 射线车辆 | 手感难调，参考作品也没用 |

## 4. 两个值得照抄结构的官方示例

1. **`examples/src/examples/demos/car-showcase/`**（1155 行）：同样是"高质量车模 + 后处理"，示范了
   - `AssetListLoader` 批量加载 + Draco 解码配置；
   - 按材质名 `findMaterial(asset, name)` 覆盖 glTF 材质（车漆、玻璃、轮毂、卡钳、车灯）；
   - `envAtlas` 环境图 + `skyboxIntensity`；
   - `CameraFrame` 开 Bloom（`blurLevel=7`）、TAA（开 TAA 时 `samples=1`，否则 MSAA 4）；
   - `PlanarRenderer` 地面反射。
2. **`examples/src/examples/physics/vehicle/`**：射线车辆的输入、相机跟随写法，可作为对照，不采用其物理。

## 5. 选型决定与理由

| 决定 | 理由 |
| --- | --- |
| 纯代码，不用 PlayCanvas Editor | 与参考作品一致；便于 AI 协作、Git 管理、构建成静态站点 |
| Vite 打包，菜单代码与引擎分包 | 参考作品首屏只加载 7KB 菜单，点 Drive 才拉 1.8MB 主包，首屏快 |
| 自写车辆物理 | 漂移手感需要可调的街机模型（见 `docs/design/drift-gameplay.md`）；刚体物理调漂移成本高且不稳定 |
| 赛道用中心线样条程序化生成路面/路肩/护栏/广告板 | 参考作品如此；改赛道只改控制点，碰撞可以用"到中心线的横向距离"判定，几乎零成本 |
| WebGPU 优先 + WebGL2 回退 | 引擎两条后端都维护；着色器要同时给 GLSL 与 WGSL（参考作品自定义 shader 都写了两份） |
