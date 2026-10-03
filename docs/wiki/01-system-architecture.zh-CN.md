# 01 · 系统架构与数据流

[English](./01-system-architecture.md) | [简体中文](./01-system-architecture.zh-CN.md)

## 直观理解

系统先在球面上决定“哪里有板块、陆地和山”，然后计算“各月哪里冷、哪里下雨”，最后从降水推得河流和生物群系。3D 地球与 2D 地图只是这份球面数据的两种画法。

## 生成流水线

[Worker 入口](../../src/core/simulation/worker/simulation.worker.ts) 将阶段按下表顺序加入 `PipelineScheduler`。一个阶段完成后，下一个阶段读取其结果；UI 收到阶段进度和耗时。

| 阶段 | 主要工作 | 输出位置 |
| --- | --- | --- |
| `MeshGeneration` | 构建参考和输出网格、区域映射 | `mesh`、`referenceMesh`、`outputToReference` |
| `PlateTectonics`、`SuperPlates` | 细板块、候选大陆、地壳、超级板块 | 中间上下文 |
| `Projection`、`Tectonics` | 投射宏观属性，计算边界、地幔与构造场 | 中间上下文 |
| `ElevationAndTerrain` | 构造高程、纹理、后处理、最终海陆 | `data.geology`、`data.geography` |
| `SeasonalCirculation` | 四个季节锚点的风、气压、表层洋流 | `data.climate.circulation` |
| `MonthlyClimate` | 12 个月气温与降水 | `data.climate.monthly` |
| `ClimateOutputProjection` | 将气候场投到输出网格 | `outputProjection` / `outputMonthly` |
| `KoppenClimate`、`Biome` | 柯本气候和生物群系分类 | `koppen`、`data.biome` |
| `SurfaceHydrology` | 年有效径流、排水图、河网 | `data.hydrology` |

### 两种空间尺度

参考网格固定为 Icosphere Level 6，含 40,962 个区域。输出网格由细节参数决定。当地形分辨率高于参考网格时，气候在参考网格上求解，再按最终海陆与高程投到输出网格；河网始终在输出网格上求解。参考网格的宏观地质映射会扰动边界，气候映射则按地理位置采样，二者用途不同。

## 数据契约

[世界状态类型](../../src/core/simulation/state.ts) 把结果分为 `geology`、`geography`、`climate`、`biome`、`hydrology`。大规模逐区域数据使用 `Float32Array`、`Uint8Array` 等连续数组；区域索引在同一网格内对应同一个位置。

- `candidateLandMask` 是构造地形前的候选海陆；`landMask` 由处理后的高程确定，是气候与水文使用的最终海陆。
- 地表高程和地形增量对外用 **km**；月降水用 **mm/月**，月温度用 **°C**；水文 `discharge` 用 **m³/s**。
- 风和洋流的东西、南北分量是**相对输送强度**，不是 m/s；`oceanWarmth` 是 −1 到 1 的温度异常代理量，不是 °C。
- 季节数组按“季节 × 区域”排列，月度数组按“月份 × 区域”排列；月份 0 表示 1 月。

主线程每次生成都会新建 Worker。完成时通过可转移 `ArrayBuffer` 交付结果，并恢复网格对象的访问方法。只切换图层、月份或视图时复用生成结果；改变生成参数会重新生成。代码入口分别见 [SimulationCore](../../src/core/world/simulation-core.ts) 和 [WorldEngine](../../src/core/world/world-engine.ts)。

## 可重复性与限制

随机场使用种子，目的是让相同配置重现相同世界。需要比较质量时，应同时检查球面面积、邻接连通、候选与最终陆地比例，以及不同细节等级的大尺度轮廓。当前流水线没有湖泊或人文地理阶段；不能从水文填洼面推断出湖面。
