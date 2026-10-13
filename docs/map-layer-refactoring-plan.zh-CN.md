# 地图图层与样式渲染系统治理与重构实施方案

> **文档定位**：针对当前地图图层与样式系统“概念模型重叠、双轨管线并存、显隐逻辑分散、Discovery 胶水代码繁琐”等问题，制定一份结构清晰、职责正交、极易扩展全新视觉风格（如羊皮纸、蓝图）且可平滑落地的重构实施方案。

---

## 一、 现状痛点诊断与重构目标

### 1.1 核心矛盾总览
- **概念维度混淆与倒挂**：
  - “真实卫星（Satellite）”本质是一套完整的视觉制图风格，却被降维塞进了底图枚举；
  - “国家/民族/宗教”等专题矢量面（Thematic Fills）误当成单选互斥的“底图（BaseMap）”，导致无法在卫星影像或高程图上叠加行政区划面；
  - `mapStyle` 缩窄为仅能选 `light` / `standard` / `dark` 的调色板，且对卫星图无效。
- **状态管理多头**：图层显隐同时受 `params.appearance.overlays`、`layer.layout.visibility`、`source.overlay` 以及 `GlobeLayerSet` 内部硬编码判断约束。
- **渲染管线割裂**：`WorldColorizer`（写死的 CPU 色带与 switch-case）与 `StyleRuntime`（声明式 Mapbox 表达式）双轨运行。
- **装配逻辑碎片化**：按类型拆分出 4 个独立的 `discovery.ts` 文件，并在各图层使用魔数浮点数（如 `6.75 + order * 0.25`）拼接深度顺序。

### 1.2 预期重构目标
1. **统领全局的顶级 MapStyle**：将 `Satellite` 提拔为一级制图风格，与 `Standard`、`Light`、`Dark` 以及未来扩展的 `Parchment`（羊皮纸）并列。每个 Style 是一个自包含、可导出的纯 JSON/TS 样式文档。
2. **插槽式地表物理场（Surface Field Slot）**：每个 MapStyle 自带默认底表（如 Satellite 自带遥感影像，Parchment 自带古卷泛黄底色），同时支持将底层网格动态插槽切换为科学物理场（气温、降水、DEM、板块等），而不破坏上层注记和线网。
3. **正交的专题矢量面（Thematic Fills）**：国家疆域、民族、宗教等专题面作为独立的多选图层，可半透明叠加在任意地表之上。
4. **彻底废除 `WorldColorizer`（Zero-Legacy）**：所有地表着色统一由基于样式表达式的 `RasterSurfaceRenderer` 和专用 `SatelliteSurfaceRenderer` 驱动。
5. **统一渲染工厂（LayerFactory）**：消灭分散的 Discovery 胶水文件，由图层栈顺序自动推导深度与渲染批次。

---

## 二、 目标架构设计：正交五层渲染模型

```mermaid
flowchart TD
    subgraph UI_State [表现层状态 (WorldAppearanceConfig)]
        Style[mapStyle: 'satellite' | 'standard' | 'light' | 'dark' | 'parchment'...]
        Surface[surfaceField: 'default' | 'dem' | 'temperature' | 'precipitation' | 'plates'...]
        Thematics[thematicFills: { polities: true, ethnicity: false, religions: false... }]
        Aux[auxiliary: { graticule: true, wireframe: false, atmosphere: true, clouds: true }]
        Overlays[vectorOverlays: { rivers: true, routes: true, borders: true... }]
        Labels[annotations: { cities: true, sacredSites: true, labels: true... }]
    end

    subgraph StyleDoc [顶级样式文档 (MapStyleDocument)]
        Tokens[主题色彩与字体 Token (Design Tokens)]
        Sources[数据源注册: raster / geojson]
        LayersStack[统一图层栈 layers: MapStyleLayer[]]
    end

    subgraph Factory [统一图层工厂 (LayerFactory)]
        LF[LayerFactory.create] --> R_Aux[AuxiliaryRenderer (经纬网/网格/大气/云)]
        LF --> R_Surface[SurfaceRenderer (插槽式: 卫星/纯色/科学色带)]
        LF --> R_Fill[StyledFillRenderer (专题面)]
        LF --> R_Ribbon[RibbonRiverRenderer (带状水系)]
        LF --> R_Line[StyledLineRenderer (路网/国界)]
        LF --> R_Symbol[StyledSymbolRenderer (点标/Troika SDF注记)]
    end

    subgraph Scene [渲染场景图 (Scene / Group)]
        T0[Tier 0: 环境与系统辅助 (Stars / Atmosphere / Graticule / Wireframe)]
        T1[Tier 1: 地表底图 (Surface Mesh: 默认遥感或科学物理场)]
        T2[Tier 2: 专题矢量面 (Polities / Ethnicity / Religion Fills)]
        T3[Tier 3: 线网水系 (Rivers Ribbon / Roads / Borders)]
        T4[Tier 4: 标绘注记 (Markers / Troika SDF)]
    end

    UI_State --> StyleDoc
    StyleDoc --> Factory
    Factory --> Scene
```

### 2.1 明确各层职责与层级

| 层级 (Tier) | 名称 | 数据源类型 | 典型代表 | 渲染行为 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 0** | **环境与空间辅助 (Environment & Space)** | Shader / Lines / Particles | 星空背景、大气辉光散射、天体日光、**经纬网格 (Graticule)、Cell 三角线框 (Wireframe)** | 独立环境与系统辅助几何，不参与地理要素拓扑运算 |
| **Tier 1** | **地表底图 (Surface Basemap)** | `raster` (Cell 字段) | **默认底图**（遥感影像/矢量陆海/羊皮纸）或**科学物理场**（DEM/气温/降水/板块） | 作为最底层的地形网格几何体，按插槽切换，按 Cell 顶点着色 |
| **Tier 2** | **专题图斑 (Thematic Fills)** | `geojson` (Polygon) | 国家疆域、民族文化区、宗教板块、生物群系 | 贴地矢量面，支持透明度混合（可半透明叠加在卫星或羊皮纸底图上） |
| **Tier 3** | **线网水系 (Linear Features)** | `geojson` (LineString) | 汇水河流(Ribbon)、交通路网、政治国界 | 汇水河流动态拓宽，道路与边界批量线段绘制 |
| **Tier 4** | **标绘注记 (Symbols & Labels)** | `geojson` (Point) | 聚落城市、宗教圣地、国家地名、山脉河流注记 | 几何图标 + Troika 3D SDF 文字，支持视距缩放与动态碰撞避让 |

---

## 三、 典型扩展案例实操：如何新增“古卷羊皮纸风格（Parchment）”

得益于顶级 MapStyle 架构，未来新增任何个性化风格（如羊皮纸、工程蓝图、赛博科幻），**无需侵入任何底层渲染器代码**，只需新增一个声明式样式对象即可直接生效：

```typescript
import type { MapStyleDocument } from '@/core/styles'

export const parchmentStyle: MapStyleDocument = {
  version: 1,
  id: 'parchment',
  name: '古卷羊皮纸',
  description: '复古航海图质感、铁胆墨水线网与古典衬线注记',

  // 1. 复古古董调色板 (Design Tokens)
  tokens: {
    ocean: '#E8D8B8', // 仿旧米黄海水
    landLow: '#F4EDE0', // 泛白羊皮纸陆地
    coastline: '#7A5C43', // 棕褐墨水海岸线
    river: '#4A3525', // 铁胆墨水深棕水系
    road: '#9E6D48', // 虚线土路
    polityBorder: '#B35340', // 复古朱砂红国界
    label: '#2B1E16', // 碳墨深褐文字
    labelHalo: '#F4EDE0', // 羊皮纸底色光晕
    fontFamily: 'Cinzel, Georgia, serif', // 古典衬线字体
  },

  // 2. 属于羊皮纸风格的专属图层栈 (Layers Stack)
  layers: [
    // 基础陆地填充
    {
      id: 'land-fill',
      source: 'land-areas',
      renderer: 'fill',
      paint: { 'fill-color': ['token', 'landLow'] },
    },
    // 【羊皮纸专属】多重外沿海岸晕渲线（仿古地图版画效果）
    {
      id: 'coast-hatching',
      source: 'land-areas',
      renderer: 'line',
      paint: { 'line-color': ['token', 'coastline'], 'line-width': 1.5, 'line-opacity': 0.7 },
    },
    // 复古河流 (Ribbon)
    {
      id: 'rivers',
      source: 'river-network',
      renderer: 'river-ribbon',
      paint: { 'line-color': ['token', 'river'] },
    },
    // 古典衬线地名注记 (SDF)
    {
      id: 'settlement-labels',
      source: 'settlement-labels',
      renderer: 'symbol',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['token', 'fontFamily'],
      },
      paint: {
        'text-color': ['token', 'label'],
        'text-halo-color': ['token', 'labelHalo'],
      },
    },
  ],
}
```

### 即插即用效果：
只需执行 `registerMapStyleDocument(parchmentStyle)`：
- UI 图层面板自动展示“古卷羊皮纸”卡片；
- 渲染管线自动根据其专属的 `layers` 进行批处理着色；
- 用户此时若在界面将地表切换为“降水量”，地表底图插槽会自动切为降水场，而上层的复古墨水地名和朱砂国界依然完好无损！

---

## 四、 四阶段分步实施路线图

### 阶段一：概念解耦与配置规范收敛 (Phase 1)
> **目标**：理顺 UI 状态与数据配置，将 `Satellite` 提拔为一级风格，解绑专题面与底图。

1. **改造 `WorldConfig.appearance` 类型**：
   ```typescript
   export interface WorldAppearanceConfig {
     /** 顶级制图风格：'satellite' | 'standard' | 'light' | 'dark' | 'parchment' 等 */
     mapStyle: string

     /**
      * 地表底层着色模式（插槽式）：
      * 'default': 跟随当前 mapStyle 的默认底表（如 satellite 展现遥感，parchment 展现仿古纸质）；
      * 其他枚举：覆写为科学物理场（温度、降水、DEM、板块等）。
      */
     surfaceField: 'default' | 'dem' | 'temperature' | 'precipitation' | 'wind' | 'plates' | 'continents' | 'biome'

     /** 专题矢量面（多选正交叠加，不与地表互斥） */
     thematicFills: {
       polities: boolean
       ethnicity: boolean
       languages: boolean
       religions: boolean
       biomes: boolean
     }

     /** 要素线网、标绘与环境开关 */
     overlays: {
       rivers: boolean
       routes: boolean
       borders: boolean
       cities: boolean
       sacredSites: boolean
       labels: boolean
       graticule: boolean
       wireframe: boolean
       atmosphere: boolean
       clouds: boolean
       dayNight: boolean
     }

     climateMonth: number
     elevationDisplacement: boolean
     autoRotate: boolean
   }
   ```
2. **清理假底图 ID**：
   - 运行时统一使用规范图层 ID（如 `plates`、`polities`、`ethnicity`），不区分平滑与未平滑版本；
   - 专题区域面的生成、渲染和导出固定采用平滑几何，不暴露平滑模式开关；不再识别带 `-smoothed` 后缀的图层 ID。
3. **移除数据源中的反向耦合**：
   - 从 `source-registry.ts` 的 `MapStyleSourceDefinition` 中移除 `overlay?: string` 属性；
   - 显隐逻辑统一由样式层（`layer.layout.visibility`）和图层开关决定。

---

### 阶段一：建立底层独立数据源系统 (Phase 1) ✅ [已完成]
> **成果**：在 `src/core/data-source/` 建立纯净的数据源注册表与各物理/人文字段获取器，实现数据与样式的彻底解耦。

---

### 阶段二：建立统一的 `LayerFactory` 与图层生命周期 (Phase 2) ✅ [已完成]
> **成果**：已废弃并删除 3 个分散的 `discovery.ts` 文件；在 `src/core/rendering/shared/layer-factory.ts` 实现统一分发；消除深度魔数；河流 Ribbon 规范化为独立渲染器类型。

---

### 阶段三：底图色带全面声明化与 `WorldColorizer` 彻底移除 (Phase 3) ✅ [已完成]
> **目标**：将写死的颜色代码与插值逻辑迁移到声明式表达式，消除双轨渲染差异，彻底删除旧代码。

1. **色带迁移为标准样式表达式**：
   - 在样式预设（`Standard`, `Light`, `Dark`, `Satellite`）中，使用声明式表达式表达温度、降水、高程（DEM/Heightmap）以及卫星图层映射。
   - `presets.ts` 中的各个 `MapStyleDocument` 彻底展开为全量对象常量导出，结构清晰一目了然。
   - 在 `src/core/styles/` 中建立全量物理底图（高程、温度、降水、板块、大陆、应力、地幔流、冰川、柯本气候、生物群系、人口密度、市场可达性等）的标准声明式图层规范。
2. **彻底解耦并完全移除 `WorldColorizer` (Zero-Legacy)**：
   - **封装脱离任何具体图层业务的纯通用求值函数 `evaluateRasterField`**：仅接收数据源字段与 `raster-color` 表达式，纯函数式输出颜色数组，彻底消灭渲染器中 500+ 行 `if (mode === ...)` 硬编码分支与私有调色函数；
   - 卫星遥感多场混合算法解耦为独立的 `SatelliteSurfaceRenderer`；
   - **已物理删除 `world-colorizer.ts` 文件**，全项目零遗留引用，地表渲染完全由纯粹的声明式光栅管线接管。

---

### 阶段四：UI 面板重塑与交互统一 (Phase 4) ✅ [已完成]
> **目标**：重构 `LayerBar.svelte`，为用户呈现专业、清晰、分明的地理图层控制界面。

1. **界面功能区正交重排落地**：
   - **顶栏：制图风格（Theme & Style）**：Standard（标准） / Light（明亮） / Dark（暗夜） / Satellite（卫星实景）等一键切换；
   - **第一区：底层地表（Surface Field）**：高程 DEM、高度阶梯图、月均气温、月降水、板块构造、生态群系、人口密度、水文汇流等单选切换，自带平滑边界开关与季节月份选择；
   - **第二区：专题区域（Thematic Fills）**：国家疆域、民族区划、语言区划、宗教信仰多选叠加，可在任意地表上透明叠加；
   - **第三区：要素图层（Vector & Annotations）**：水系与交通、疆域与聚落、地名注记分组清晰管理；
   - **第四区：环境与辅助（Environment & Aux）**：云层、大气圈、昼夜光影、经纬网、网格线框、真实高程起伏与自转一览无余；
   - **图例与统计区**：各物理场渐变色标动态响应、模型统计指标展示与一键复制。
2. **交互响应与解耦**：
   - 切换专题图层或要素图层时通过局部管理器精准更新，无需重新计算网格。

---

## 五、 重构风险控制与收益评估

### 5.1 风险控制策略
- **平滑过渡（双层兼容）**：在重构初期，旧版 `baseMap` 字段可在状态管理层自动兼容映射，避免破坏现有配置存储与单元测试。
- **几何与着色解耦**：优先完成阶段一和阶段二（图层管理与工厂），阶段三的色带迁移可按要素逐个迁移。

### 5.2 预期重构收益
1. **架构清晰度大幅提升**：代码行数缩减，消灭多处重复的过滤与特例特判代码。
2. **功能与表现力极大拓展**：用户首次可以在卫星地表或高程图上，直接半透明叠加国家势力边界与民族分布。
3. **无缝扩展全新视觉风格**：新增羊皮纸、蓝图、手绘等主题无需触碰任何核心渲染代码，纯声明式配置即可生效。
