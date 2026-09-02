# 球面气候系统设计与实现方案

## 1. 文档目的

本文描述 3D Globe 模式的气候系统设计，并给出可以直接落地到当前代码结构中的实现方案。

第一阶段的目标不是构建数值天气预报模型，而是生成一个确定性、低成本、地理上可信的“年平均气候”。它需要让纬度、海陆分布、盛行风和山脉共同决定温度与降水，并让降水继续影响径流、河流和生物群系。

```text
球面网格、海陆与高程
          │
          ▼
       温度场
          │
          ▼
   球面切向盛行风场
          │
          ▼
海洋蒸发与水汽图输送
          │
          ▼
对流降水、地形雨与雨影
          │
          ▼
蒸散损失与地表径流
          │
          ├────────► 河流汇流与河宽
          │
          └────────► 生物群系与地表配色
```

本文优先覆盖年平均温度、风、水汽、降水和径流。季节、积雪、季风与洋流属于后续扩展。

---

## 2. 当前实现与迁移起点

当前球面世界已经具备实现气候系统所需的主要基础：

- `SphericalMesh` 提供无边界的球面 Voronoi 邻接、region 经纬度、三维单位位置和球面面积；
- `SphericalWorldGenerator` 已在海陆、高程生成之后创建一个简化降水场；
- `SphericalRiverGenerator` 已实现洼地填充、下游选择和汇流累积；
- 3D 控制面板与渲染器已经支持 `Precipitation` 和 `Flux` 图层；
- 各地理属性使用 TypedArray，适合多轮图传播计算。

当前简化降水存在两个关键限制：

1. 降水由纬度、临海判断、独立随机值和高程直接组合，不包含水汽输送、盛行风、迎风坡和雨影。
2. 河流汇流的初始值是 `regionArea`，而不是降水或径流，因此湿润区与干旱区会生成近似相同规模的河网。

因此气候系统的第一项架构调整是：

> 用独立的 `SphericalClimateGenerator` 替换 `SphericalWorldGenerator.generatePrecipitation()`，并在河流生成前计算气候和径流。

新的生成顺序为：

```text
mesh
  → tectonics
  → landmasses
  → elevation
  → features
  → climate
      ├─ temperature / wind / precipitation / runoff
      └─ biome
  → rivers
  → render data
```

---

## 3. 设计目标与非目标

### 3.1 设计目标

- 同一个 seed 和参数必须产生完全一致的结果；
- 全球连续，不在经度 `±180°` 或极点产生接缝；
- 纬度控制基础热量，高程产生降温；
- 海洋是主要水汽来源；
- 风向决定湿润空气进入大陆的方向；
- 山脉产生迎风坡降水和背风坡雨影；
- 降水与蒸散共同决定径流，径流驱动河流流量；
- 算法只依赖球面位置、面积和 region 邻接，不依赖 Three.js 或显示投影；
- 默认 subdivision 6（约四万个 region）提供高细节交互；subdivision 5 保留为均衡性能档；
- 所有中间场均可视化，便于调参与定位问题。

### 3.2 第一阶段非目标

- 每日天气和云团运动；
- 完整流体力学、气压方程或 Navier–Stokes 模拟；
- 精确的摄氏温度、毫米年降雨量和真实能量守恒；
- ENSO、热带气旋等短周期现象；
- 由洋流计算海表温度；
- 土壤蓄水、地下水和洪水过程；
- 南北半球逐月季节变化。

第一阶段采用“机制可信、结果可控”的风格化模型。温度使用近似摄氏度，水汽、降水和径流使用归一化相对量。

---

## 4. 数据模型

### 4.1 气候数据

在 `src/core/spherical/spherical-world-data.ts` 中新增：

```ts
export const SPHERICAL_BIOME = {
  Ocean: 0,
  Ice: 1,
  Tundra: 2,
  BorealForest: 3,
  TemperateGrassland: 4,
  TemperateForest: 5,
  TemperateRainforest: 6,
  SubtropicalDesert: 7,
  Savanna: 8,
  TropicalRainforest: 9,
} as const

export type SphericalBiomeCode
  = (typeof SPHERICAL_BIOME)[keyof typeof SPHERICAL_BIOME]

export interface SphericalClimateData {
  // 近似年平均地表温度，单位为摄氏度。
  temperature: Float32Array

  // 大气当前水汽状态，主要用于调试。
  moisture: Float32Array

  // 年平均相对降水强度，归一化到 0..1。
  precipitation: Float32Array

  // 年平均相对蒸散损失，归一化到 0..1。
  evapotranspiration: Float32Array

  // 可进入河网的单位面积相对径流，归一化到 0..1。
  runoff: Float32Array

  // 每个 region 一个 xyz 球面切向单位向量，长度为 numRegions * 3。
  wind: Float32Array

  // SphericalBiome 编码。
  biome: Uint8Array
}
```

`SphericalWorldData` 调整为：

```ts
export interface SphericalWorldData {
  elevation: Float32Array
  climate: SphericalClimateData
  landMask: Uint8Array
  regionFeature: Uint8Array
  regionFeatureId: Int32Array
  regionContinent: Int16Array
  tectonics: SphericalTectonicData
  rivers: SphericalRiverData
  landArea: number
}
```

当前 `data.precipitation` 的使用点较少，建议一次性迁移为 `data.climate.precipitation`，不要长期同时维护两份数组。

### 4.2 河流数据语义调整

`flowAccumulation` 不再表示纯汇水面积，而表示面积加权后的累积径流：

```text
localFlow(region) = regionArea(region) × runoff(region)
```

`SphericalRiverData.thresholdArea` 应重命名为 `thresholdFlow`，避免继续使用错误的面积语义。

---

## 5. 配置参数

第一版只暴露少量高影响参数，避免控制面板被几十个系数占满：

```ts
export interface GlobeGenParams {
  // 现有参数省略……

  equatorTemperature: number
  poleTemperature: number
  latitudeTemperatureExponent: number
  elevationCooling: number

  windPerturbation: number
  oceanEvaporation: number
  landEvaporation: number
  moistureIterations: number
  moistureRetention: number
  basePrecipitation: number
  equatorialRainStrength: number
  subtropicalDryness: number
  midlatitudeRainStrength: number
  orographicStrength: number
  evapotranspirationStrength: number
  infiltration: number
}
```

建议初始值：

| 参数 | 初始值 | 建议范围 | 说明 |
| --- | ---: | ---: | --- |
| `equatorTemperature` | `27.5` | `20..36` | 赤道海平面年均温 |
| `poleTemperature` | `-20` | `-35..5` | 极区海平面年均温 |
| `latitudeTemperatureExponent` | `2.1` | `1..3` | 纬度温度曲线形状 |
| `elevationCooling` | `20` | `0..40` | 归一化高山造成的最大降温 |
| `windPerturbation` | `0.11` | `0..0.4` | 对规则纬向风的扰动 |
| `oceanEvaporation` | `0.04` | `0.005..0.08` | 每次迭代的海洋水汽源 |
| `landEvaporation` | `0.006` | `0..0.02` | 陆地再蒸发水汽源 |
| `moistureIterations` | `56` | `16..96` | 图输送迭代次数 |
| `moistureRetention` | `0.97` | `0.8..0.99` | 每步可继续输送的水汽比例 |
| `basePrecipitation` | `0.016` | `0..0.08` | 非地形强迫降水比例 |
| `equatorialRainStrength` | `0.052` | `0..0.1` | 赤道辐合带对流降水强度 |
| `subtropicalDryness` | `0.55` | `0..0.9` | 约 28° 下沉带对背景降水的抑制 |
| `midlatitudeRainStrength` | `0.012` | `0..0.05` | 约 50° 风暴路径降水强度 |
| `orographicStrength` | `0.55` | `0..2` | 地形抬升降水强度 |
| `evapotranspirationStrength` | `0.38` | `0..0.8` | 温度造成的径流损失 |
| `infiltration` | `0.1` | `0..0.5` | 固定下渗损失比例 |

这些值是归一化模型的调参起点，不代表真实物理单位。完成可视化后，应以地图整体结果为依据校准。

控制面板建议只展示：

- Equator Temp；
- Pole Temp；
- Wind Variation；
- Evaporation；
- Orographic Rain；
- Moisture Steps。

其余参数先保留在配置对象中，作为高级参数或开发常量。

---

## 6. 温度场

### 6.1 基础纬度温度

对纬度 `latitude ∈ [-π/2, π/2]`：

```ts
const latitudeFactor = Math.abs(Math.sin(latitude)) ** params.latitudeTemperatureExponent

const seaLevelTemperature = lerp(
  params.equatorTemperature,
  params.poleTemperature,
  latitudeFactor,
)
```

使用 `sin(latitude)` 而不是直接线性纬度，可以让热带范围较宽、高纬降温更明显。

### 6.2 高程降温

当前高程是归一化相对高程，第一版直接使用：

```ts
const landHeight = landMask[region] === 0
  ? 0
  : clamp((elevation[region] - SEA_LEVEL) / (1 - SEA_LEVEL), 0, 1)

temperature[region] = seaLevelTemperature
  - landHeight * params.elevationCooling
```

现实中的环境直减率常用约 `6.5°C/km`，但在高程没有映射为真实公里数之前，不应把该数值直接写入算法。以后增加 `maximumTerrainHeightKm` 后，可以将两者转换为真实单位。

### 6.3 温度扰动与海洋调节

为了避免完全平行的纬向色带，可增加低频三维噪声：

```ts
temperature[region] += noise3D(x * 1.7, y * 1.7, z * 1.7) * 2.5
```

不要使用每个 cell 独立随机数，否则会产生椒盐状气候边界。

第一阶段暂不需要复杂大陆性模型。后续可通过“到海洋的图距离”计算 continentality，使大陆内部温差更大、沿海更温和。

---

## 7. 球面风场

### 7.1 风向数据必须位于切平面

设 region 的单位位置为 `p = (x, y, z)`，项目以 `y` 轴表示南北方向。局部 east 向量可以写为：

```ts
east = normalize([-z, 0, x])
```

极点附近 `x² + z²` 很小时，使用固定辅助轴与 `p` 做叉积得到稳定的 east。局部 north 为：

```ts
north = normalize(cross(east, p))
```

最终风向必须重新投影到切平面：

```ts
wind -= p * dot(wind, p)
wind = normalize(wind)
```

应始终满足：

```text
abs(dot(position, wind)) < epsilon
```

### 7.2 三圈环流的基础风带

第一版使用按纬度划分的近地面风：

| 绝对纬度 | 纬向分量 | 经向分量 |
| --- | --- | --- |
| `0°..30°` | 东风，`-east` | 朝向赤道 |
| `30°..60°` | 西风，`+east` | 朝向极区 |
| `60°..90°` | 东风，`-east` | 朝向赤道 |

在 `30°` 和 `60°` 两侧使用约 `4°` 的 `smoothstep` 混合带，避免风向突然翻转。

纬向风作为主分量，经向风建议为其 `0.2..0.35`。这能形成赤道辐合、副热带干燥带和中纬度湿润输送的基础格局。

### 7.3 打破规则平行风

在基础风上加入连续的低频三维噪声扰动：

1. 从三组不同偏移的 `noise3D(x, y, z)` 构造扰动向量；
2. 将扰动向量投影到 region 切平面；
3. 按 `windPerturbation` 与基础风混合；
4. 重新归一化。

扰动必须连续且由 seed 决定。不能给每个 region 一个独立随机角度，否则相邻 cell 的风会相互冲突，水汽输送容易形成噪点。

---

## 8. 水汽输送与降水

### 8.1 为什么使用迭代图输送

球面上的风场包含闭合环流，无法像平面单向风那样通过一次全局排序完成传播。推荐使用双缓冲 TypedArray 做固定步数迭代：

```ts
const currentMoisture = new Float32Array(numRegions)
const nextMoisture = new Float32Array(numRegions)
```

每轮只读取 `currentMoisture`，只写入 `nextMoisture`，避免 region 遍历顺序改变结果。

### 8.2 下风向邻居权重

对 region `r` 和邻居 `n`，先把邻居方向投影到 `r` 的切平面：

```ts
const tangentX = neighborX - regionX * dot(regionPosition, neighborPosition)
const tangentY = neighborY - regionY * dot(regionPosition, neighborPosition)
const tangentZ = neighborZ - regionZ * dot(regionPosition, neighborPosition)
const direction = normalize([tangentX, tangentY, tangentZ])

const alignment = Math.max(0, dot(windAtRegion, direction))
const weight = alignment * alignment
```

平方可以让水汽优先沿最接近风向的边传播，同时保留向两个相邻 cell 分流的可能。将同一 region 的正权重归一化后再分配水汽。

权重可以按 CSR 邻接数组相同的索引顺序预计算：

```ts
downwindWeight: Float32Array // 长度等于 mesh.neighbors.length
```

### 8.3 水汽来源

每轮在输送前加入蒸发：

```ts
const warmFactor = clamp((temperature[region] + 5) / 35, 0, 1)

const evaporation = landMask[region] === 0
  ? params.oceanEvaporation * (0.35 + warmFactor * 0.65)
  : params.landEvaporation * warmFactor * precipitationMemory[region]
```

海洋是主要水汽源，温暖海洋蒸发较多。陆地再蒸发第一版保持较弱，避免形成不衰减的内陆水汽循环。

### 8.4 基础凝结与对流降水

温暖空气能携带更多水汽，可使用归一化容量函数：

```ts
const capacity = lerp(0.15, 1, warmFactor * warmFactor)
const excess = Math.max(0, moisture - capacity)
```

同时加入较小的持续凝结比例：

```ts
const equatorialConvergence = gaussianBand(absLatitude, radians(0), radians(10))
const subtropicalSubsidence = gaussianBand(absLatitude, radians(28), radians(9))
const midlatitudeStorms = gaussianBand(absLatitude, radians(50), radians(13))
const backgroundRain = params.basePrecipitation
  * (1 - params.subtropicalDryness * subtropicalSubsidence)
const rainFraction = backgroundRain
  + equatorialConvergence * warmFactor * params.equatorialRainStrength
  + midlatitudeStorms * params.midlatitudeRainStrength

const localRain = Math.min(
  moisture,
  Math.max(excess, moisture * rainFraction),
)
```

赤道增强表达热带辐合和强对流；约 28° 的下沉带抑制背景降水，形成更集中的
副热带荒漠；约 50° 的风暴路径恢复中纬度降水。三者都只改变凝结比例，仍由
实际输送到当地的水汽量决定最终降水，因此不会凭空在干燥内陆制造雨水。

### 8.5 地形雨与雨影

水汽从 region `r` 输送到下风邻居 `n` 时，根据沿边坡度计算地形抬升：

```ts
const rise = Math.max(0, elevation[n] - elevation[r])
const distance = mesh.distanceBetweenRegions(r, n)
const uphillSlope = distance > 0 ? rise / distance : 0

const orographicFraction = clamp(
  uphillSlope * params.orographicStrength,
  0,
  0.85,
)

const edgeRain = transportedMoisture * orographicFraction
precipitationAccumulator[n] += edgeRain
nextMoisture[n] += transportedMoisture - edgeRain
```

湿空气在迎风坡损失水汽后，越过山脉进入背风坡时自然变干，不需要额外绘制雨影遮罩。

必须限制单条边的最大凝结比例，防止高程噪声或极短边一次抽干全部水汽。

### 8.6 迭代稳定性

推荐把迭代分成两个阶段：

- 前 `24` 轮作为 spin-up，只建立水汽状态；
- 后 `24` 轮累计降水，并除以采样轮数得到平均降水率。

每轮输送前保留少量水汽损耗：

```ts
transportable = remainingMoisture * params.moistureRetention
```

这既代表未解析的沉降和混合，也能保证闭合球面上的循环收敛。

若某个 region 没有正权重的下风邻居，将可输送水汽平均发送到 alignment 最大的一个或两个邻居，不能直接丢弃，也不能永久留在原 cell。

### 8.7 归一化

模拟内部保留原始平均降水率。对外输出前，建议使用陆地面积加权的第 `98` 百分位作为显示尺度：

```ts
normalizedPrecipitation = clamp(rawPrecipitation / percentile98, 0, 1)
```

使用百分位而不是最大值，可以避免单个异常高山 cell 压低全球其他区域的颜色对比度。径流也使用同一尺度，保证不同 seed 之间具有相近的调参范围。

---

## 9. 蒸散与地表径流

第一阶段不维护土壤含水量，使用温度驱动的比例损失：

```ts
const warmFactor = clamp((temperature[region] + 5) / 35, 0, 1)
const evapFraction = warmFactor * params.evapotranspirationStrength
const lossFraction = clamp(params.infiltration + evapFraction, 0, 0.95)

evapotranspiration[region] = precipitation[region] * evapFraction
runoff[region] = landMask[region] === 0
  ? 0
  : precipitation[region] * (1 - lossFraction)
```

这不是完整水量平衡模型，但具有正确的一阶行为：

- 寒冷湿润地区径流比例高；
- 炎热地区蒸散损失较高；
- 无降水地区不会凭空产生河流；
- 海洋 region 的 runoff 始终为零。

后续若加入土壤系统，可将该部分替换为月尺度水量平衡，而不改动风和水汽模块。

---

## 10. 气候驱动的河流汇流

`SphericalRiverGenerator.generate` 增加 `runoff` 参数：

```ts
generate(
  mesh: SphericalMesh,
  elevation: Float32Array,
  landMask: Uint8Array,
  runoff: Float32Array,
  params: GlobeGenParams,
): SphericalRiverData
```

`accumulateFlow` 的初值由：

```ts
flow[region] = mesh.regionArea[region]
```

改为：

```ts
flow[region] = mesh.regionArea[region] * runoff[region]
```

然后保持当前按 `drainageElevation` 从高到低累加的逻辑。

河流阈值改为总陆地径流的比例：

```ts
let totalRunoff = 0
for (let region = 0; region < mesh.numRegions; region++) {
  if (landMask[region] !== 0)
    totalRunoff += mesh.regionArea[region] * runoff[region]
}

const thresholdFlow = totalRunoff * params.riverBasinThreshold
```

这一修改会改变 `riverBasinThreshold` 的实际观感，需要在气候模型完成后重新校准其默认值和 UI 范围。

地球类气候校准后的默认值为 `0.0015`；控制面板使用 `0.0005` 步长，便于不同 seed 和陆地覆盖率下微调河网密度。源头最低高程调整为 `0.25`，最短河道调整为 3 个 cell，以保留低缓大陆和中小型流域。

主阈值只负责判断一条流域是否形成可见河道。对每个首次达到主阈值的 channel
source，沿最大汇流量的上游支路继续回溯，直到上游流量低于主阈值的 `18%`。
这避免河流从接近河口的位置突然出现，同时又不会把每条微小季节性沟谷都绘制出来。

河流宽度继续依据 `flowAccumulation`，但显示归一化应从 `landArea` 改为 `totalRunoff` 或当前河网的高百分位流量。
低于主阈值的回溯河段使用最小宽度；下游和入海口仍沿用现有宽度上限。

---

## 11. 生物群系

Biome 是温度和降水的派生结果，不参与第一版水汽迭代。推荐在气候与径流完成后分类。

初始分类表：

| 温度条件 | 干燥 | 中等 | 湿润 |
| --- | --- | --- | --- |
| `< -10°C` | 冰原 | 冰原 | 冰原 |
| `-10..1°C` | 冻原 | 冻原 | 针叶林 |
| `1..18°C` | 温带草原 | 温带森林 | 温带雨林 |
| `18..21°C` | 亚热带荒漠 | 草原/灌木 | 湿润森林 |
| `> 21°C` | 热带荒漠 | 稀树草原 | 热带雨林 |

降水边界不要固定为全局常数，可以让高温地区达到森林所需的降水阈值更高：

```ts
const aridity = precipitation / (0.38 + warmFactor * 0.52)
```

这样同样的降水在寒冷地区可能形成森林，在炎热地区则可能仍然是草原。
荒漠只保留给极干旱区域：亚热带过渡区的湿润度阈值为 `0.14`，热带为
`0.12`；此前落入荒漠的半干旱区域会分别归入温带草原或稀树草原。
默认温度曲线使用更宽的低纬暖区，并对地形高度采用非线性降温，避免大陆
内部因过程地形的整体抬升而全部退出热带群系。地球类默认水汽保留率为
`0.97`，使湿润气流能够继续深入大型大陆，但山脉仍会通过地形雨制造雨影。

初版 biome 只影响地表颜色。植被密度、城市适宜度和资源分布可以在后续把 biome 作为输入。

---

## 12. 代码组织与接口

### 12.1 新增文件

```text
src/core/spherical/
├── generators/
│   ├── spherical-climate-generator.ts
│   └── spherical-biome-classifier.ts
├── geometry/
│   └── tangent-frame.ts
└── spherical-world-data.ts
```

第一版也可以把 biome 分类保留为 `SphericalClimateGenerator` 的私有方法；当分类规则开始影响植被和资源时再拆出独立文件。

### 12.2 生成器接口

```ts
export class SphericalClimateGenerator {
  generate(
    mesh: SphericalMesh,
    elevation: Float32Array,
    landMask: Uint8Array,
    params: GlobeGenParams,
  ): SphericalClimateData {
    const temperature = this.generateTemperature(mesh, elevation, landMask, params)
    const wind = this.generateWind(mesh, params)
    const transport = this.transportMoisture(
      mesh,
      elevation,
      landMask,
      temperature,
      wind,
      params,
    )
    const waterBalance = this.calculateRunoff(
      landMask,
      temperature,
      transport.precipitation,
      params,
    )
    const biome = this.biomeClassifier.classify(
      landMask,
      temperature,
      transport.precipitation,
    )

    return {
      temperature,
      moisture: transport.moisture,
      precipitation: transport.precipitation,
      evapotranspiration: waterBalance.evapotranspiration,
      runoff: waterBalance.runoff,
      wind,
      biome,
    }
  }
}
```

### 12.3 世界生成器集成

`SphericalWorldGenerator` 增加：

```ts
private readonly climateGenerator = new SphericalClimateGenerator()
```

主流程调整为：

```ts
const climate = this.climateGenerator.generate(
  mesh,
  elevation,
  landmasses.landMask,
  params,
)

const rivers = this.riverGenerator.generate(
  mesh,
  elevation,
  landmasses.landMask,
  climate.runoff,
  params,
)
```

删除原有私有方法 `generatePrecipitation()` 及其 `clamp`、`deterministicUnit` 导入。

### 12.4 分级重新生成

依赖关系应明确为：

```text
网格、seed、板块、海陆变化
  → 全部重新生成

高程参数变化
  → elevation → climate → rivers → appearance

气候参数变化
  → climate → rivers → appearance

河流阈值或源头参数变化
  → rivers → appearance

气候图层显隐变化
  → appearance only
```

新增方法：

```ts
regenerateClimate(
  mesh: SphericalMesh,
  data: SphericalWorldData,
  params: GlobeGenParams,
): void {
  data.climate = this.climateGenerator.generate(
    mesh,
    data.elevation,
    data.landMask,
    params,
  )
  this.regenerateRivers(mesh, data, params)
}
```

`regenerateElevation()` 在更新高程后调用 `regenerateClimate()`，而不是直接重新生成降水。

---

## 13. 3D 显示与调试图层

已有 `Precipitation` 和 `Flux` 图层继续保留，并增加：

- `Temperature`：蓝—白—黄—红连续色带；
- `Moisture`：显示大气水汽状态，用于诊断输送是否中断；
- `Wind`：稀疏箭头或流线，只显示每隔若干 region 的采样；
- `Biomes`：离散生物群系配色；
- 可选 `Runoff`：区分“下雨多”与“实际进入河流多”。

标量图层建议互斥，否则多个半透明面叠加后难以判断数值。河流、海岸线、板块边界和 Wind 箭头仍可作为独立线图层叠加。

`WorldColorizer` 需要将：

```ts
data.precipitation
```

迁移为：

```ts
data.climate.precipitation
```

Flux 颜色继续读取 `data.rivers.flowAccumulation`，但对数归一化的基准应使用流量百分位，避免不同降水总量导致整层过暗或过亮。

region 拾取信息建议增加：

```text
温度 14.2°C
降水 63%
径流 41%
Biome Temperate Forest
```

---

## 14. 确定性、性能与内存

### 14.1 确定性

- 所有噪声必须由 `params.seed` 的固定偏移派生；
- 不使用 `Math.random()`；
- 双缓冲迭代避免更新顺序依赖；
- 邻居遍历保持 CSR 中的稳定顺序；
- 百分位排序在相同值时使用 region id 作为稳定次序；
- 不依赖 Three.js 浮点对象或渲染帧时间。

### 14.2 性能估算

默认 subdivision 6 约有 `40,962` 个 region，每个 region 平均约 6 个邻居。`48` 轮输送约为：

```text
40,962 × 6 × 48 ≈ 1,180 万次有向邻边处理
```

该规模仍适合 TypedArray 和简单数值循环，但完整世界重生成会比 subdivision 5 约重四倍；外观和图层切换不触发这些计算。实现时应注意：

- 热循环中不创建数组、对象和向量类；
- 不在每轮重复调用 `acos`；
- 邻边切向方向、距离倒数和下风权重尽量预计算；
- 使用 `Float32Array` 双缓冲并通过变量交换复用；
- 百分位计算只在最终归一化时执行一次；
- 低性能设备可回退 subdivision 5；若 subdivision 6 仍出现明显阻塞，再把 climate 生成迁入 Web Worker。

### 14.3 额外内存

在 40,962 个 region 下，单个 `Float32Array` 约 160 KB。核心气候场、月度与季节数据仍保持连续 TypedArray 布局，避免逐单元对象带来的额外内存与 GC 压力。

---

## 15. 验证与测试

### 15.1 数值不变量

- 所有输出必须是有限数，不能出现 `NaN` 或 `Infinity`；
- `precipitation`、`evapotranspiration` 和 `runoff` 均在 `0..1`；
- 海洋 region 的 `runoff` 必须为 `0`；
- 对每个 region，`abs(dot(position, wind)) < 1e-5`；
- 风向长度应接近 `1`；
- 下风邻居权重和应接近 `1`；
- `flowAccumulation[downstream]` 应包含所有直接上游流量；
- 同 seed、同参数生成的 TypedArray 内容完全一致。

### 15.2 合成地形测试

建议构造几个不依赖完整世界生成器的小型测试场景：

1. **纯海洋球体**：温度呈纬度梯度，水汽和降水有限且连续。
2. **无山大陆**：沿海向内陆降水平滑衰减，不出现 cell 级噪点。
3. **南北向山脉**：在固定西风下，西坡降水显著高于东坡。
4. **赤道大陆**：总体温暖湿润，但高山仍可形成低温区。
5. **副热带大陆**：大陆内部容易形成干旱带。
6. **经度接缝大陆**：接缝两侧风、温度和降水连续。
7. **极区大陆**：不出现 east 基向量为零造成的异常。

### 15.3 视觉验收标准

- 降水不再表现为逐 cell 随机斑点；
- 湿润区跨越多个相邻 cell，边界连续但不是规则纬向直线；
- 大山脉两侧能看出稳定的迎风湿润与背风干燥差异；
- 热带、大约 30° 副热带和中纬度具有可辨认但不机械的气候差异；
- 大河主要出现在高径流流域，沙漠中的永久大河明显减少；
- Precipitation、Runoff 与 Flux 三个图层之间具有可解释的空间关系；
- 经度接缝和极点无可见断裂。

---

## 16. 分阶段实施计划

### 阶段 A：气候核心与调试可视化

实现：

- `SphericalClimateData`；
- `SphericalClimateGenerator`；
- 温度场；
- 球面切向风场；
- 海洋蒸发和迭代水汽输送；
- 地形雨与雨影；
- 迁移现有 Precipitation 图层；
- Temperature、Moisture 和 Wind 调试显示。

验收：全球连续、结果确定、雨影清晰、无明显 cell 噪点。

### 阶段 B：气候与河流耦合

实现：

- 蒸散和 runoff；
- `SphericalRiverGenerator` 使用 `area × runoff` 初始化汇流；
- `thresholdArea` 迁移为 `thresholdFlow`；
- Flux 与河宽归一化调整；
- UI 中气候参数触发 `climate → rivers` 分级重算。

验收：湿润大陆河网明显密于干旱大陆，河流流量与降水/径流图层一致。

### 阶段 C：生物群系

当前已实现：气候生成后通过独立 `SphericalBiomeClassifier` 分类，结果写入
`SphericalClimateData.biome`；3D 模式提供 `Biomes` 离散配色，并在 region
拾取信息中显示群系名称。

实现：

- biome 分类；
- biome 地表配色；
- region 拾取信息；
- 冰原、冻原、森林、草原、沙漠和热带群系。

验收：群系边界符合温度和湿度，不直接依赖随机分区。

### 阶段 D：季节与高级扩展

当前已实现气候常态型季节系统：

- 可调轴倾角与南北半球相反的季节；
- 12 个月温度常态；
- 1、4、7、10 月四套代表性风场、水汽输送、降水和径流；
- 夏季、冬季、最干季和最湿季降水统计；
- biome 使用降水季节性识别地中海灌丛和热带季节林；
- 四季径流沿同一排水拓扑独立汇流，并以枯水季/丰水季流量比区分常年河与季节河；
- 湖泊记录四季入流、蒸发和填充率，以枯水季水量平衡识别季节湖；
- 表层洋流由年平均风应力、科氏偏转和海岸阻挡共同生成，并保持为球面切向场；
- 海表温度通过洋流平流、邻域扩散和辐射平衡迭代得到，暖流与寒流形成相对纬向
  基准的海温异常；
- 海温异常向近岸陆地衰减传播，并在降水计算前修正温度，因此会继续影响海洋蒸发、
  降水、径流和 biome；Display 提供洋流箭头与海表温度调试图层。

后续可按需求增加：

- 月份切换与季节图层显示；
- 季风；
- 雪线、积雪与冰川；
- 深层热盐环流与上升流；
- 月尺度土壤水量平衡；
- 将气候输入城市、农业和人口适宜度模型。

---

## 17. 风险与处理策略

### 17.1 风带过于规则

表现：降水重新变成平行纬向条带。

处理：使用连续球面噪声扰动风向，并让海陆、高程通过水汽源和地形雨打破对称性。扰动强度应低于基础风，避免风场失去整体结构。

### 17.2 水汽在闭合环流中无限累积

表现：迭代越多，全球降水越高。

处理：使用 `moistureRetention < 1`、容量凝结和固定采样窗口；输出平均降水率而不是所有轮次总和。

### 17.3 山地 cell 一次抽干水汽

表现：山脉第一排极湿，后续区域完全无雨。

处理：按球面距离计算坡度，限制单边最大地形凝结比例，并对高程场使用连续尺度。

### 17.4 参数互相补偿、难以调节

表现：提高蒸发后又必须同时修改降水和河流阈值。

处理：内部保留原始量，显示和径流使用面积加权百分位归一化；UI 只公开少量高影响参数。

### 17.5 高分辨率主线程卡顿

表现：subdivision 6 调整参数时界面短暂无响应。

处理：先预计算邻边数据和复用缓冲；仍不足时再将完整 climate 生成放到 Worker，避免在第一版提前引入线程同步复杂度。

---

## 18. 参考资料

- [NOAA：全球大气环流、Hadley/Ferrel/Polar cells 与盛行风带](https://prod-01-alb-www-noaa.woc.noaa.gov/jetstream/global/global-atmospheric-circulations)
- [NOAA：环境温度直减率说明](https://prod-01-alb-www-noaa.woc.noaa.gov/jetstream/appendix/weather-glossary-l)
- [NASA Earth Observatory：山脉抬升降水与雨影现象](https://earthobservatory.nasa.gov/images/150181/death-valley-flash-flooding)

这些资料用于确定模型应表达的基础机制；本文中的具体数值算法是面向当前球面 Voronoi 图和实时程序化生成需求所做的简化实现。
