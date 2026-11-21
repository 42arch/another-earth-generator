# M3 Cartography 制图系统技术设计规范

> **日期**：2026-11-14
> **范围**：M3（Cartography 正式制图系统——自然世界 3D Globe & 2D Atlas、数据源适配、类 Mapbox Style JSON、五类批处理渲染管线与 Web 单轨收口）
> **状态**：已实现（Slice 1–Slice 5 全部落地并补齐单元测试，待用户授权后执行自动化检查与浏览器验收）
> **上游依据**：[PRD 第 8 章](PRD.md)、[技术设计](TECHNICAL_DESIGN.md#架构边界)、[世界数据契约](WORLD_DATA_CONTRACTS.md)、[当前进度](PROGRESS.md)

---

## 1. 设计目标与核心决策

### 1.1 核心目标
构建 `@another-earth/cartography` 生产级双视图制图引擎，彻底取代 `apps/web` 中早期的单阶段调试场景，实现以下闭环：

1. **单轨权威数据流**：彻底移除 `apps/web` 前 6 个单阶段调试生成展示（仅网格/板块/地形/气候/水文/生态），全仓统一围绕**已校验的完整自然世界 `WorldSnapshot` → `WorldMapReader` → `MapSourceRegistry` → `MapStyleDocument`（类 Mapbox Style JSON）→ `WorldViewport`（3D Globe + 2D Atlas）**运转。
2. **类 Mapbox Style JSON + 实例级 Data Source**：保留声明式 JSON 样式与数据源解耦架构，将底层渲染原语严格收敛为 **5 类标准图层类型**：`raster`、`fill`、`line`、`circle`、`symbol`（变宽河网转化为平滑水体多边形由 `fill` 渲染，配合远景 `line` 保底，不再单设异类 `river-ribbon` 渲染器）。
3. **全 GPU 批处理矢量与高质量中文注记**：每个样式图层控制在 1–2 次 Draw Call 内完成绘制；支持 `DataTexture` 极速换色底图、Gnomonic 带孔细分多边形、屏幕空间拐角连续 SDF 宽线/虚线、实例四边形 SDF 符号点，以及基于 `troika-three-text`（`BatchedText`）+ PCA 版图脊线弯曲排版 + 屏幕碰撞网格避让的锐利中文地名。
4. **3D 星球与 2D 地图集对等共享**：单一 `WebGLRenderer` / Canvas 同时管理 `GlobeView` 与 `AtlasView`（支持 Equirectangular、Equal Earth、Mercator 投影），共享同一套 Source、Style JSON、统一对数缩放标尺 `styleZoom` 与一致的要素/区域拾取契约。
5. **新生成与档案恢复 100% 对齐**：补齐 `WorldSnapshot` 与 `WorldMapReader` 缺失的环流显示场、确定性微地形纹理派生与对偶 Voronoi 边界重建，确保从档案恢复的世界与新生成的世界拥有完全一致的卫星、环流及专题地图表现，不依赖任何中间 `GenerationArtifact`。

### 1.2 明确不做的事项（YAGNI 边界）
- 不引入 MapLibre GL / Deck.gl / Cesium 等外部地图引擎；最终绘制 100% 由项目自控的 Three.js（WebGL2）完成。
- M3 阶段不提前编写无权威事实支撑的 M2 文明图层（国家、道路、聚落、宗教）；但 `DataSource` 与 5 类渲染器契约天然支持 M2 后续只增 Adapter 与 JSON 图层配置即可接入。
- 不实现可视化样式代码编辑器或外部任意字体上传；首版内置开箱即用的预设风格与静态开源中文字体资源。
- 不允许任何制图模块修改 `WorldSnapshot` 或将派生 GeoJSON / GPU Buffer 当作世界事实写回核心层。

---

## 2. 跨包边界与 `world-core` 数据闭环

### 2.1 单向依赖关系
```text
@another-earth/world-data  ──► 纯内容定义与词库（如 geography-zh 名称与群系元数据）
         │
         ▼
@another-earth/world-core  ──► 权威快照 WorldSnapshot、WorldStore 与只读 WorldMapReader
         │
         ▼
@another-earth/cartography ──► Source 适配器、Style JSON 编译器、3D/2D Three.js 渲染与拾取（零 DOM 面板状态，不改世界事实）
         ▲
         │
apps/web                   ──► Worker 生成编排、原子提交切换、HUD 面板（风格/专题/覆盖层/投影/月份）与区域详情侦测
```

### 2.2 `WorldSnapshot` 与 `WorldMapReader` 补齐规格
当前 `WorldSnapshot`（Schema 3）在脱离中间 `GenerationArtifact` 时存在三处制图缺口，按以下最小且自洽的方式在 `@another-earth/world-core` 收口：

1. **球面对偶 Voronoi 边界派生（不膨胀存档体积）**
   - `WorldSnapshot.mesh` 已持久化单位球 `centers`（3N）、`areaKm2`（N）与有序无向 CSR 邻接（`neighborOffsets`、`neighbors`）。
   - 在 `WorldMapReader` 首次访问网格几何时，按确定性球面拓扑从有序邻接环恢复 Delaunay 三角面外心（`dualVertices`）与每个区域的逆时针边界角点环（`boundaryCorners`）及共享边关系，缓存在该 `WorldMapReader` 实例内部。
   - 对外只提供带边界检查的只读遍历与拷贝写出接口，绝不暴露内部 TypedArray 引用。
2. **月度大气与海洋环流可选持久化字段**
   - 在 `ClimateState`（Schema 3 向后兼容可选字段 `circulation?`）中保存输出网格上的月度估算场（`month-major`，长度 `12N` 或量化 `Int16Array` / `Float32Array`）：
     - `windEastMps: DenseField<Float32Array>`、`windNorthMps: DenseField<Float32Array>`（10m 等效风速东/北分量，m/s）
     - `oceanEastMps: DenseField<Float32Array>`、`oceanNorthMps: DenseField<Float32Array>`（表层洋流东/北分量，m/s；陆地与缺测海域由 `oceanAvailable: DenseField<Uint8Array>` 明确标记，绝不用 `0` 冒充缺测）
     - `oceanWarmth: DenseField<Float32Array>`（范围 `[-1, 1]` 寒暖流代理）
   - `assembleNaturalWorld` 生成新快照时自动写入并纳入 `validateWorldSnapshot` 校验；旧 Schema 3 存档无 `circulation` 字段时仍合法，此时 `WorldMapReader` 对环流源明确报告不可用（`hasCirculation === false`）。
3. **地形坡度与卫星微地形表面细节**
   - **坡度（`slope`）**：由 `WorldMapReader` 根据 `elevationKm` 与相邻区域球面物理距离（`edgeAngularDistances * radiusKm`）确定性计算并缓存。
   - **卫星表面细节（Satellite Surface Detail）**：在 `WorldMapReader`（或快照可选表面特征）中基于快照 `metadata.seed`、网格单位球坐标、`elevationKm`、`landMask` 与 `crustType` 提供确定性的多尺度球面 Simplex 表面细节权重（山脊纹理、海岸细节、裸岩/碎石扰动），保证新生成与存档恢复的 `Satellite` 视图视觉一致，彻底解耦 `TerrainArtifact` 阶段传输。
4. **快速球面区域定位（替代 `O(N)` 线性扫描）**
   - `WorldMapReader.locateRegion(x, y, z)` 使用分层种子点 + CSR 邻域贪心爬山（Spherical Greedy Walk）定位最近 Voronoi 中心，在 L7（16.3 万格）/ L8（65.5 万格）下将单次拾取耗时从数毫秒降至 `< 0.05ms`。

### 2.3 `WorldMapReader` 公开接口契约
```ts
export interface MapMeshReader {
  readonly meshId: string
  readonly regionCount: number
  readonly cornerCount: number
  readonly edgeCount: number
  readonly physicalRadiusKm: number
  getRegionCenter: (region: number, out: { x: number, y: number, z: number }) => void
  getRegionAreaKm2: (region: number) => number
  getCornerPosition: (corner: number, out: { x: number, y: number, z: number }) => void
  getRegionDegree: (region: number) => number
  forEachRegionNeighbor: (
    region: number,
    visit: (neighborRegion: number, cornerA: number, cornerB: number, edgeId: number) => void,
  ) => void
  forEachEdge: (
    visit: (edgeId: number, regionA: number, regionB: number, cornerA: number, cornerB: number) => void,
  ) => void
  locateRegion: (x: number, y: number, z: number) => number
}

export interface WorldMapReader {
  readonly identity: Readonly<{
    snapshotId: string
    worldId: string
    revision: number
    meshId: string
    regionCount: number
  }>
  readonly planet: Readonly<{
    radiusKm: number
    axialTiltDegrees: number
  }>
  readonly capabilities: Readonly<{
    hasGeographicRegions: boolean
    hasGeographicNames: boolean
    hasSeaClassification: boolean
    hasCirculation: boolean
  }>
  readonly mesh: MapMeshReader
  field: (name: WorldMapFieldName) => FieldView
  monthlyField: (name: WorldMonthlyFieldName, month: number) => FieldView
  plates: () => readonly { readonly id: string }[]
  geographicRegions: () => GeographicMapRegions | null
  basins: () => readonly BasinMapSummary[]
  rivers: () => readonly RiverMapSummary[]
  forEachRiverRegion: (riverIndex: number, visit: (region: number, stepIndex: number) => void) => void
  lakes: () => readonly LakeMapSummary[]
  forEachLakeRegion: (lakeIndex: number, visit: (region: number) => void) => void
  ecologyDictionaries: () => Readonly<{
    potentialBiomeIds: readonly string[]
    landCoverIds: readonly string[]
  }>
}
```
- `WorldStore.mapReader()` 返回绑定当前已发布快照的 `WorldMapReader`。
- Web `GenerationController.candidateMapReader(snapshotId)` 仅对已通过 `WorldStore` 完整领域校验的待提交候选快照返回 `WorldMapReader`，供激活前预备 GPU 资源。

---

## 3. Data Source 适配器与拓扑几何派生

### 3.1 实例级 `MapSourceRegistry`
- 每个世界会话创建一个独立的 `MapSourceRegistry(reader)` 实例，严禁使用模块级全局变量或 `WeakMap` 隐式缓存。
- **两类标准数据源**：
  1. `RasterCellSource`：面向全球 `N` 个 Voronoi Cell 的稠密数值/分类属性视图及确定性 `noData` 元数据。
  2. `GeoJsonSource`：符合 RFC 7946 的只读 `FeatureCollection`（坐标统一为 `[lonDeg, latDeg]`，稳定 `feature.id` 来自领域实体 ID，属性仅存纯数据度量，不含颜色或像素宽度），对于 `symbol` 源可附带预计算的球面脊线样条元数据。
- **缓存与失效规则**：
  - 静态源缓存键：`${snapshotId}:${adapterVersion}:${sourceId}`。切换样式预设、开关图层或切换 3D/2D 视图时 **100% 命中缓存，零重算**。
  - 月度源缓存键：`${snapshotId}:${adapterVersion}:${sourceId}:m${month}`。切换月份仅解析当月 `climate-monthly` 与 `circulation-vectors`（可在实例内保留最近月份 LRU）。
  - 缺源与空集区分：当快照缺失某能力（如旧存档无 `regions` 或无 `circulation`）时返回 `{ unavailable: true, sourceId, reason }`，渲染层安全跳过引用该源的图层并在 UI 图例给出明确提示。

### 3.2 内置自然数据源清单（M3 全量）

| Source ID | 类型 | 几何种类 | 派生输入与关键特征 |
|---|---|---|---|
| `world-surface` | `raster` | Cell 字段 | 提供 `landMask`、`elevationKm`、`slopeDeg`、`crustType`、`plateIndex`、`annualTemperatureC`、`annualPrecipitationMm`、`koppenClass`、`biomeIndex`、`landCoverIndex`、`aridityIndex`、`growingSeasonMonths`、`annualRunoffMm`、`basinIndex`、`continentIndex`、`oceanIndex`、`seaIndex` 及卫星微纹理通道 |
| `climate-monthly` | `raster` | Cell 月切片 | 当前月（0–11）`temperatureC`、`precipitationMm`、`snowWaterEquivalentMm`、`snowfallMm`、`snowmeltMm`、`windSpeedMps`、`oceanSpeedMps`（带 `oceanAvailable` 掩码）、`oceanWarmth` |
| `land-areas` | `geojson` | `Polygon` / `MultiPolygon` | 从 `landMask` 追踪海陆共享对偶边闭合外环与内陆海孔洞，经球面角落平滑（Chaikin 保拓扑平滑）输出平滑大陆与岛屿轮廓 |
| `continent-areas` / `plate-areas` / `koppen-areas` / `biome-areas` / `land-cover-areas` | `geojson` | `Polygon` / `MultiPolygon` | 按分类 ID 提取连通区域边界环与孔洞，经三岔口锁定的共享边界中点细分与四点球面样条松弛（`buildSmoothedSharedBoundaryRings`）生成零裂缝平滑多边形面片（其中 `continent-areas` 同时覆盖大陆、大洋与海三类分区） |
| `lake-polygons` | `geojson` | `Polygon` / `MultiPolygon` | 从静态湖泊成员区域追踪外环与湖心岛孔洞，用与国界线相同的共享边界松弛；与国界或海岸重合的边直接采用那条边的顶点。属性含 `id`、`areaKm2`、`waterLevelKm`、`endorheic` |
| `river-polygons` | `geojson` | `Polygon` / `MultiPolygon` | **变宽河网面化源**：对每条河段中心路径做球面 Catmull-Rom 平滑，按节点累积年均流量 `accumulatedAnnualFlowM3s` 的幂律映射计算球面弧度半宽，向两侧切向法线偏移构建封闭多边形带；支流汇流节点补圆形衔接盖片（Confluence Cap），入湖端与入海端延伸至湖岸/海陆共享对偶边中点，确保水体无缝一体 |
| `river-centerlines` | `geojson` | `LineString` | 与 `river-polygons` 同源平滑中心线，携带 `id`、`strahlerOrder`、`annualMeanDischargeM3s`，专供全球远景最小像素线保底与线要素拾取 |
| `coastlines` | `geojson` | `LineString` / `MultiLineString` | 海陆交界平滑对偶边链，每条物理海岸边全局唯一输出一次 |
| `plate-boundaries` | `geojson` | `LineString` | 不同板块间的共享对偶边链，携带两侧板块 ID |
| `graticule` | `geojson` | `LineString` | 15° 间隔经纬线（单独标记赤道与本初子午线/日界线 `kind` 属性，供样式差异化线宽与虚线） |
| `circulation-vectors` | `geojson` | `LineString` | 按近似均匀球面间距抽稀采样的当月风场与洋流流向短弧及箭头翼线段，属性含 `kind: 'wind' \| 'ocean'`、`speedMps`、`warmth` |
| `geographic-labels` | `geojson` | `Point` (+Spine) | 已命名大陆与大洋注记源：通过面积加权球面切平面 PCA 计算版图延伸度（Elongation）；当延伸度 `>= 1.35` 时提取分段主轴样条控制点（`spinePoints`），否则选取保证位于版图内部的极点（Pole of Inaccessibility 近似网格中心），携带 `id`、`kind`、`displayName`、`areaKm2` |

---

## 4. 类 Mapbox Style JSON 规范与编译器（`StyleCompiler`）

### 4.1 样式文档结构（`MapStyleDocument`）
纯 JSON 可序列化对象，严格禁止内嵌 JS 函数：

- **顶层字段**：`version: 1`、`id`、`name`、`tokens: Record<string, StylePrimitive | StylePrimitive[]>`、`layers: readonly MapStyleLayer[]`。
- **不透明垫底色**：每个风格在 `tokens.background` 提供一个 `#rgb` / `#rrggbb` 颜色。3D 用与地表同拓扑、半径 `0.996` 的不透明壳体绘制，2D 用投影剪影面绘制。未铺满的海洋或孔洞落到这层；壳体写深度，挡住另一侧的河湖。栅格专题 `raster-opacity` 为 `1`。缺省或非法颜色回退 `#0a2342`。
- **默认图层**：`defaultEnabledLayerIds` 列出选中该风格时点亮的图层。`world-surface` 是「地表」图层，绘制该风格的 `slot: 'base'` 表面，可与专题同时显示；关掉后只留垫底色。政区图默认不点亮地表，无归属陆地由政区填充画成不透明暖灰 `#6f6a64`，与风格垫底的浅蓝海洋区分。地表始终画在最下层：底图栅格贴在半径 `1`，底图陆地填充略高出垫底壳体；专题栅格和专题填充在其外侧。河湖、线、圆和注记再向外。专题未铺满的海洋仍露出地表。
- **默认三维效果**：`defaultGlobeEffects` 在选中风格时设置大气光晕和昼夜光照。仿真卫星两者都开，其余风格都关。自转、经纬网和 Cell 边界不随风格改变。2D 地图不绘制大气光晕和昼夜光照。
- **5 种标准图层 `type`**：`'raster' | 'fill' | 'line' | 'circle' | 'symbol'`。
- **三层制图槽位（MAP-02 对齐）**：
  - `slot: 'base'`：底图背景层（如标准海陆高程、卫星地表、羊皮纸底色）。
  - `slot: 'thematic'` + `thematicId: string`：互斥或主从可控的科学/地理专题层（如 `koppen`、`biomes`、`land-cover`、`temperature`、`precipitation`、`annual-temperature`、`annual-precipitation`、`elevation`、`slope`、`plates`、`crust`、`continents`、`runoff`、`snow`、`basins`、`wind-speed`、`ocean-speed`）。每次激活当前选中的 `thematicId`（选 `none` 时仅显示底图）。
  - `slot: 'overlay'` + `overlayId: string`：可独立多选叠加的覆盖层（如 `rivers`、`lakes`、`coastlines`、`plate-boundaries`、`graticule`、`wind-arrows`、`ocean-arrows`、`geographic-labels`、`cell-wireframe`）。
- **视图与缩放过滤**：`views?: ('globe' | 'atlas')[]`、`minzoom?: number`、`maxzoom?: number`、`filter?: StyleExpression`。

### 4.2 表达式算子与预编译优化
- **支持算子集**：
  - 取值：`['literal', v]`、`['get', prop]`、`['has', prop]`、`['token', name]`、`['zoom']`、`['coalesce', ...]`
  - 逻辑与比较：`==`、`!=`、`>`、`>=`、`<`、`<=`、`!`、`all`、`any`
  - 分支与映射：`case`、`match`、`palette`（按非负整数模调色板长度取色，支持独立 `noData` 分支）、`step`、`interpolate`（`['linear']` 与 `['exponential', base]`，支持数值与线性空间颜色插值）
- **编译期静态检查与降维（`StyleCompiler`）**：
  1. 校验图层 `type` 与目标 Source 几何类型的兼容性（如 `fill` 只能绑 `Polygon` GeoJSON，`raster` 只能绑 `RasterCellSource`）。
  2. 分析每个 `paint` / `layout` 属性表达式的依赖级别：
     - `constant`：编译期直接折叠为常量（如固定线性 RGB、固定宽度）。
     - `feature`：仅依赖要素属性/Cell 值，在 Source 绑定时一次性批量求值为 TypedArray，相机缩放时 **零 CPU 求值**。
     - `zoom`：仅依赖 `['zoom']` 与常量，缩放变化时只更新材质 Uniform，**零顶点缓冲上传**。
     - `zoom-feature`：同时依赖 `['zoom']` 与要素属性，缩放跨越死区阈值（`Δzoom >= 0.05`）时按预编译扁平闭包批量更新属性缓冲。
  3. **自动图例描述符导出**：编译器从当前激活的底图/专题图层提取 `LegendDescriptor`（连续色带断点+单位，或离散类别标签+颜色+`noData` 说明），直接驱动 UI 图例与面积加权分布统计卡片。

### 4.3 首版内置地图风格 Presets（`cartography/src/styles/presets/`）
全部以标准 JSON 定义并通过同一 `StyleCompiler` 编译：
1. `satellite`：**仿真卫星**（默认风格；`raster-mode: 'satellite'` 放在 `layout`，渲染时 `paint` 没有该字段就读 `layout`。地表按年均温、年降水和干湿度在裸地与植被之间混合，再加浅海水深过渡、裸岩、微纹理；雪线和陆地冰盖、海冰都按最暖月绘制，最暖月高于 2°C 不再因海拔另铺白雪、高程晕渲、海洋镜面水层随海冰覆盖度淡出、大气边缘散射与可选太阳昼夜晨昏光照）。
2. `standard-atlas`：**标准地图集**（柔和陆地分级色、清新浅蓝海洋、海岸细描边、河湖一体水系面与深灰高可读中文地名）。
3. `physical-relief`：**自然地理地形图**（清晰海深与陆高阶梯色带 + 增强法线晕渲 + 流域水系突出）。
4. `minimal-light`：**极简明亮底图**（低饱和暖白陆地与淡灰蓝海洋，专为高对比度叠加任意气候/生态/地质专题而设计）。
5. `minimal-dark`：**极简暗色底图**（深岩灰陆地与深海蓝底色，契合暗色 HUD 工作台及风场/洋流高亮展示）。
6. `historical-parchment`：**古典羊皮纸风格**（暖羊皮纸色调、墨棕海岸与国界、朱砂首都星与楷体国名、聚落注记）。

---

## 5. 双视口架构与五类批处理渲染管线

### 5.1 `WorldViewport` 与统一缩放标尺
- **单一 `THREE.WebGLRenderer`**：输出色彩空间固定为 `SRGBColorSpace`；像素比采用 `Math.min(window.devicePixelRatio, 2)`（兼顾 Retina 清晰度与 L7/L8 填充率稳定性，可通过配置覆盖）。
- **对等双视图**：
  - `GlobeView`：单位球（半径 `1.0`）透视相机，自定义球面拖拽旋转、滚轮指数缩放、可选平滑自转。自转绕行星极轴转动地球本身，相机、星空和太阳方向保持不动，因此晨昏线不随地表移动；拖拽灵敏度仍随相机离地高度自适应衰减（拉近看局部细节时不漂移）。
  - `AtlasView`：正交相机平面视图，内置三种可实时切换的地图投影：**`equirectangular`（等距圆柱）**、**`equal-earth`（等面积自然地球）**、**`mercator`（墨卡托，纬度截断 `±85.05°`）**。对于支持水平环绕的投影（如等距圆柱），在主地图左右两侧挂载共享材质与缓冲的环绕副本（`[-worldWidth, 0, +worldWidth]`），平移越过 `±180°` 时相机坐标无缝回绕。
- **统一 `styleZoom`（`0`–`12`）与视角保持**：
  - 定义 `visibleArcRadians` 为当前视口垂直高度所覆盖的行星表面弧度：$\text{styleZoom} = \text{clamp}(\log_2(\pi / \text{visibleArcRadians}), 0, 12)$。
  - 在 `GlobeView` ↔ `AtlasView` 切换或切换 2D 投影时，自动读取当前视口中心的地理经纬度 `(lon, lat)` 与 `styleZoom`，对向视图精准对齐同一地理位置与视觉比例尺。

### 5.2 五类渲染原语（Renderers）技术规格

#### 1) `RasterLayer`（索引网格 + `DataTexture` 极速查表 + 分类边界保拓扑角点松弛）
- **几何拓扑**：
  - **3D Globe**：构建共享 `N` 个区域中心 + `F` 个对偶角点的索引三角网（带 `uint32 cellId` 平面整数属性 `flat varying float vCellId` 的紧凑三角扇），同一 `meshId` 下**全生命周期只构建一次基础几何**。
  - **2D Atlas**：对跨 `±180°` 子午线与极区的 Voronoi 单元三角形做精确地理框裁切（Sutherland-Hodgman），记录每个裁切面片的 `cellId`，仅在切换投影时重建平面几何。
  - **分类专题共享边界平滑（`acquireSmoothedDualCorners`）**：针对 `thematic-continents`（陆海分区）、`thematic-koppen`（Köppen 气候带）、`thematic-biomes`（潜在生物群系）与 `thematic-land-cover`（自然地表覆盖）四类离散分类专题图层，对跨不同分类的共享对偶角点执行三岔口锁定的球面拉普拉斯角点松弛（`valence === 2` 的边界角点沿共享边界链平滑，三岔口 `valence !== 2` 严格锁定，位移受 `0.46 * min(da, db)` 钳制以保每个 Voronoi 单元恒为凸扇形）。直接用松弛后的角点构建 `RasterLayer` 索引几何（按 `(meshId, cacheKey)` 缓存），从而在不依赖大跨度球面多边形三角剖分的前提下实现 **100% 零裂缝、零穿透、零碎片的平滑分类边界**，且与 `coastlines` 海岸线顶点完全重合。
- **极速着色更新**：
  - CPU 按预编译的 `raster-color` / `raster-opacity` 求得长度为 `N * 4`（RGBA8 或 RGBA16F）的颜色数组，写入尺寸为 $W \times H$（如 $1024 \times 1024$，`NearestFilter`）的 `THREE.DataTexture`。
  - WebGL2 Shader 通过 `texelFetch(uCellColorTex, ivec2(cellId % width, cellId / width), 0)` 直接取色，并可选叠加基于预计算单元法线梯度的 `raster-hillshade` 明暗调制。
  - **收益**：切换任何分类/连续专题或拖动 12 个月份滑块时，无需遍历百万级三角形顶点，单次纹理上传 `< 2ms`。

#### 2) `FillLayer`（球面分块保拓扑平滑 GeoJSON 多边形 + Gnomonic 带孔剖分 + 河湖一体水体面）
- **分类面要素球面分块与共享边界平滑（`buildTiledSmoothedGroupPolygons`）**：
  - 针对 `continent-areas`（陆海分区）、`koppen-areas`（Köppen 气候带）、`biome-areas`（潜在生物群系）、`land-cover-areas`（自然地表覆盖）、`plate-areas`（构造板块）与 `land-areas`（陆地底图）等矢量分类面数据源，先将每个分类区域按 `24° × 20°` 球面分块拆分为同一 `MultiPolygon` 要素下的局部子多边形（跨度 `< 25°`，不跨半球、不环绕极点），从根源上消除环绕极点或超半球大环在 2D 绕向与立方体裁剪下的退化。
  - 通过 `buildSmoothedSharedBoundaryRings` 的 `smoothEdgeMask` 掩码，**仅对不同分类之间的真实共享边界边插入球面四点样条中点并协同松弛度为 2 的边界角点**（三岔口与分块接缝交点严格锁定），而同一分类内部的分块接缝保持未松弛的直对偶边共享顶点，从而同时保证**分类外边界平滑共形（与 `coastlines` 海岸线 100% 顶点重合）**与**同分类内部接缝零裂缝、零重叠**。
- **球面三角化与 2D 投影无裂缝流程**：
  1. 将每个 GeoJSON `Polygon`（含外环与任意数量内孔）投影到以其质心为切点的局部球面心射切平面（Gnomonic Projection；跨大范围要素先按立方体六面分块裁切）。
  2. 使用 `earcut` 执行带孔平面三角剖分，保证复杂曲折湖泊、内陆海与群岛大陆绝不漏孔或缠绕错乱。
  3. 对球面角距大于 `0.036 rad` 的三角形边递归球面中点细分（`GlobeView` 下严格归一化贴合 `1.0 + layerSurfaceOffset` 球壳，不穿透地表；`AtlasView` 下直接复用 3D 球面 Gnomonic 细分后的微元三角形，以每个微元三角形 3D 质心经度为基准解卷绕并按 `[-180, 180] × [-maxLat, maxLat]` 凸裁剪后投影，彻底消除多进出凹海湾在 `±180°` 平面裁剪下产生的横穿全图拉伸伪影）。传入 `reader` 时，`continent-areas`、`koppen-areas`、`biome-areas`、`land-cover-areas`、`plate-areas` 直接按每个区域的平滑对偶边界构扇形面，与海岸线共享同一套角点和边中点，避免 Gnomonic 耳切在色块内部留下裂纹。
  4. `clipPolygonAtAntimeridian` 在竖直边界 `±180°` 处按进出焦点排序配对生成独立简单环，避免凹湾多次跨越日界线时沿 `±180°` 形成重叠桥接边。
- **批处理与无重影绘制**：
  - 同一图层所有要素合并为 **1 个 `BufferGeometry`**，附带 `featureIndex` 属性从样式颜色表取色。
  - 分类专题面层（`thematic-continents`、`thematic-koppen`、`thematic-biomes`、`thematic-land-cover`、`thematic-plates`）与水系层（`lake-polygons` + `river-polygons`）均使用不透明深度写入（`fill-opacity: 1`），彻底杜绝半透明透底与河湖交接重叠变暗伪影。

#### 3) `LineLayer`（连续折线屏幕空间 Miter/Bevel SDF 宽线）
- **几何构建**：
  - 对每条连续路径采样球面弧点（3D）或反经线裁切后的投影折线点（2D），计算从要素起点累计的弧长 `lineDistance`（**跨 `±180°` 裁切后的后半段继承前半段累计弧长，保证跨日界线虚线相位连续**）。
  - 每个折线节点输出左右对称的 2 个带状顶点，携带 `prevPosition`、`currPosition`、`nextPosition`、`side ∈ {-1, +1}`、`lineDistance` 与 `featureIndex`，整层合并为 **1 个 `BufferGeometry`**。
- **Shader 特性**：
  - Vertex Shader 将前、中、后三点变换至屏幕像素空间（CSS px × DPR），计算相邻切线角平分线 Miter 向量并限制最大斜接比（`miterLimit = 2.5`，锐角平滑退化切角），支持圆头/平头端点（Cap）。
  - Fragment Shader 利用横向有符号距离 `abs(vSide)` 与 `fwidth` 实现 **1px 解析边缘抗锯齿**、可选双线描边（`line-casing`）以及按线宽倍数定义的周期虚线（`line-dasharray`）。

#### 4) `CircleLayer`（实例屏幕四边形 + 多符号 SDF）
- **几何构建**：单个 4 顶点单位正方形 `InstancedBufferGeometry`，实例属性存放世界坐标 `instancePosition`、3D 单位球法线 `instanceNormal`、颜色、描边色、半径、描边宽与符号枚举 `symbolShape`（圆、双环、五角星、菱形、三角）。
- **优势**：完全绕开硬件 `gl_PointSize` 上限，大图标在视口边缘平滑裁切不闪烁；3D 模式下利用 `dot(instanceNormal, viewDir)` 自动隐藏地球背面标记并在地平线边缘做平滑淡出。

#### 5) `SymbolLayer`（原生 `FontFace` 自定义字体 + 2D EDT SDF 字形图集 + 3D 球面切平面贴地排版 + 碰撞避让）
- **字体加载与 SDF 字形管线**：
  - 支持在 `MapStyleDocument.fonts`、`CartographySessionOptions.fonts`、`session.loadFonts(fonts)` 或 `registerCustomMapFont(font)` 中声明并异步加载自定义字体文件（`.woff2`、`.woff`、`.ttf`、`.otf`、`data:`），通过浏览器原生 `FontFace` API 与 `document.fonts` 注册，并通过样式图层 `layout['text-font']` 与 `layout['text-weight']` 按预设或专题切换字体族（例如古典羊皮纸预设默认使用楷书/衬线体栈，其余预设使用现代黑体栈）。
  - 采用零外部依赖的 `GlyphAtlasBuilder` + 线性时间二维欧氏距离变换（2D Euclidean Distance Transform，`computeGlyphSdf`）将 Canvas2D 栅格化字形（Node/无头环境自动回退程序化矢量笔画）实时转换为 8-bit 有符号距离场（SDF，`128` 对应 `0.5` 等值线），Fragment Shader 通过 `fwidth(sdf)` + `smoothstep` 实现高分屏任意缩放下的矢量级锐利边缘与动态 `text-halo-width` / `text-halo-color` 描边。
  - 每个 `SymbolLayer` 使用单个 4 顶点 `InstancedBufferGeometry` 合批绘制整层所有可见字符，单次 Draw Call 完成渲染。
- **双排版模式（`symbol-placement`）与 3D 球面贴地投影**：
  1. `'point'`：点状注记；在 3D `GlobeView` 下同样投影至锚点局部球面切平面贴合球面，2D 下水平排列，支持相对点图标的屏幕偏移 `text-offset`（单位为 em，`+x` 向右、`+y` 向下）。
  2. `'spine'`（大陆、大洋及未来国家/山脉名）：读取 Source 提供的版图主轴样条曲线，按随相机距离自适应的角步长 `glyphStepRad`（3D）或屏幕像素字距（2D）沿弧线等距采样每个汉字的锚点与局部切线方向；3D Vertex Shader 沿单位球局部切线 $\mathbf{T}$ 与副切线 $\mathbf{B} = \text{normalize}(\mathbf{N} \times \mathbf{T})$ 在球面切平面上展开字符四角并归一化贴合 `1.0005` 球壳（随球面曲率自然透视压缩并在地平线边缘 `smoothstep(0.14, 0.34, dot(N, V))` 淡出，彻底消除屏幕 Billboard 悬浮感）；当相机旋转或地图朝向导致文字倒置时，自动反转字符排列方向，确保用户永远**从左向右正读中文**。
- **确定性屏幕空间避让（`CollisionGrid`）**：
  - 视口划分为 `32px × 32px` 空间哈希桶。当相机旋转、平移、缩放或视口尺寸改变时，按 `priority`（如 `areaKm2` 降序）依次将候选注记投影至屏幕像素矩形（水平 AABB 或弯曲文字逐字包围盒序列）：
    - 3D 模式下若首尾或中心字符处于球面背面（`dot(normal, cameraDir) <= 0.12`），直接隐藏；
    - 若与已放置的更高优先级文字或必显图标发生碰撞，则隐藏当前注记；
    - 2D 环绕视图自动为可见视口内的环绕副本独立执行碰撞检测。

---

## 6. 交互拾取（Picking）与会话生命周期（`CartographySession`）

### 6.1 统一拾取协议（`MapPickResult`）
指针按下到抬起位移 `<= 4px` 判定为点击拾取，3D 与 2D 视图执行同一套分层命中规则：
1. **可见矢量要素优先**（按样式图层逆序，即视觉最顶层优先）：
   - `circle` / `symbol`：屏幕像素距离 `<= radius + hitTolerancePx (6px)`；
   - `line`：屏幕空间线段最短距离 `<= lineWidth * 0.5 + hitTolerancePx (5px)`；
   - `fill`（仅显式声明 `interactive: true` 的图层，如湖泊、大陆区划）：射线/平面点在多边形内判定。
2. **地表 Voronoi 区域兜底**：
   - 3D：射线与单位球求交得到 `(x, y, z)`，调用 `reader.mesh.locateRegion(x, y, z)`；
   - 2D：将屏幕点击平面坐标经当前 `MapProjection.invert(px, py)` 逆投影为 `(lon, lat)` 转单位球坐标，再调用 `locateRegion`。
3. **返回结构**：
```ts
export interface MapPickResult {
  readonly snapshotId: string
  readonly viewMode: 'globe' | 'atlas'
  readonly regionId: number
  readonly coordinates: Readonly<{ longitudeDegrees: number, latitudeDegrees: number }>
  readonly featureHit?: Readonly<{
    layerId: string
    sourceId: string
    featureId: string
  }>
}
```
Web 收到 `MapPickResult` 后，校验 `snapshotId === publishedSnapshotId`，再通过 `controller.queryWorldRegion(regionId, month)` 或 `river(id)` / `lake(id)` / `continent(id)` 读取权威事实渲染右侧侦测面板，并更新 `viewState.selection` 驱动地图内置高亮层。

### 6.2 `CartographySession` 原子生命周期与异常隔离
```ts
export interface CartographyViewState {
  readonly viewMode: 'globe' | 'atlas'
  readonly projectionId: 'equirectangular' | 'equal-earth' | 'mercator'
  readonly styleId: string
  readonly customStyle?: MapStyleDocument
  readonly activeThematicId: string | null
  readonly enabledOverlayIds: readonly string[]
  readonly climateMonth: number // 0..11
  readonly globeEffects: Readonly<{
    rotate: boolean
    rotateSpeedDegreesPerSecond: number
    atmosphere: boolean
    dayNight: boolean
    polarIce: boolean
  }>
  readonly selection: Readonly<{
    regionId: number | null
    featureId?: string | null
  }>
}

export interface PreparedWorldMap {
  readonly snapshotId: string
  dispose: () => void
}

export interface CartographySession {
  readonly activeSnapshotId: string | null
  readonly activeLegend: LegendDescriptor | null
  prepareWorld: (
    reader: WorldMapReader,
    viewState: CartographyViewState,
    options?: { signal?: AbortSignal },
  ) => Promise<PreparedWorldMap>
  activateWorld: (prepared: PreparedWorldMap) => void
  setViewState: (next: CartographyViewState) => void
  resetCamera: () => void
  dispose: () => void
}
```
- **失败不破旧图**：`prepareWorld` 在后台/分帧完成新世界 `MapSourceRegistry` 初始化、当前活跃视图首屏几何构建与 Troika 初始文字同步。若途中 `AbortSignal` 取消或抛错，`prepareWorld` 内部立即 `dispose` 所有临时对象并向上抛出错误；当前正在显示的旧世界画面、拾取与图例保持原样。
- **原子提交与旧资源回收**：`WorldView.svelte` 在 `prepareWorld` 成功后同步调用 `controller.commitWorld(snapshotId)` 与 `session.activateWorld(prepared)`，旧世界的 GPU Buffer / Texture / Material 在新世界完成首帧绘制后立即确定性释放，杜绝显存泄漏。
- **自定义样式容错**：若传入非法 `customStyle`，`StyleCompiler` 抛出带路径原因的 `StyleValidationError`，会话保留上一套有效样式不中断渲染。
- **WebGL 上下文恢复**：监听 `webglcontextlost` / `webglcontextrestored`，恢复后自动基于当前持有的 `WorldMapReader` 与 `MapSourceRegistry` 重建活跃视图 GPU 对象。

---

## 7. `apps/web` 单轨收口与 UI 调整

1. **移除阶段调试包袱**：
   - 参数面板移除“生成内容（仅网格 / 板块 / 基础地形 / 气候 / 水文 / 生态）”下拉选择器，生成按钮固定执行**完整自然世界（`world`）**生成并发布权威快照；Worker 协议清理不再被 UI 调用的单阶段渲染耦合路径（保留核心包 Stage 单元测试不变）。
   - 彻底删除 `apps/web/src/world-view/` 下旧的调试渲染模块：`world-scene.ts`、`map-render-data.ts`、`map-theme-data.ts`、`map-overlay-data.ts` 及对应的旧单测，替换为针对新 `CartographySession` 与图例统计的测试。
2. **补齐正式制图交互控件**：
   - **左侧工具条（`Sidebar`）**：贴左上方的浮动窄图标条，高度随内容，圆角与其他面板一致，不拉满视口。最上方为随机，其下为视图、参数、图层、概览、侦测，底部为分享与设置。分享弹窗顶部显示当前参数链接和复制按钮，并导出当前视口 PNG。参数链接为 `#w=9.` 加上相对默认值的压缩差值；旧版链接不还原。导入导出世界档案尚未接入。各项均用图标，悬停显示名称。工具条不显示种子。视图在条右侧弹出选择卡，分 3D（星球）与 2D（三种投影）两组。设置弹层包含图例显示、地图导航、经纬网格、Cell 边界网格和自转。自转仅 3D 可用，且不随风格改变；开启后在其下显示角速度滑块，范围 0.1–30°/秒，默认 0.6°/秒。
   - **图层抽屉（`LayerBar`）**分三块：
     1. **风格**：6 套内置预设（仿真卫星 / 标准地图 / 自然地理 / 极简明亮 / 极简暗色 / 古典羊皮纸）。
     2. **图层**：地表与专题使用同一类图层按钮。地表按当前风格绘制表面，可与一个专题同时选中；专题仍互斥（高程、板块、陆海分区、气温、降水量、Köppen、风速、洋流速度、积雪、年径流、流域、生物群系、自然覆盖）。气温和降水量默认显示年统计；图例内的「按月显示」切到对应月统计并露出月份滑块。积雪、风速、洋流始终显示月份滑块。覆盖与注记多选（河网、湖泊、海岸线、板块边界、风向、洋流、大陆与大洋地名）。
     3. **辅助显示**：大气光晕、昼夜光照、两极冰盖。大气光晕和昼夜光照仅 3D 可用；两极冰盖仅仿真卫星可切换，默认显示。切换风格时大气光晕和昼夜光照按 `defaultGlobeEffects` 重设；两极冰盖保持当前选择。
   - **概览面板（`OverviewPanel`）**：替换原顶栏「显示」菜单，承载行星自然概览、生成管线缓存和网格与制图性能。
   - **图例与分布统计卡片**：直接消费 `session.activeLegend` 与 `WorldMapReader` 面积加权统计，保证图例色块/色带与画面 100% 同源。
   - **右侧侦测面板（`RegionInspector`）**：点击地图任意位置后，统一通过 `controller.queryWorldRegion(regionId, climateMonth)` 及关联实体查询（河流、湖泊、流域、大陆/大洋）展示权威物理与地理指标。

---

## 8. 目录结构规划

```text
packages/cartography/src/
├── sources/
│   ├── types.ts                  # RasterCellSource / GeoJsonSource / SourceUnavailable 契约
│   ├── registry.ts               # 实例级 MapSourceRegistry、惰性缓存与月份局部失效
│   ├── topology/
│   │   ├── ring-tracer.ts        # 对偶边外环/孔洞提取与球面绕向判定
│   │   ├── spherical-smooth.ts   # 球面 Chaikin / Catmull-Rom 保拓扑平滑
│   │   ├── hydrography-buffer.ts # 变宽河道球面偏移多边形、汇流圆片与河湖衔接
│   │   └── territory-spine.ts    # 面积加权球面切平面 PCA 与版图脊线样条提取
│   └── adapters/
│       ├── surface-raster.ts     # world-surface 与 climate-monthly 栅格源适配
│       ├── area-sources.ts       # land-areas / continent-areas / plate-areas
│       ├── hydro-sources.ts      # lake-polygons / river-polygons / river-centerlines
│       ├── line-sources.ts       # coastlines / plate-boundaries / graticule / circulation-vectors
│       └── label-sources.ts      # geographic-labels 中文名称与脊线适配
├── styles/
│   ├── spec.ts                   # MapStyleDocument、5 类图层、表达式与 Legend 类型定义
│   ├── compiler.ts               # 静态 Schema 校验、表达式预编译闭包与图例提取
│   └── presets/                  # 6 套内置 JSON 样式预设与统一注册表
├── projections/
│   ├── spherical-math.ts         # 球面坐标变换、大圆插值、切空间正交基
│   ├── map-projections.ts        # Equirectangular / Equal Earth / Mercator 正逆投影与 styleZoom 换算
│   └── seam-clipper.ts           # ±180° 反经线与极区多边形/折线裁切（保弧长相位）
├── rendering/
│   ├── viewport.ts               # WorldViewport（单 WebGLRenderer、双视图管理、DPR、动画循环）
│   ├── globe-view.ts             # 3D 透视相机、阻尼控制、星空、大气、海洋水面与太阳光照
│   ├── atlas-view.ts             # 2D 正交相机、平移缩放控制、水平环绕副本管理
│   ├── satellite-shader.ts       # 仿真卫星多通道地表着色与晕渲 Shader
│   └── layers/
│       ├── raster-layer.ts       # 索引网格 + DataTexture texelFetch 极速着色层
│       ├── fill-layer.ts         # Gnomonic + Earcut 带孔细分多边形批处理层
│       ├── line-layer.ts         # 屏幕空间连续 Miter/Bevel SDF 宽线与虚线批处理层
│       ├── circle-layer.ts       # Instanced Quad 多符号 SDF 点要素批处理层
│       ├── symbol-layer.ts       # Troika BatchedText 脊线弯曲/水平中文与 CollisionGrid 避让层
│       └── selection-layer.ts    # 选中区域边框与矢量要素高亮层
├── picking/
│   └── map-picker.ts             # 3D/2D 统一矢量屏幕容差命中与 locateRegion 区域兜底
├── session.ts                    # CartographySession 原子预备、激活、热切换与资源释放门面
└── index.ts                      # 公开 API 导出
```

---

## 9. 分步实施切片与验收矩阵

按可独立测试、渐进交付的 5 个切片实施。仅当切片改变当前能力、验证结论或公开契约时，更新 `docs/PROGRESS.md` 及直接受影响的契约文档；普通实现推进不追加文档日志。

| 切片 | 核心交付内容 | 关键单元测试与不变量验收 |
|---|---|---|
| **Slice 1：Core 数据闭环与 `WorldMapReader`** | 1. `ClimateState.circulation` 月度风/洋流字段组装、校验与存档编解码兼容；<br>2. `WorldMapReader` 对偶 Voronoi 边界重建、坡度与确定性卫星微纹理派生、邻域爬山 `locateRegion`；<br>3. `WorldStore.mapReader()` 与 Web `candidateMapReader`。 | • 对偶边界恢复与原始 `SphericalMesh` 角点/绕向一致性断言；<br>• `locateRegion` 随机 1,000 点与暴力最近点 100% 一致；<br>• 新快照含环流往返编解码通过，旧无环流快照兼容读取且 `hasCirculation === false`；<br>• 零可变 TypedArray 泄漏测试。 |
| **Slice 2：Source 体系、水系面化、PCA 脊线与 `StyleCompiler`** | 1. `MapSourceRegistry` 与全部内置自然 Source Adapters；<br>2. 河道变宽缓冲多边形（`river-polygons`）、平滑湖泊（`lake-polygons`）、带孔陆地/分区多边形与 PCA 中文脊线提取；<br>3. `StyleCompiler` 预编译求值、静态校验、6 套内置 JSON 预设与结构化图例导出。 | • 所有派生 Polygon 外环逆时针/内孔顺时针、闭合且坐标有限；<br>• 河道多边形面积正比于流量单调递增，汇流口无断裂；<br>• 切换样式不触发 Source 重算，切换月份仅重算月度 Source；<br>• 非法 JSON 算子、缺源、几何类型错配被准确拦截；6 套内置 Preset 100% 通过编译校验。 |
| **Slice 3：3D `GlobeView` + 5 类 GPU 批处理渲染器** | 1. `RasterLayer`（`DataTexture` 查表 + `Satellite` 地表/水面/大气/昼夜）；<br>2. `FillLayer`、`LineLayer`（连续 Miter SDF + 虚线）、`CircleLayer`（实例 SDF）、`SymbolLayer`（Troika 中文静态字体 + 脊线弯曲 + `CollisionGrid` 避让）；<br>3. 3D 拾取、`SelectionLayer` 与 `CartographySession` 原子生命周期。 | • Gnomonic 带孔大面球面细分无退化/翻转三角形，大圆弦高受控；<br>• 连续折线扩边拐角无裂口、跨段虚线距离连续；<br>• `CollisionGrid` 优先级避让、背面剔除与中文字符正读方向测试；<br>• `prepareWorld` 取消/异常时旧世界保持激活且 GPU 对象释放计数归零。 |
| **Slice 4：2D `AtlasView` 多投影与反经线裁切** | 1. Equirectangular / Equal Earth / Mercator 正逆投影与统一 `styleZoom` 换算；<br>2. `±180°` 反经线与极区多边形/折线裁切器、水平无缝环绕副本；<br>3. `WorldViewport` 3D ↔ 2D 无缝切换与 2D 统一拾取。 | • 正逆投影往返精度误差 `< 1e-6`；<br>• 跨越 `±180°` 的多边形、河道面与海岸线裁切后不产生横穿全图的伪影线段，虚线相位保持连续；<br>• 同一地理要素在 3D 与 2D 下拾取返回相同的 `regionId` 与 `featureId`；切换视图中心经纬度保持不变。 |
| **Slice 5：`apps/web` 单轨收口、UI 升级与旧代码清理** | 1. 移除前 6 个旧单阶段生成 UI，全面切换至 `CartographySession`；<br>2. 接入 3D/2D 切换、投影切换、6 套风格 Preset、三层图层面板、动态图例统计与侦测面板；<br>3. 删除旧 `world-scene.ts` / `map-render-data.ts` / `map-theme-data.ts` / `map-overlay-data.ts`。 | • 生成成功、取消、失败回滚全流程 Controller 与 UI 状态测试；<br>• 切换风格/专题/覆盖层/月份/2D↔3D 绝不触发 Worker 重新生成世界；<br>• 全仓无残留阶段调试死代码与跨包私有路径导入。 |
