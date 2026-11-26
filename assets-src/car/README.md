# 车模原始资产（Huracán STO）

> 结论：**游戏用 A**（4.88 万面、四轮独立、车头已朝 −Z）。B 保留作高精度参考，不进游戏构建。两者都是 Sketchfab 上的 CC BY 4.0 免费模型，来源都可疑，**只适合非商业使用**；商业发布前必须换成来源清楚、带商用授权的模型。

检查日期 2026-11-25，检查命令：`node scripts/inspect-model.mjs <scene.gltf> [--tree] [--all]`。

## 目录

```
car/
├── A-adrianaflak09-sto-2023/
│   ├── downloads/2023_lamborghini_huracan_sto.zip   原始下载（.gitignore 忽略）
│   └── gltf/  scene.gltf  scene.bin  textures/  license.txt
└── B-supercarmodels-sto-2021/
    ├── downloads/2021_lamborghini_huracan_sto.zip
    └── gltf/  scene.gltf  scene.bin  textures/  license.txt
```

## 检查结果对比

| 项 | A：adrianaflak09 "2023 Huracán STO" | B：DisneyCars (@supercarmodels) "2021 Huracán STO" |
| --- | --- | --- |
| 三角面 / 顶点 | 48,753 / 47,939 | 246,279 / 193,201 |
| 大小 | 几何 2.1 MB，解压后共 6 MB | 几何 11.8 MB，解压后共 33 MB |
| 尺寸（长 × 宽含后视镜 × 高） | 4.46 × 2.19 × 1.20 m | 4.52 × 2.22 × 1.21 m |
| 朝向 | 车头 **−Z**、右侧 +X（与 PlayCanvas 一致），左舵 | 车头 **+Z**，需转 180° |
| 轮子 | **4 个独立轮组节点**，各含轮胎 + 轮毂；枢轴在轮毂外侧安装面，绕局部 X 轴可直接滚动；右侧为绕 Y 转 180°（非负缩放） | 4 个轮毂合成 1 个网格，轮胎、刹车同样合并，需在 Blender 拆分 |
| 卡钳/刹车盘 | 合在车身底部 `misc` 网格里，不随转向 | 合在 `BF_BRAKING_FEELING_CCMR` 一个网格里 |
| 方向盘 | 独立节点 `LOD_A_STEERING_WHEEL_mm_cab_45`，可随转向转动 | 在内饰网格里 |
| 内饰 | 简化内饰 | 完整内饰（约 13 万面） |
| 材质 | 11 个；**只有底色贴图**（多为 512²，车身 1024²），没有法线/金属度/粗糙度贴图；玻璃用 `KHR_materials_transmission` | 12 个；完整 PBR（底色 + 金属粗糙度 + 法线，车灯/碳纤维有自发光），车身底色 4096² |
| 涂装 | 蓝（Blu Laufey）+ 橙饰件，画在车身图集里 | 同款涂装，画在车身图集里 |
| 车灯 | `lights` 图集含 Y 形尾灯 | `mat_fanali` 含 Y 形尾灯与自发光贴图 |
| 车轮尺寸（缩放后） | 前轮直径 0.67 m、宽 0.23 m；后轮 0.70 m、宽 0.30 m | — |
| 与实车比例 | 轴距 2.576 m，实车 2.620 m，**整体 ×1.017** 即可对齐 | 接近 1:1 |

A 的四个轮组节点（世界坐标，缩放前）：

| 节点 | 位置 (x, y, z) | 缩放 |
| --- | --- | --- |
| `Wheel_50`（左前） | (−0.949, 0.342, −1.154) | 1.115 |
| `Wheel (1)_53`（右前） | (0.954, 0.342, −1.154) | 1.115，绕 Y 180° |
| `Rear Wheels_56`（左后） | (−0.970, 0.344, 1.422) | 1.168 |
| `Rear Wheels (1)_59`（右后） | (0.956, 0.344, 1.422) | 1.168，绕 Y 180° |

轮胎几何中心在节点原点向车内约 0.11–0.15 m 处。导入时要在轮胎中心新建 `Steer` 父节点，转向绕它转；滚动仍绕原节点的局部 X 轴。

## 来源判断（推断，未能证实）

- **A**：贴图名带 `.etc` 后缀（ETC 是手机 GPU 贴图压缩格式），有 `car_tyre_tread_pirelli_02`、`car_chassis`、`car_windows_02` 这类通用共享贴图，节点名是 `LOD_A_TYRE_mm_tyre`。内部命名是 "2021_lamborghini_huracan_sto"，标题却写 2023，用 Unity 上传。这些特征都像是**从手机赛车游戏里提取的资产**。
- **B**：材质和部件名全是意大利语（`mat_carrozzeria`、`COFANGO`、`PORTA_SX`、`BF_BRAKING_FEELING_CCMR`），和 2021 年 Raakesh.Madan_Lamboguy 上传的模型面数几乎相同；那一份的描述指向兰博基尼官方配置器。像是**从官方配置器提取的资产被转载**。
- 两者都带兰博基尼车标、"Lamborghini" 字样和 STO 标识（商标问题见 `docs/design/car-model-spec.md` 第 5 节）。

## 署名（CC BY 4.0 要求，随游戏致谢页发布）

A（游戏使用）：

> This work is based on "2023 Lamborghini Huracán STO" (https://sketchfab.com/3d-models/2023-lamborghini-huracan-sto-19c4d3f7679e4765ac1f9c3be12c0899) by adrianaflak09 (https://sketchfab.com/adrianaflak09) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

B（仅参考，若以后用到再署名）：

> This work is based on "2021 Lamborghini Huracán STO" (https://sketchfab.com/3d-models/2021-lamborghini-huracan-sto-711ebe61062646508dc6cf4deeff0c97) by DisneyCars (https://sketchfab.com/supercarmodels) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## 导入（M1 已完成）

`npm run car:build`（`scripts/build-car.mjs`）读 `A-adrianaflak09-sto-2023/gltf/scene.gltf`，写出 `public/assets/models/huracan-sto.glb`（2.35 MB，未压缩）和同名署名 `.txt`。它做的事：

1. 整体缩放 ×1.0171（按轮胎网格实测轴距对齐 2.62 m），原点移到轴距中点的地面上。
2. 重建层级 `Car → Body`、`Car → Wheel_FL|FR|RL|RR → Spin`，轮组枢轴在轮胎中心。转向转 `Wheel_*`，滚动转 `Spin`（绕车身 X 轴，四个轮子同向）。
3. 材质改名为 `Paint`、`Trim`、`Cabin`、`Chassis`、`GlossBlack`、`Glass`、`Badge`、`Lights`、`Tyre`、`Rim`、`Chrome`；尾灯和大灯网格拆出 `Light_Tail`、`Light_Head`。
4. 去掉玻璃的 transmission 扩展；车身静态网格按材质合并（57 个网格 → 19 个）。
5. 按排气管网格的位置加两个空节点 `Exhaust_L`、`Exhaust_R`（+Z 朝后），给氮气尾焰定位。

处理后实测：长 4.54 m、高 1.22 m；前轮中心 (∓0.85, 0.352, −1.31)、半径 0.338 m；后轮中心 (∓0.83, 0.354, 1.31)、半径 0.354 m；前轮距 1.707 m、后轮距 1.656 m。

运行时的材质覆盖（清漆车漆、半透明玻璃、车灯自发光、刹车时尾灯提亮）在 `src/render/car-visual.ts`。

还没做的：Draco 和贴图压缩（M3 发布前）、涂装改色（发布后可选）。
