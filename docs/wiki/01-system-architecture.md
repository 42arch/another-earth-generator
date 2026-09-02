# 第 1 章 · 系统架构与球面数据流水线

本章系统阐述奇幻地图生成器的总体架构哲学、全要素生成流水线的生命周期、底层高性能数据结构设计以及增量式交互重算机制。

---

## 1. 架构哲学：球面作为唯一权威真源

传统过程生成地图系统通常基于矩形平面网格进行生成。这种模式存在固有的缺陷：
- **边界伪影**：左右边界拓扑不闭合，经度 $180^\circ$ 附近存在明显接缝；
- **几何失真**：平面距离与面积在投影到球体后发生严重扭曲（如两极区域面积被无限拉大）；
- **过程受限**：板块漂移、风带流动和洋流环流等全球性物理过程无法在有界的平面上形成闭合环流。

本项目确立了 **“球面单一真源（Sphere as the Single Source of Truth）”** 的核心架构：

$$\text{Elevation, Climate, Hydrology}: S^2 \to \mathbb{R}^n$$

所有的地理属性、物理场和生态数据均直接在无边界的三维单位球面 $S^2$ 上进行计算与存储。二维平面投影（如墨卡托、等距圆柱投影等）与三维地球（3D Globe）仅作为同一份球面数据的不同表现视图（Views），不参与任何生成逻辑。

```text
       ┌───────────────────────────────┐
       │   确定性种子与全局参数 Seed   │
       └───────────────┬───────────────┘
                       ▼
       ┌───────────────────────────────┐
       │    球面网格与地理生成管线     │  <--- 唯一真源 (TypedArrays on S²)
       └───────┬───────────────┬───────┘
               │               │
               ▼               ▼
   ┌───────────────────────┐ ┌─────────────────────────┐
   │    3D Globe 渲染器    │ │  2D 投影转换与地图导出  │
   │ (WebGL / Pixi.js v8)  │ │ (Equirectangular / etc.)│
   └───────────────────────┘ └─────────────────────────┘
```

---

## 2. 生成流水线全生命周期

世界生成器统一负责全流程调度。生成过程遵循严格的物理因果与社会演化依赖顺序：

```mermaid
flowchart TD
    M[1. 球面网格剖分 Mesh Generation] --> T[2. 板块构造模拟 Tectonics Simulation]
    T --> L1[3a. 主大陆生成 Mainland Cores]
    L1 --> CR[3b. 地壳类型/年龄与俯冲极性 Crust & Subduction]
    CR --> L2[3c. 岛屿群系 Island Groups]
    L2 --> E[4a. 构造物理高程 Tectonic Elevation]
    E --> GE[4b. 守恒侵蚀与沉积 Geomorphic Evolution]
    GE --> SL[4c. 面积加权海平面 Area-balanced Sea Level]
    SL --> LK1[5. 地形最大湖盆 Topographic Lakes (L1)]
    LK1 --> C1[6. 初步气候与降水 Provisional Climate]
    C1 --> R1[7. 初步径流汇流 Provisional Rivers]
    R1 --> LK2[8. 水文水平衡迭代 Lake Water Balance (L2)]
    LK2 --> F[9. 地理特征分类 Feature Classification]
    F --> C2[10. 最终气候与生物群系 Final Climate & Biomes]
    C2 --> R2[11. 最终河网与河宽 River Network]
    R2 --> LK3[12. 湖泊季节水平衡 Seasonal Lake Balance]
    LK3 --> H1[13. 聚落与宜居性评估 Settlements]
    H1 --> H2[14. 海上接触与交通网络 Transport & Maritime]
    H2 --> H3[15. 区域大宗贸易与市场 Trade & Markets]
    H3 --> H4[16. 文化圈形成与扩散 Cultural Zones]
    H4 --> H5[17. 国家政体与领土扩张 Polities & Borders]
    H5 --> H6[18. 宗教信仰与圣地系统 Religions & Holy Sites]
    H6 --> H7[19. 语言音系与地名生成 Linguistics & Naming]
```

### 生成阶段明细说明

1. **网格构建（Mesh Construction）**：细分正二十面体生成离散球面 Voronoi 区域，建立无边界邻接图；
2. **板块动力学（Tectonics）**：泊松采样板块种子，以欧拉角速度计算球面刚体运动与边级应力场；
3. **陆地、地壳与岛屿（Landmass, Crust & Islands）**：先生成大陆核，再建立大陆/海洋地壳、洋壳年龄和俯冲极性，最后生成受上盘位置与板块运动约束的 4 类岛屿；
4. **地形高程与地貌演化（Elevation & Geomorphology）**：结合大陆架、地壳厚度、上盘造山、下盘海沟、裂谷、转换断层、洋壳热沉降与岛屿年龄沉降建立物理高程；随后执行面积守恒的坡面侵蚀和径流代理侵蚀/沉积，最后按球面面积分位确定海平面；
5. **两阶段水文迭代（Two-Pass Hydrology）**：
   - **Pass 1 (L1)**：利用 Priority-Flood 搜索地形封闭洼地，建立最大潜在湖盆；
   - **Pass 2 (L2)**：运行风生洋流、大气水汽输送与初步河流汇流，以实际流域入流量与湖面蒸发量求解水水平衡，确定真实湖面与内流/外流属性；
6. **生态系统（Biomes）**：根据最终温湿场判定 20 类生物群系；
7. **人文地理与地缘社会（Human & Geopolitics）**：基于自然地理约束生成聚落、海陆交通网、大宗商品供需贸易、文化圈层、国家疆域、宗教信仰与地名命名系统。

---

## 3. 内存架构与数据模型

为了支撑数万到数十万多边形网格的高性能实时计算，系统摒弃了传统的面向对象节点指针设计，采用纯 **列式连续数组（TypedArray / Flat Arrays）** 内存布局。

### 核心数据模型

所有全局状态集中组织为扁平列式结构：

```text
struct WorldData {
    // 地形与形态标量场 (按网格单元对齐)
    baseElevation:          FloatArray[numRegions]     // 原始未填洼高程 (0.0 ~ 1.0)
    elevation:              FloatArray[numRegions]     // 包含平坦湖面的最终渲染高程 (0.0 ~ 1.0)
    physicalElevationMeters:FloatArray[numRegions]     // 相对海平面的权威基岩高程（海洋为负）
    seaLevelMeters:         Float                       // 从原始地形场扣除的面积加权海平面基准
    climateElevationMeters: FloatArray[numRegions]     // 由物理高程截断得到的气候海拔 (0 ~ 6000 米)
    continentality:         FloatArray[numRegions]     // 大陆度场 (0: 海洋, 1: 深陆腹地)
    
    // 海陆与地质岛屿分类
    baseLandMask:           ByteArray[numRegions]      // 海平面判定后的无湖泊陆地掩码
    landMask:               ByteArray[numRegions]      // 最终陆地掩码 (湖面标记为 0)
    regionFeature:          ByteArray[numRegions]      // 要素分类 (Ocean / Lake / Coast / Land)
    regionFeatureId:        IntArray[numRegions]       // 连通陆块/水体唯一 ID
    regionContinent:        IntArray[numRegions]       // 所属大陆 ID
    regionIslandType:       ByteArray[numRegions]      // 岛屿地质成因分类 (0:无, 1:岛弧, 2:热点链, 3:陆块碎片, 4:散落岛)
    regionIslandGroup:      IntArray[numRegions]       // 所属岛群 ID
    regionIslandAge:        FloatArray[numRegions]     // 相对地质演化年龄 (0:年轻高耸, 1:风化沉降)
    
    // 各子系统数据包
    tectonics:              TectonicData               // 欧拉速度、边级应力/俯冲极性、地壳类型/年龄/厚度
    climate:                ClimateData                // 气温、气压、风场、水汽、降水、径流、洋流
    lakes:                  LakeData                   // 湖盆深度、库容、盐度、蒸发、结冰状态
    rivers:                 RiverData                  // 汇流累积量、流向、河网掩码、季节性
    human:                  HumanData                  // 聚落、交通、商贸、文化、政治、宗教、地名
    
    landArea:               Float                      // 最终总陆地面积 (球面度)
}

struct HumanData {
    habitability:           FloatArray[numRegions]     // 综合宜居性场 (0.0 ~ 1.0)
    accessibility:          FloatArray[numRegions]     // 空间通行可达性场 (0.0 ~ 1.0)
    regionSettlementId:     IntArray[numRegions]       // 各单元聚落索引 (-1 为无聚落)
    settlements:            List[Settlement]           // 聚落实体 (名称、类型、人口、基础/商贸繁荣度、海港属性)
    maritimeContacts:       List[MaritimeContact]      // 潜在跨海接触链路与连通度
    transport:              TransportData              // 陆路道路掩码、道路/航运强度与季节性路线成本
    trade:                  TradeData                  // 5 类商品产需、进出口、市场准入度与路线运量
    culture:                CulturalData               // 文化圈归属、文化影响强度场与文化实体
    politics:               PoliticalData              // 国家疆界归属、行政控制力场与政体实体
    religion:               ReligiousData              // 主导信仰归属、宗教影响场、圣地与信仰实体
    naming:                 NamingData                 // 各文化语言音素库与命名规则
}
```

---

## 4. 增量重算与交互响应链

在前端交互时，系统根据 **有向无环依赖图（DAG）** 执行最小化增量重算：

```text
用户调节参数类型
 ├── [调整板块/大陆参数]  ──► 全量重新生成 GenerateWorld()
 ├── [调整地形/山脉参数]  ──► 仅重算地形 RegenerateElevation()
 ├── [调整气候/风带参数]  ──► 仅重算气候与水文 RegenerateClimate()
 ├── [调整河网阈值参数]  ──► 仅重算河网与水文 RegenerateRivers()
 ├── [调整聚落参数]      ──► 仅重算聚落 RegenerateHuman()
 ├── [调整交通道路参数]  ──► 仅重算交通与贸易 RegenerateTransport()
 ├── [调整商贸专业化]    ──► 仅重算商贸与文化 RegenerateTrade()
 ├── [调整文化圈参数]    ──► 仅重算文化与政治 RegenerateCultures()
 ├── [调整国家政体参数]  ──► 仅重算国家与宗教 RegeneratePolities()
 ├── [调整宗教传播参数]  ──► 仅重算宗教与地名 RegenerateReligions()
 └── [调整地名词库参数]  ──► 仅重算地名 RegenerateNaming()
```

### 级联依赖伪代码实现

```python
# 当用户调节地形高度/山脉强度时
function RegenerateElevation(mesh, data, params):
    provisionalLand = GenerateLandmass(mesh, data.tectonics, params)
    elevationData = GenerateElevation(mesh, data.tectonics, provisionalLand.landMask, params, provisionalLand.regionIslandType, provisionalLand.regionIslandAge)
    finalLand = ReconcileLandMask(mesh, provisionalLand, elevationData.landMask)
    data.baseElevation = elevationData.renderElevation
    data.physicalElevationMeters = elevationData.physicalElevationMeters
    data.climateElevationMeters = elevationData.climateElevationMeters
    data.baseLandMask = finalLand.landMask
    data.continentality = elevationData.continentality
    
    # 级联向下触发水文与下游所有系统重算
    RegenerateLakes(mesh, data, params)

# 人文地理子系统的级联传播链条
function RegenerateHuman(mesh, data, params):
    data.human = GenerateSettlements(mesh, data, params)
    RegenerateTransport(mesh, data, params)

function RegenerateTransport(mesh, data, params):
    data.human.maritimeContacts = GenerateMaritimeContacts(mesh, data, params)
    data.human.transport = GenerateTransportRoutes(mesh, data, params)
    RegenerateTrade(mesh, data, params)

function RegenerateTrade(mesh, data, params):
    data.human.trade = GenerateTradeAndMarkets(mesh, data, params)
    RegenerateCultures(mesh, data, params)

function RegenerateCultures(mesh, data, params):
    data.human.culture = GenerateCulturalZones(mesh, data, params)
    RegeneratePolities(mesh, data, params)

function RegeneratePolities(mesh, data, params):
    data.human.politics = GeneratePolitiesAndBorders(mesh, data, params)
    RegenerateReligions(mesh, data, params)

function RegenerateReligions(mesh, data, params):
    data.human.religion = GenerateReligionsAndHolySites(mesh, data, params)
    RegenerateNaming(mesh, data, params)

function RegenerateNaming(mesh, data, params):
    data.human.naming = GenerateNamesAndLanguages(mesh, data, params)
```

这种精确的单向级联依赖，使得在 3D 视图中拖动任意参数滑块均能实现毫秒级的快速响应。
