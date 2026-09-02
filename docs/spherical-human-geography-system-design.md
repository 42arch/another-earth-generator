# 球面人文地理系统设计方案

## 1. 文档目的

本文定义奇幻地图生成器的人文地理生成方案：在既有的球面地形、气候、水文和生态数据之上，确定性地生成聚落、文化、宗教、政治势力（国家）及其可视化图层。

人文地理不是独立的随机着色，而是以聚落为共同锚点、以自然地理为约束的连续生成系统。给定相同的 `seed`、球面网格和参数，生成结果必须保持一致。

```text
地形 / 气候 / 河流 / 湖泊 / 生物群系
                 │
                 ▼
          宜居性与通行成本场
                 │
                 ▼
           聚落与交通网络
            ├── 文化扩散
            ├── 宗教传播
            └── 国家领土扩张
                 │
                 ▼
文化区 / 信仰区 / 国家与边界 / 城市与路线图层
```

## 2. 设计原则

### 2.1 自然地理是人文生成的输入

人文生成器只消费已经稳定的球面世界数据，不反向修改地形、气候、河流或湖泊。主要输入包括：

- `landMask`、`regionFeature` 与 `regionContinent`；
- `elevation`、坡度和区域面积；
- 温度、降水、径流、湿度与生物群系；
- 河流、湖泊、海岸和海峡；
- 区域邻接关系、球面距离及局部通行成本。

这使高山、荒漠、冰原和内陆自然成为人烟稀少或政治难以整合的区域；河谷、温带平原、河口和港湾则更容易孕育人口与城市。

### 2.2 聚落是三类人文要素的共同锚点

文化核心、宗教发源地和国家首府均应从聚落中选择。没有聚落的区域仍可被文化或国家影响，但不应凭空成为政治与宗教中心。

### 2.3 允许边界不重合

- 文化区描述长期共享的语言、习俗与生活方式；
- 宗教区描述主导信仰及其影响强度；
- 国家描述行政控制范围。

三者可以重合，也应支持交错：同一国家可包含多文化、多信仰地区；一个文化或宗教也可跨越国界。

### 2.4 保持 TypedArray 优先的数据布局

逐区域、高频访问的数据保存为 TypedArray；数量较少、包含名称、颜色与元数据的实体保存为普通对象数组。区域归属 ID 统一使用 `-1` 表示无归属。

## 3. 生成流水线

推荐将人文生成置于 `SphericalWorldGenerator.generateHydrology()` 完成之后：

```text
Landmass → Elevation → Lakes → Climate → Rivers → Features
                                                │
                                                ▼
                                      Habitability / Accessibility
                                                │
                                                ▼
                                           Settlements
                                                │
                                  ┌─────────────┼─────────────┐
                                  ▼             ▼             ▼
                              Cultures      Religions      Polities
                                  │             │             │
                                  └─────────────┴─────────────┘
                                                ▼
                                      Routes / display metadata
```

`regenerateElevation()`、`regenerateLakes()` 和 `regenerateClimate()` 应同时失效并重建人文数据；仅调整显示开关时不得重新生成。后续可根据参数依赖关系进一步细化为局部重生成。

## 4. 聚落系统

### 4.1 宜居性与通行性

为每个陆地区域建立两个标准化标量场：

- `habitability`：长期承载人口的能力；
- `accessibility`：从其他区域到达、贸易和治理的难易度。

`habitability` 可由温度舒适度、降水适宜度、径流、低海拔平坦度、生物群系、海岸/河流加成综合计算。荒漠、高山、冰原和陡坡应显著降低得分。

`accessibility` 由区域邻接边成本计算。山地、密林、沙漠、冰原和无水跨海提高成本；河谷、平原、沿海和可航行河流降低成本。该成本场将被文化、宗教、国家和交通系统复用，避免四套彼此矛盾的地理逻辑。

### 4.2 聚落选址与规模

候选区域按宜居性、河口/汇流、港湾、淡水、交通中心性和大陆覆盖均衡评分。使用确定性排序与最小球面距离筛选，防止城市聚集在相邻 cell。

聚落类型：

| 类型 | 典型条件 | 用途 |
| --- | --- | --- |
| 村落 | 一般宜居区域 | 人口基础 |
| 城镇 | 河谷、道路节点、肥沃平原 | 区域中心 |
| 城市 | 高宜居性、河口、交通中心 | 文化和政治候选中心 |
| 港口 | 可达海岸、河口或良港 | 海运与跨海传播节点 |
| 首府 | 高人口、可达性、区域中心性 | 国家种子 |
| 圣地 | 自然奇观或重要聚落 | 宗教种子 |
| 游牧营地 | 草原、稀树草原、干旱边缘 | 低密度文化中心 |

人口可采用对数尺度，以区域宜居性、周边汇水和交通中心性为基础。生成的数值是相对人口，不必假装精确的历史人口统计。

## 5. 文化系统

### 5.1 文化核心

文化核心从高质量聚落中确定，并按大陆面积与人口潜力分配数量。地理隔绝的岛屿、山地盆地、沙漠边缘可获得额外成为独立文化的概率。

### 5.2 扩散算法

每个文化核心作为多源 Dijkstra 的种子，沿区域邻接图竞争扩散。区域归属由最小累计文化距离决定：

```text
cultureCost = terrainTravelCost
            + geographicBarrierCost
            + distanceCost
            - riverAndCoastBonus
            - tradeRouteBonus
```

文化扩散优先穿过河谷、平原、海岸和航线，在山脉、荒漠、冰原及宽海峡处减慢。为避免硬边界，除主文化 `regionCulture` 外，保留 `cultureInfluence`；该强度可以在渲染器中表现为边缘混合带。

可选的谱系字段 `parentCultureId` 用于表示文化分裂，便于将来增加语言、命名和历史演化。

## 6. 宗教系统

### 6.1 发源地与实体属性

宗教从大城市、山巅、火山、湖泊、河口、绿洲等适合作为叙事性地标的地点产生。每个宗教实体至少保存：

- `originRegion`、`holySettlement`、`holySiteRegions`；
- `missionaryStrength`：跨地区传播能力；
- `terrainAffinity`：对山地、海洋、沙漠等环境的偏好；
- `tolerance`：与其他宗教并存的可能性；
- `stateSupport`：获得政权支持后的传播加成。

### 6.2 传播规则

宗教也使用成本扩散，但相比文化更容易跨越文化差异和国界，且贸易路线、港口和大城市提供更强传播加成。每个区域保存主信仰、影响强度和圣地标记；后续可扩展第二信仰、宗教少数派、朝圣路线与教派分裂。

国家生成后可执行一次轻量的宗教影响修正，使国教在核心区更稳定，但不应完全抹除原有文化和贸易传播留下的格局。

## 7. 国家与政治势力系统

### 7.1 国家种子

从人口、繁荣度和可达性最高的城市中选择首府。数量按大陆面积、人口潜力和岛屿数控制；相邻首府必须满足最小球面距离。每个国家需要记录：

- `capitalSettlement` 与 `capitalRegion`；
- `primaryCultureId`、`stateReligionId`；
- `governmentType`、`color`；
- `power`、`cohesion`、`regionCount`。

### 7.2 竞争式领土扩张

国家领土采用多源 Dijkstra / 优先队列竞争扩张。首府均为种子，各区域属于累计治理成本最低的国家：

```text
governanceCost = terrainTravelCost
               + distanceToCapitalCost
               + seaCrossingCost
               + administrativeOverextension
               - roadRiverPortBonus
               - cultureAffinityBonus
               - religionAffinityBonus
```

为防止出现不合理的全球帝国，`administrativeOverextension` 应随距离和累计领土规模非线性增长。跨海扩张只允许从港口出发，并受最大跨海距离和海权参数限制。

### 7.3 边界优化

初次分配完成后，只对相邻国家边界区域做小范围局部优化：优先将边界吸附到山脊、沙漠、海岸、湖泊和大型河流，避免穿过连续肥沃平原。此步骤只调整边境 cell，不能破坏每个国家与首府之间的连通性。

普通海洋不划入国家领土；如需要，可单独建立海权影响区而非扩张 `regionPolity`。

## 8. 数据结构

建议在 `src/core/spherical/spherical-world-data.ts` 中加入：

```ts
export interface SphericalHumanData {
  habitability: Float32Array
  accessibility: Float32Array

  regionCulture: Int16Array
  cultureInfluence: Float32Array

  regionReligion: Int16Array
  religionInfluence: Float32Array
  holySiteMask: Uint8Array

  regionPolity: Int16Array
  politicalControl: Float32Array

  settlements: Settlement[]
  cultures: Culture[]
  religions: Religion[]
  polities: Polity[]
  routes: HumanRoute[]
}
```

并在 `SphericalWorldData` 中增加 `human: SphericalHumanData`。`Settlement`、`Culture`、`Religion`、`Polity` 和 `HumanRoute` 作为普通对象接口，保存名称、颜色、区域 ID、实体间关联及少量统计字段。

建议新增模块：

```text
src/core/spherical/society/
  human-generator.ts
  transport-generator.ts
  culture-generator.ts
  religion-generator.ts
  polity-generator.ts

src/core/rendering/globe/
  human-surface-geometry.ts
  human-boundary-geometry.ts
  settlement-geometry.ts
  route-geometry.ts
```

## 9. 渲染与交互

在人文图层中复用 `GlobeRenderer` 的现有叠加图层模式：

- 文化：半透明区域颜色与柔和文化边缘；
- 宗教：半透明信仰区；应与文化模式互斥显示，避免混色；
- 国家：低透明度领土底色、较清晰的国界、首都标记；
- 聚落：按等级缩放的点或图标；远距离只显示首都与大城市；
- 路线：陆路、河运与航线使用不同线型或色彩。

在 `GlobeGenParams` 中增加 `displayMode: 'cultures' | 'religions' | 'polities' | 'settlements'`，并添加国家边界、聚落、道路、贸易线、文化边界和圣地等独立显示开关。

区域拾取信息应增加文化、主信仰、政治归属、控制强度、最近聚落和相对人口。名称生成在首个版本中可使用稳定的占位名称，后续再接入语言规则。

## 10. 参数与重生成依赖

建议的首批公开参数：

| 参数 | 说明 |
| --- | --- |
| `settlementDensity` | 聚落密度 |
| `cultureCount` | 文化核心数量 |
| `religionCount` | 宗教发源数量 |
| `polityCount` | 国家数量 |
| `politicalCohesion` | 国家跨越地理障碍和维持远方领土的能力 |
| `overseasExpansion` | 跨海扩张能力 |
| `culturalBlending` | 文化边境的混合宽度 |
| `religiousProselytism` | 宗教传播强度 |

依赖关系如下：

```text
地形、湖泊、气候或河流变化 → 重算全部人文数据
聚落参数变化                 → 重算聚落、路线、文化、宗教、国家
文化参数变化                 → 重算文化，并重算或微调国家
宗教参数变化                 → 重算宗教，并微调国家国教关系
国家参数变化                 → 仅重算国家与政治边界
显示参数变化                 → 仅更新渲染图层
```

## 11. 分阶段实施

### H1：聚落与宜居性

实现 `habitability`、`accessibility`、基础聚落生成与区域拾取信息。此阶段是全部人文系统的地基。

### H2：国家 MVP

实现首府选择、竞争式领土扩张、领土着色和国界。优先提供最直观可读的人文效果。

### H3：文化层

实现文化核心、地理摩擦扩散、影响强度和文化图层。

### H4：宗教层

实现圣地、宗教传播、信仰图层及国家支持的轻量影响。

### H5：交通与贸易网络

以聚落和港口为节点建立陆路、航路和贸易路径，并反哺文化、宗教与国家的扩散成本。

### H6：历史演化（可选）

以离散年代模拟国家兴衰、文化分裂、宗教扩张和冲突。该阶段应建立在静态世界已可控、可解释的基础上，不纳入第一版目标。

## 12. 验收标准

- 同一组种子和参数始终产生完全一致的人文数据；
- 国家领土不包含普通海洋区域，且每个国家与首府保持连通；
- 高山、荒漠、冰原中的聚落密度和国家控制强度显著低于温带河谷和平原；
- 河谷、海岸、港口和交通节点具备更高的城市、文化传播和国家扩张概率；
- 文化、宗教和国家边界不会被强制重合；
- 图层可独立显示、隐藏与销毁，不会在参数更新后留下过时 Three.js 几何；
- 在默认细分等级下，完整的人文生成保持交互可接受的耗时，并避免在逐区域热路径中创建大量临时对象。
