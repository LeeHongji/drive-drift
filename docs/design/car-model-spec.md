# 车模规范：兰博基尼

> 结论：主车**已定为 Huracán STO**，游戏车模**已选定候选 A**（adrianaflak09，4.88 万面，四轮独立，车头朝 −Z），2026-11-25 下载并检查完毕，检查记录与署名见 `assets-src/car/README.md`。B（24.6 万面）只作高精度参考。两者来源都可疑，只适合非商业使用。导入时整理节点、覆盖材质，再用 glTF-Transform 做 Draco 压缩；轮子要有转向/滚动两级节点且枢轴在轮心，车漆、玻璃、尾灯、刹车灯必须是可按名字找到的独立材质。

## 1. 参考作品的做法（保时捷 911）

| 项 | 值 |
| --- | --- |
| 来源 | Sketchfab "(FREE) Porsche 911 Carrera 4S"，CC BY-SA 4.0，署名文件随模型发布 |
| 处理 | glTF-Transform v4：Draco 压缩，贴图（10 张 PNG）和 buffer 全部 base64 内嵌进一个 `.json` |
| 规模 | 65.3 万三角面，45 个 mesh，79 个节点，5.4MB |
| 坐标 | 原始 Z-up，根节点绕 X 轴 −90° 转成 Y-up，缩放 0.578 |
| 材质 | `paint`、`coat`(半透明清漆壳)、`silver`(清漆)、`plastic`、`rubber`、`full_black`、`glass`/`window`(清漆+半透明)、`lights`(透射)、`tex_shiny`(带自发光贴图，灯组)、`license`(车牌)、`logo`、`Material.001`(橙色卡钳) |
| 轮子 | 只有两个节点：`Cylinder.001` = 前轴、`Cylinder.000` = 后轴，每个节点把同一轴的左右两个轮子合在一个网格里（子网格：轮毂 `silver`、`plastic`、轮胎 `rubber`、卡钳 `Material.001`）。游戏运行时按三角形质心 X 拆成左右，用轮胎顶点质心定轮心、PCA 定转向轴、`轮心Y − 最低Y` 定半径，建 `Steer → Spin` 两级节点，卡钳挂 `Steer`（随转向不随滚动）（`rendering.md` §8.1） |
| 游戏内改动 | 按材质名覆盖：车漆漫反射 (0.4, 0.004, 0.01)、金属度 0、光泽 0.62、清漆 1 / 清漆光泽 0.97；禁用模型自带的 `coat` 清漆外壳网格；玻璃保留满强度反射；按"同刚体框架 + 同材质"合并子网格降 draw call；`bumper_front.004_1` 只用来定位大灯聚光灯，`tex_shiny`/`license` 被克隆出刹车灯、倒车灯、牌照灯效果 |

教训：Sketchfab 模型的节点名多半是 `boot.011_0` 这种无意义名字，轮子也常和车身合并。**导入前一定要在 Blender 里整理**，不要在运行时靠 mesh 名硬编码去拆。

## 2. 车型选择

**已选：Huracán STO。** 后驱 V10，赛道化外观（大尾翼、鲨鱼鳍、发动机盖进气口），首发涂装是蓝色车身配橙色饰件。

| 车型 | 驱动 | 状态 | 说明 |
| --- | --- | --- | --- |
| **Huracán STO** | 后驱 V10 | **主车** | 后驱贴合漂移题材 |
| Huracán Tecnica | 后驱 V10 | 备选 | STO 模型都不合格时的退路（候选：sohyalebret 的 2022 Tecnica，21.8 万面，CC BY） |
| Revuelto / Aventador | 四驱 V12 | 不做主车 | 可作为后续解锁车 |

官方规格（[Huracán STO 车型页](https://admin.www.lamborghini.com/en-en/models/huracan/huracan-sto)、[Huracán Tecnica 历史页](https://www.lamborghini.com/en-en/history/huracan-tecnica)，2026-11-25 查阅）：

| 项 | Huracán STO | Huracán Tecnica |
| --- | --- | --- |
| 发动机 | 5.2L 自吸 V10，640 CV (470 kW) @ 8000 rpm，565 N·m @ 6500 rpm | 同左 |
| 驱动 | 后驱 | 后驱 |
| 干重 | 1339 kg，前后配重 41/59 | 1379 kg |
| 尺寸 | 长 4549 / 宽 1945（不含后视镜）/ 高 1220 / 轴距 2620 mm | 轴距 2620 mm |
| 性能 | 0–100 km/h 3.0 s，0–200 km/h 9.0 s，极速 310 km/h；100–0 制动 30 m，200–0 制动 110 m | 0–100 km/h 3.2 s，极速 325 km/h |

这些数值作为物理调参的"真实感锚点"（加速曲线、极速、制动距离），游戏内为了手感可以偏离，但偏离要在 `src/config/car.ts` 里写明。

## 3. Huracán STO 候选模型（Sketchfab，可下载，2026-11-25 通过公开 API 查询元数据并看过缩略图）

| 优先级 | 模型 | 作者 | 面数 / 顶点 | 材质 / 贴图 | 许可 | 判断 |
| --- | --- | --- | --- | --- | --- | --- |
| A | [2023 Lamborghini Huracán STO](https://sketchfab.com/3d-models/19c4d3f7679e4765ac1f9c3be12c0899) | adrianaflak09 | 48,753 / 28,525 | 11 / 9 | CC BY | 缩略图质量好（首发涂装、Y 形灯、碳纤维件），标签 Unity，像游戏用资产；面数低，Web 性能最好。来源未核实 |
| B | [2021 Lamborghini Huracán STO](https://sketchfab.com/3d-models/711ebe61062646508dc6cf4deeff0c97) | supercarmodels | 246,390 / 144,037 | 12 / 38 | CC BY | 细节最高，金属度 PBR。**与下一行是同一模型**（面数、顶点、材质数几乎相同，缩略图同款涂装） |
| B' | [Lamborghini Huracan STO 2020](https://sketchfab.com/3d-models/1d10481ff96246d4b67242bddd394d43) | Raakesh.Madan_Lamboguy | 246,174 / 143,721 | 12 / 27 | CC BY | 2021 年上传，B 的更早版本；描述引导去兰博基尼官方配置器，**疑似从官方配置器/AR 资产提取**，许可链不可靠 |

不用的：
- [ddiaz-design 2021 STO](https://sketchfab.com/3d-models/ca6dced4db01401ab52ae4b531c167f1)（243,671 面）：CC BY-NC，禁止商用。
- [tangwang920 2021 STO](https://sketchfab.com/3d-models/bf8b339e4f1440fa981d7913bf4cac1e)（242,778 面，2026-10-30 上传）：面数/顶点与 ddiaz-design 那份几乎相同却标 CC BY，疑似转载后改了许可证。
- awesomeonion（272,683 面，无贴图）、MattDoesBlender（56,819 面，材质异常）、LolAndPop（1,979 面的 PS1 风格）、DR1KING100K（82 万面直线加速改装版）。

验收结果（2026-11-25，`node scripts/inspect-model.mjs`）：

| 检查项 | A（采用） | B（参考） |
| --- | --- | --- |
| 四轮独立 | 是，枢轴在轮毂安装面 | 否，四轮合成一个网格 |
| 朝向 | 车头 −Z，与引擎一致 | 车头 +Z |
| 面数 | 48,753 | 246,279（内饰约 13 万） |
| 材质 | 只有底色贴图（512²–1024²） | 完整 PBR（车身 4096²） |
| 比例 | 整体 ×1.017 对齐实车轴距 | 约 1:1 |
| 来源 | 疑似手机游戏提取资产 | 疑似官方配置器资产转载 |

A 的短板是材质：没有法线和粗糙度贴图，画面质感要靠我们的车漆清漆层、环境反射和后处理来补；需要时可以从 B 烘焙法线贴图给 A（同一车型，外形一致）。详细数据、轮组节点坐标和导入结果（M1 已用 `npm run car:build` 完成）见 `assets-src/car/README.md`。

无论用哪个，商业发布前都不能依赖 Sketchfab 上的 CC BY 标签：要么购买有商用授权且来源清楚的模型，要么自建/委托建模（另见第 5 节商标问题）。

## 4. 交付规范（导入游戏前必须满足）

### 4.1 坐标与尺度
- Y-up，车头朝 **−Z**（PlayCanvas 实体的 forward），单位米，原点在**两后轮接地点连线中点**投影到地面（或四轮接地矩形中心，二选一后写进 `src/config/car.ts`）。
- 真实尺寸：车长、轴距、轮距要与实车一致（误差 < 2%），物理参数从这些尺寸取。

### 4.2 节点层级（命名固定，运行时按名字找）

```
Car
├── Body              车身（可多个 mesh，挂在 Body 下）
├── Wheel_FL          枢轴=轮心，X 轴为滚动轴
│   ├── Rim           轮毂（随轮转）
│   └── Tyre          轮胎（随轮转）
├── Wheel_FR / Wheel_RL / Wheel_RR   同上
├── Caliper_FL ...    卡钳（随转向，不随滚动）—— 四个，挂在车身下与轮心同位
├── Lights_Head       大灯发光体
├── Lights_Tail       尾灯
├── Lights_Brake      刹车灯（刹车时提亮）
├── Exhaust_L / Exhaust_R   空节点，标记排气口位置与朝向（尾焰、回火）
└── Wing              尾翼（可选，用于高速微动/下压力可视化）
```

M1 的实际层级（`npm run car:build` 的输出）比上面精简：

```
Car
├── Body              每种材质一个合并网格：Body_Paint、Body_Trim、Body_Glass、Body_Light_Tail …
└── Wheel_FL / Wheel_FR / Wheel_RL / Wheel_RR   枢轴=轮胎中心，转向转这一级
    └── Spin          滚动转这一级（绕 X 轴）；下面是 Tyre 和 Rim 两个网格
```

和目标层级的差别：车灯按材质区分（`Light_Tail`、`Light_Head`、`Lights`），没有单独节点；卡钳和刹车盘在原模型里并进了车身饰件网格，不随转向；没有 `Wing` 节点。`Exhaust_L/R` 两个空节点已在 M2 加上（挂在 `Car` 下，+Z 朝后），位置由构建脚本从排气管网格算出：(∓0.35, 0.572, 2.091)，管口半径 0.054 m。

### 4.3 材质（命名固定）

| 材质名 | 用途 | 游戏内处理 |
| --- | --- | --- |
| `Paint` | 车漆 | 运行时改色；开清漆 `clearCoat≈1`、`clearCoatGloss≈0.9`；金属漆 metalness 0.5–0.9 |
| `Carbon` | 碳纤维件 | 带法线/各向异性 |
| `Glass` | 车窗 | 半透明 + 清漆，深色 |
| `Light_Head` / `Light_Tail` / `Light_Brake` | 灯 | 自发光强度远高于 glTF 值（> 1）让 Bloom 起作用，刹车时提亮 |
| `Rim` | 轮毂 | 金属，可换色 |
| `Tyre` | 轮胎 | 侧壁可带字样贴图 |
| `Caliper` | 卡钳 | 可换色（参考作品为亮黄） |
| `Plate` | 车牌 | 贴图，内容自定，不用真实车牌 |
| `Badge` | 车标 | 见第 5 节版权 |

### 4.4 预算

| 项 | 目标 | 上限 |
| --- | --- | --- |
| 三角面（含轮子） | 20–30 万 | 65 万（参考作品水平） |
| 贴图 | 2K 以内，KTX2/WebP | 总显存 64MB |
| 文件 | Draco + 贴图压缩后 ≤ 8MB | 12MB |
| 材质数 | ≤ 16 | 24 |
| Draw call（整车） | ≤ 40 | 60 |
| LOD | 菜单/近景用 LOD0；远景（航拍、回放）可用 LOD1（50%） | — |

### 4.5 处理流水线

1. Sketchfab 下载 glTF（用户账号） → `assets-src/car/<model>/`（原始文件不进构建）。
2. 整理层级：拆四轮并把枢轴设到轮心、合并同材质小件、按 4.2/4.3 重命名、核对尺寸和朝向。车模 A 结构规整，这一步由 `scripts/build-car.mjs` 用 glTF-Transform 自动完成，没用 Blender；结构乱的模型（如候选 B）仍需在 Blender 里手工整理。
3. glTF-Transform：`dedup` → `join` → `prune` → 输出到 `public/assets/models/`（M1 现状）。`draco` 和贴图转 WebP/KTX2 留到 M3 发布前。
4. 署名文件 `<model>.txt`：作者、来源链接、许可证、修改说明，随构建发布，并在游戏"关于/致谢"里展示。
5. 用 `node scripts/inspect-model.mjs <输出.glb> --tree` 打印节点树、三角面、材质列表，作为导入验收。

## 5. 版权与商标

- "Lamborghini"、车标（公牛盾徽）、车型名（Huracán、STO 等）、车身外观都属于汽车厂商的商标/外观权利。**非商业的个人作品**通常风险较低；**任何商业化发布**（上架、收费、广告变现）都需要厂商授权。
- 模型许可证与商标是两回事：CC BY 只授权了模型作者自己的建模工作，不授权兰博基尼品牌。
- 降低风险的做法：车标贴图换成自制标志、车牌用虚构内容、游戏标题不使用 "Lamborghini" 字样（可以叫 "V10 Drift" 之类），这一点由项目负责人决定。
