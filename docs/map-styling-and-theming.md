# 另一个地球生成器：地图制图与主题样式系统指南

本文档全面阐述系统的**地理数据源字典、声明式样式规范（Style Spec）、表达式求值引擎（DSL）与主题定制方案**。文档旨在指导开发者与地图制作者理解渲染管道的数据接口，掌握如何通过配置声明式样式文档（MapStyleDocument），定制高品质的 2D 平面地图与 3D 虚拟地球视觉表现。

---

## 目录

- [一、数据源架构与属性字典 (Data Sources & Properties)](#一定义与数据源属性字典-data-sources--properties)
  - [1. 两种数据源范式：栅格场 vs 矢量要素](#1-两种数据源范式栅格场-vs-矢量要素)
  - [2. 内置数据源注册表与可用属性字典](#2-内置数据源注册表与可用属性字典)
- [二、声明式样式规范 (Map Style Specification)](#二声明式样式规范-map-style-specification)
  - [1. 样式文档核心结构 (MapStyleDocument)](#1-样式文档核心结构-mapstyledocument)
  - [2. 图层定义结构 (MapStyleLayer)](#2-图层定义结构-mapstylelayer)
  - [3. 6 大渲染器类别与属性能力矩阵](#3-6-大渲染器类别与属性能力矩阵)
- [三、样式表达式语法全集 (Style Expressions DSL)](#三样式表达式语法全集-style-expressions-dsl)
  - [1. 表达式求值上下文 (Context)](#1-表达式求值上下文-context)
  - [2. 属性读取与环境常量操作符](#2-属性读取与环境常量操作符)
  - [3. 逻辑判断与条件分支操作符](#3-逻辑判断与条件分支操作符)
  - [4. 数学运算与极值操作符](#4-数学运算与极值操作符)
  - [5. 空间插值与分级阶梯操作符](#5-空间插值与分级阶梯操作符)
  - [6. 色彩与调色板生成操作符](#6-色彩与调色板生成操作符)
- [四、经典制图场景配方 (Cartographic Recipes)](#四经典制图场景配方-cartographic-recipes)
  - [配方 1：聚落中心的多尺度分级显示 (LOD Filter)](#配方-1聚落中心的多尺度分级显示-lod-filter)
  - [配方 2：水系河流随流量动态变化线宽 (River Ribbon)](#配方-2水系河流随流量动态变化线宽-river-ribbon)
  - [配方 3：国界争议虚线与海上航路虚线 (Dashed Lines)](#配方-3国界争议虚线与海上航路虚线-dashed-lines)
  - [配方 4：地缘政治与民族语言专题着色 (Thematic Coloring)](#配方-4地缘政治与民族语言专题着色-thematic-coloring)
  - [配方 5：注记字号随缩放平滑插值放大 (Smooth Zoom Typography)](#配方-5注记字号随缩放平滑插值放大-smooth-zoom-typography)
- [五、官方四大预设主题深度解析 (Preset Themes)](#五官方四大预设主题深度解析-preset-themes)
  - [1. Standard（标准自然）：地理写实与自然平衡](#1-standard标准自然地理写实与自然平衡)
  - [2. Light（浅色纸本）：古典羊皮纸与手绘出版风](#2-light浅色纸本古典羊皮纸与手绘出版风)
  - [3. Dark（深色夜光）：赛博信息流与数据可视化](#3-dark深色夜光赛博信息流与数据可视化)
  - [4. Satellite（真实卫星）：遥感影像与夜光地缘](#4-satellite真实卫星遥感影像与夜光地缘)
- [六、从零定制新主题实战教程 (Creating a Custom Theme)](#六从零定制新主题实战教程-creating-a-custom-theme)
  - [第 1 步：规划 Tokens 视觉调色板](#第-1-步规划-tokens-视觉调色板)
  - [第 2 步：配置陆海自然基底与水系图层](#第-2-步配置陆海自然基底与水系图层)
  - [第 3 步：配置地缘线网与行政边界](#第-3-步配置地缘线网与行政边界)
  - [第 4 步：配置聚落图标与文字注记系统](#第-4-步配置聚落图标与文字注记系统)
  - [第 5 步：注册样式并在应用中载入](#第-5-步注册样式并在应用中载入)

---

## 一、定义与数据源属性字典 (Data Sources & Properties)

### 1. 两种数据源范式：栅格场 vs 矢量要素

系统将底层复杂的模拟状态解耦为统一的制图数据总线，对外暴露两种运行时数据源类型：

1. **`raster`（连续表面场）**：
   - 直接索引球面网格的每个胞元（Cell），承载标量或向量数组（如高程、温度、降水量、风速分量、洋流温差）。
   - 适用于绘制连续渐变底图、地形晕渲或流场可视化。
2. **`geojson`（离散矢量要素）**：
   - 由适配器（Adapters）从世界模拟状态实时派生，封装为标准 GeoJSON 格式的几何（点、线、多边形）。
   - 具备高效的分层 WeakMap 缓存机制，仅在核心数据变更或显式通知时更新，支持每项要素携带独立的属性字典（Properties）。

### 2. 内置数据源注册表与可用属性字典

在编写样式规则时，各个图层的 `filter`、`layout` 与 `paint` 表达式可通过 `['get', '属性名']` 读取要素属性。下表为系统内置数据源及其暴露的可用属性速查字典：

| 数据源 ID (`source`) | 几何类别 | 对应制图实体 | 暴露给样式的属性字典 (Properties) | 属性说明与取值范例 |
| :--- | :--- | :--- | :--- | :--- |
| `world-surface` | `raster` | 全球地表连续场 | `isLand`, `elevation`, `temperature`, `precipitation` | `isLand`: 0或1；`elevation`: 相对海平面高度(km)；`temperature`: 摄氏度；`precipitation`: 月降水(mm) |
| `land-areas` | `polygon` | 大陆与岛屿面要素 | `kind` | 固定为 `'land'`，用于陆地面基底填充 |
| `plate-areas` | `polygon` | 地质板块区域面 | `groupId`, `name` | `groupId`: 板块ID编号；`name`: 板块标识名称 |
| `continent-areas` | `polygon` | 宏观地理大陆面 | `groupId`, `name` | `groupId`: 大陆ID编号；`name`: 大陆名称 |
| `koppen-areas` | `polygon` | 柯本气候带面 | `groupId`, `name` | `groupId`: 柯本代码枚举值（0～30）；`name`: 分类代号（如 `'Af'`, `'Csb'`, `'ET'` 等） |
| `biome-areas` | `polygon` | 生态生物群系面 | `groupId`, `name` | `groupId`: 群系代码枚举值（0～15）；`name`: 生态名称（如 `'tropical-rainforest'`, `'tundra'` 等） |
| `polity-areas` | `polygon` | 国家政体领土面 | `groupId`, `name`, `population` | `groupId`: 国家ID；`name`: 国家全称；`population`: 该国实际常住居民总数 |
| `ethnicity-areas` | `polygon` | 优势民族分布区 | `groupId`, `name` | `groupId`: 民族ID；`name`: 民族名称（如 `'青川族'`） |
| `language-areas` | `polygon` | 优势语言分布区 | `groupId`, `name` | `groupId`: 语言ID；`name`: 语言名称（如 `'青川语'`） |
| `religion-areas` | `polygon` | 优势宗教分布区 | `groupId`, `name` | `groupId`: 宗教ID（未分配或世俗为主为 `-1`）；`name`: 宗教名称 |
| `polity-boundaries`| `line` | 国家与国家的分界线 | `ownerA`, `ownerB`, `disputed` | `ownerA/B`: 边界两侧国家ID；`disputed`: 是否为边疆争议区（boolean） |
| `river-network` | `line` | 地表汇流水系网 | `flowAccumulation`, `order` | `flowAccumulation`: 汇水通量；`order`: Horton-Strahler 河流级序（$1 \sim 8$） |
| `transport-network`| `line` | 道路交通与海上航线 | `kind`, `distanceKm`, `costKm` | `kind`: `'road'`（陆地道路）或 `'sea'`（沿海航线）；`distanceKm`: 物理距离；`costKm`: 等价阻力成本 |
| `settlement-points`| `point` | 聚落中心几何点标 | `name`, `rank`, `population`, `isCapital`, `isSacredSite`, `region`, `markerLevel` | `name`: 城市名；`rank`: `'metropolis'`, `'city'`, `'town'`, `'village'`；`isCapital`: 是否首都；`isSacredSite`: 是否圣地；`markerLevel`: LOD等级（0～3） |
| `sacred-site-points`| `point`| 宗教大圣地标记点 | `name`, `religionId`, `settlementId`, `region`, `markerLevel` | `name`: 圣所名称；`religionId`: 所属宗教；`settlementId`: 关联聚落ID |
| `settlement-labels`| `symbol`| 聚落地名排版注记 | `name`, `rank`, `population`, `isCapital`, `isSacredSite` | 用于地名文字注记与图标碰撞避让 |
| `polity-labels` | `symbol`| 国家宏观疆域大注记 | `name`, `population`, `rank` | 渲染在国家版图腹地的大字号名称 |
| `civilization-labels`| `symbol`| 区域文化广域注记 | `name`, `type`, `population` | 用于标注大陆、大洋、古老文化大区的注记 |

---

## 二、声明式样式规范 (Map Style Specification)

系统的地图样式系统受到现代矢量切片制图规范（Mapbox/MapLibre Style Spec）启发，采用声明式 JSON/TypeScript 对象描述。样式定义完全与渲染器实现解耦。

### 1. 样式文档核心结构 (MapStyleDocument)

一个完整的地图样式文档由元数据、全局调色板 Tokens、数据源注册表与有序图层列表构成：

```json
{
  "version": 1,
  "id": "my-custom-style",
  "name": "自定义古典纸本主题",
  "description": "专为打印出版设计的温暖羊皮纸风格地图主题",
  "tokens": {
    "color-water": "#d8e2dc",
    "color-land": "#f8edeb",
    "color-road": "#b08968",
    "color-river": "#84a59d",
    "color-border": "#6b705c",
    "font-main": "Cinzel, serif"
  },
  "sources": {
    /* 允许注册第三方或自定义数据源 */
  },
  "layers": [
    /* 有序图层定义数组：后声明的图层叠加在先声明的图层上方 */
  ]
}
```

### 2. 图层定义结构 (MapStyleLayer)

每个图层对象定义了数据源与具体渲染表现的绑定规则：

```typescript
interface MapStyleLayer {
  /** 图层唯一标识符 */
  id: string
  /** 绑定的数据源 ID */
  source: string
  /** 指定绘制该图层的渲染器 */
  renderer: 'raster' | 'fill' | 'line' | 'river-ribbon' | 'circle' | 'symbol'
  
  /** 关联的 UI 开关标识（如 'routes', 'cities', 'nation-borders'），受前端工具栏联动控制 */
  overlay?: string
  /** 关联的专题面类别（如 'plates', 'continents', 'koppen', 'biome', 'polities'） */
  thematic?: string
  
  /** 适用的视图类型：['map'] 仅2D平面，['globe'] 仅3D地球；省略则在两视图中均显示 */
  views?: readonly ('map' | 'globe')[]
  /** 仅在特定的底图模式下渲染（如 ['terrain', 'satellite']） */
  baseMaps?: readonly string[]
  
  /** 最小/最大显示缩放级别（支持小数） */
  minZoom?: number
  maxZoom?: number
  
  /** 图层要素过滤条件表达式：仅返回 true 的要素才会被几何管线采集 */
  filter?: StyleExpression
  
  /** 布局属性：决定几何可见性与文本排版参数 */
  layout: Record<string, StyleValue>
  /** 绘制属性：决定着色颜色、线宽、透明度等渲染材质参数 */
  paint: Record<string, StyleValue>
}
```

### 3. 6 大渲染器类别与属性能力矩阵

不同图层使用专用的渲染器处理几何。各渲染器支持的 `layout` 与 `paint` 属性如下：

| 渲染器类别 (`renderer`) | 支持的数据源类别 | 支持的几何 | 支持的 `layout` 属性 | 支持的 `paint` 属性 | 说明与高级特性 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`raster`** | `raster` | 球面栅格 | `visibility` | `raster-color`, `raster-opacity` | 驱动连续色带着色，支持多采样通道混合 |
| **`fill`** | `geojson` | `polygon` | `visibility` | `fill-color`, `fill-opacity` | 绘制大陆基底与板块/国家/气候专题多边形面 |
| **`line`** | `geojson` | `line`, `polygon` | `visibility`, `line-cap`, `line-join` | `line-color`, `line-opacity`, `line-width`, `line-dasharray` | 绘制国界、海岸线与道路；支持虚线段（`dasharray`）与屏幕物理像素线宽 |
| **`river-ribbon`** | `geojson` | `line` | `visibility` | `line-color`, `line-opacity`, `line-width` | **动态水系河流面带**：根据流量从上游到下游连续平滑展宽，带自然锥形过渡 |
| **`circle`** | `geojson` | `point` | `visibility` | `circle-color`, `circle-opacity`, `circle-radius`, `circle-stroke-color`, `circle-stroke-width` | 绘制聚落中心图标点标与宗教圣所标记 |
| **`symbol`** | `geojson` | `point`, `line`, `polygon` | `visibility`, `text-field`, `text-size`, `icon-image`, `symbol-placement`, `text-allow-overlap` | 驱动 **Troika-Three-Text** 高性能 SDF 字体排版与图标注记，支持外发光描边与屏幕防重叠 |

---

## 三、样式表达式语法全集 (Style Expressions DSL)

系统内置了轻量级、确定性求值的 **Lisp 风格 JSON 表达式引擎**。任何图层属性均可配置为字面量常量，或配置为由数组描述的动态表达式：
`["operator", operand1, operand2, ...]`

### 1. 表达式求值上下文 (Context)

求值时引擎自动向操作符注入当前运行上下文：
- `zoom`: 当前相机的缩放级别（2D 地图视口范围或 3D 摄像机距地表距离折算值，通常在 $0.0 \sim 8.0$ 之间）。
- `tokens`: 样式文档顶层声明的所有主题颜色与尺寸变量。
- `properties`: 当前正在求值的要素属性字典。

### 2. 属性读取与环境常量操作符

- **`["token", tokenKey]`**：从全局 `tokens` 中提取变量值。
  ```json
  ["token", "color-river"] // => 返回 tokens["color-river"]
  ```
- **`["get", propertyKey]`**：从当前要素的 `properties` 中提取指定字段。
  ```json
  ["get", "population"] // => 返回当前要素的 population 属性值
  ```
- **`["zoom"]`**：返回当前视口的缩放数值。
- **`["literal", value]`**：强制声明原始数组或对象字面量，防止被引擎误判为操作符。

### 3. 逻辑判断与条件分支操作符

- **`["==", a, b]` / `["!=", a, b]`**：全等 / 不全等比较。
- **`[">", a, b]` / `[">=", a, b]` / `["<", a, b]` / `["<=", a, b]`**：数值大小关系比较。
- **`["all", cond1, cond2, ...]`**：逻辑与（所有子项必须为真）。
- **`["any", cond1, cond2, ...]`**：逻辑或（任一子项为真即为真）。
- **`["!", cond]`**：逻辑非。
- **`["case", cond1, val1, cond2, val2, ..., defaultVal]`**：多分支选择器，按顺序匹配第一个满足条件的取值：
  ```json
  [
    "case",
    ["==", ["get", "isCapital"], true], "#e63946",
    ["==", ["get", "rank"], "metropolis"], "#f77f00",
    "#457b9d"
  ]
  ```
- **`["match", input, label1, val1, label2, val2, ..., defaultVal]`**：值匹配分发器（类似 switch-case）。匹配标签可以是一个值或值列表。
- **`["coalesce", val1, val2, ...]`**：空值聚合，按顺序返回第一个非 `null` 且非 `undefined` 的项。

### 4. 数学运算与极值操作符

- **`["+", a, b, ...]`**：连续求和。
- **`["-", a, b]`**：差值计算。
- **`["*", a, b, ...]`**：乘积计算。
- **`["/", a, b]`**：商值计算。
- **`["min", a, b, ...]` / `["max", a, b, ...]`**：求一组参数中的极值。

### 5. 空间插值与分级阶梯操作符

- **`["step", input, defaultVal, stop1, val1, stop2, val2, ...]`**：
  分级阶梯函数。当 $input < stop1$ 时取 $defaultVal$；当 $stop1 \le input < stop2$ 时取 $val1$；以此类推：
  ```json
  [
    "step",
    ["get", "population"],
    1.0,         // 默认基础字号
    100000, 1.2, // 10万人口以上
    1000000, 1.5 // 100万人口以上
  ]
  ```
- **`["interpolate", ["linear"], input, stop1, val1, stop2, val2, ...]`**：
  连续线性插值函数。
  - **数值插值**：在相邻断点之间按权重比例线性过渡。
  - **色彩过渡插值**：若输入值为 `#RRGGBB` 格式的十六进制颜色，**引擎会自动在红、绿、蓝三个通道独立进行无缝色彩线性渐变**！
  ```json
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    0.0, 1.0,  // 缩放级别为 0 时线宽为 1.0 像素
    6.0, 3.5   // 缩放级别为 6 时平滑放大至 3.5 像素
  ]
  ```

### 6. 色彩与调色板生成操作符

- **`["group-color", groupId]`**：
  内置的确定性调色算法，根据整数 ID 生成高辨识度且分布均匀的专属颜色（常用于国家与民族色块）。
- **`["plate-color", plateId]`**：
  基于黄金分割角（$137.5^\circ$）色相旋转生成的板块与大陆对比色盘。
- **`["palette", index, paletteArray]`**：
  根据索引值从预设的十六进制颜色数组中提取对应色值。

---

## 四、经典制图场景配方 (Cartographic Recipes)

以下是在实际制作地图样式时最常用的 5 个工业级制图配方，可直接作为模板嵌入图层定义中：

### 配方 1：聚落中心的多尺度分级显示 (LOD Filter)

**目标**：全球视角只看首都和大都会；中等缩放展示区域大城市；高倍放大展现小城镇与村庄，避免屏幕元素拥挤重叠。

```json
{
  "id": "settlement-symbols",
  "source": "settlement-labels",
  "renderer": "symbol",
  "overlay": "cities",
  "filter": [
    "any",
    // 无论任何缩放等级，首都与大都会永远可见
    ["any", ["==", ["get", "isCapital"], true], ["==", ["get", "rank"], "metropolis"]],
    // 缩放 >= 1.0 时显示一般城市 (City)
    ["all", [">=", ["zoom"], 1.0], ["==", ["get", "rank"], "city"]],
    // 缩放 >= 2.0 时展开小城镇与普通村落 (Town / Village)
    ["all", [">=", ["zoom"], 2.0], ["any", ["==", ["get", "rank"], "town"], ["==", ["get", "rank"], "village"]]]
  ],
  "layout": {
    "visibility": "visible",
    "text-field": ["get", "name"]
  }
}
```

### 配方 2：水系河流随流量动态变化线宽 (River Ribbon)

**目标**：结合河流级序（Strahler Order）与汇水通量，在视口放大时以复合指数动态加宽主干河道。

```json
{
  "id": "rivers-ribbon-layer",
  "source": "river-network",
  "renderer": "river-ribbon",
  "paint": {
    "line-color": ["token", "color-river"],
    "line-opacity": 0.85,
    "line-width": [
      "*",
      // 基础宽度由河流等级的阶梯函数决定（1级支流最窄，8级入海主干最宽）
      [
        "step",
        ["get", "order"],
        0.8,
        3, 1.4,
        5, 2.2,
        7, 3.8
      ],
      // 乘以随视口缩放动态放大的补偿系数
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        0.0, 1.0,
        5.0, 2.4
      ]
    ]
  }
}
```

### 配方 3：国界争议虚线与海上航路虚线 (Dashed Lines)

**目标**：已定国界为实线，未定/争议国界呈现短虚线；陆地道路为实线，跨海航线呈现长间距虚线。

```json
{
  "id": "nation-borders-stroke",
  "source": "polity-boundaries",
  "renderer": "line",
  "overlay": "nation-borders",
  "paint": {
    "line-color": ["token", "color-border-national"],
    "line-width": 1.5,
    // [实线段长, 虚线间隔]：争议区为 [3, 2] 虚线，普通边界为 [0, 0] 实线
    "line-dasharray": [
      "case",
      ["==", ["get", "disputed"], true], ["literal", [3, 2]],
      ["literal", [0, 0]]
    ]
  }
}
```

```json
{
  "id": "routes-layer",
  "source": "transport-network",
  "renderer": "line",
  "overlay": "routes",
  "paint": {
    "line-color": ["token", "color-route"],
    "line-width": 1.2,
    // 海上航路渲染为 [4, 3] 航标虚线
    "line-dasharray": [
      "match",
      ["get", "kind"],
      "sea", ["literal", [4, 3]],
      ["literal", [0, 0]]
    ]
  }
}
```

### 配方 4：地缘政治与民族语言专题着色 (Thematic Coloring)

**目标**：当用户在侧边栏开启“国家”或“柯本气候”专题图层时，填充区域面并映射对应专属色带。

```json
{
  "id": "thematic-polities-fill",
  "source": "polity-areas",
  "renderer": "fill",
  "thematic": "polities",
  "paint": {
    // 根据国家 ID 自动生成高辨识度国别色
    "fill-color": ["group-color", ["get", "groupId"]],
    "fill-opacity": 0.65
  }
}
```

### 配方 5：注记字号随缩放平滑插值放大 (Smooth Zoom Typography)

**目标**：远景字号精致紧凑，近景字号清晰醒目，避免缩放时字号阶跃突变。

```json
{
  "id": "settlement-text-labels",
  "source": "settlement-labels",
  "renderer": "symbol",
  "layout": {
    "text-field": ["get", "name"],
    "text-size": [
      "interpolate",
      ["linear"],
      ["zoom"],
      // 远景（zoom = 0）字号配置
      0.0, [
        "case",
        ["==", ["get", "isCapital"], true], 1.45,
        ["==", ["get", "rank"], "metropolis"], 1.30,
        ["==", ["get", "rank"], "city"], 1.16,
        1.0
      ],
      // 近景（zoom = 6）字号平滑放大配置
      6.0, [
        "case",
        ["==", ["get", "isCapital"], true], 1.80,
        ["==", ["get", "rank"], "metropolis"], 1.60,
        ["==", ["get", "rank"], "city"], 1.40,
        1.20
      ]
    ]
  },
  "paint": {
    "text-color": ["token", "color-text-city"],
    "text-halo-color": ["token", "color-text-halo"],
    "text-halo-width": 2.0
  }
}
```

---

## 五、官方四大预设主题深度解析 (Preset Themes)

系统内置了四种经过严格色彩校准的官方主题预设，分别对应不同的视觉使用场景：

```text
                  ┌─── [Standard]  (现代地理/中性写实/高保真)
                  ├─── [Light]     (古典出版/暖黄纸本/高对比)
[MapStyleDocument] ┼─── [Dark]      (黑曜夜光/荧光网络/赛博科技)
                  └─── [Satellite] (真实遥感/深海低亮/高对比金黄国界)
```

### 1. Standard（标准自然）：地理写实与自然平衡
- **设计哲学**：追求类似现代物理地球仪或高清卫星地理图册的真实观感。
- **色彩策略**：
  - 海洋采用深邃沉稳的暗蓝灰（`#1f354d`），配合半透明高光；
  - 陆地自然底色采用中性砂灰色，让位给山地晕渲与高程立体感；
  - 水系采用明度适中的天蓝（`#3d7ea6`）；
  - 聚落与交通网络采用沉稳的中黄与碳黑，确保在地貌起伏上具有极佳的可读性。

### 2. Light（浅色纸本）：古典羊皮纸与手绘出版风
- **设计哲学**：致敬大航海时代的古地图与国家地理印刷出版物。
- **色彩策略**：
  - 海洋呈现柔和的灰绿暖调（`#c5d3cb`），模拟古旧地图被海风氧化的海面质感；
  - 陆地采用泛黄的象牙白羊皮纸色（`#ebe6d8`）；
  - 道路呈现赭石与熟褐（`#8c6d58`），边界呈现古典灰绿；
  - 采用较强的文字白色晕圈（Halo），极度适合打印出图或长篇学术汇报。

### 3. Dark（深色夜光）：赛博信息流与数据可视化
- **设计哲学**：强调地缘政治、文明流动与网络连接性的信息大屏风格。
- **色彩策略**：
  - 大洋为极深的黑曜石黑（`#0a0e14`），陆地为低明度深碳灰（`#141b24`）；
  - 交通路线与国家边界赋予高亮青色（Cyan `#00f5d4`）与暖琥珀金；
  - 聚落与圣所犹如深夜点亮的文明灯火，在黑暗的星球表面产生强烈的视觉聚焦点。

### 4. Satellite（真实卫星）：遥感影像与夜光地缘
- **设计哲学**：还原太空宇航视角下的拟真遥感卫星地表，强调深色自然基底与亮色人土地标的高对比度融合。
- **色彩策略**：
  - 大洋呈现深邃近黑的太空深蓝（`#0C1C2C`），低地植被为拟真墨绿（`#233223`），高海拔山地呈现裸岩暗褐（`#3F3B30`）；
  - 国家政体边界采用极其醒目的明黄色（`#FFD166`），道路呈现鲜明琥珀橙（`#F39C12`）；
  - 所有地名、聚落点标采用**纯白字（`#FFFFFF`）配合纯黑光晕（`#000000`）**，确保在复杂多变的卫星遥感多光谱纹理与高起伏地表上依然具备极致的可读性；
  - 专为配合遥感卫星多通道地表合成渲染器（`satellite-surface-renderer`）而设计，兼具自然科学真实感与人文制图穿透力。

---

## 六、从零定制新主题实战教程 (Creating a Custom Theme)

下面通过一个具体的**“复古东方水墨风”（Parchment Ink）**主题示例，演示如何从零构建并在应用中生效一套全新的地图样式。

### 第 1 步：规划 Tokens 视觉调色板

在样式头部集中声明核心色彩。使用富有诗意的传统水墨色谱：

```typescript
const PARCHMENT_INK_TOKENS = {
  // 水体与陆地基调（宣纸与淡墨）
  'color-sea': '#c8d6cf',        // 浅鸭蛋青（水体）
  'color-land': '#f4efe6',       // 仿古宣纸色（陆地）
  'color-river': '#7d9d9c',      // 苍水色（河流）
  
  // 地缘政治与线网
  'color-border': '#576f72',     // 深黛绿（国界）
  'color-disputed': '#e07a5f',   // 朱砂（争议界）
  'color-road': '#b89f81',       // 浅赭石（陆路）
  'color-sea-route': '#829460',  // 灰绿（海上航线）
  
  // 聚落与文字排版
  'color-city': '#2b2b2b',       // 松烟焦墨（城市点标）
  'color-capital': '#9e2a2b',    // 官印朱红（首都印章）
  'color-text': '#1f2421',       // 墨黑（文字注记）
  'color-halo': 'rgba(244, 239, 230, 0.85)' // 纸白外发光保护层
}
```

### 第 2 步：配置陆海自然基底与水系图层

```typescript
const naturalLayers: MapStyleLayer[] = [
  // 1. 陆地实体底色填充
  {
    id: 'ink-land-base',
    source: 'land-areas',
    renderer: 'fill',
    paint: {
      'fill-color': ['token', 'color-land'],
      'fill-opacity': 1.0,
    },
  },
  // 2. 水系与河流面带
  {
    id: 'ink-rivers',
    source: 'river-network',
    renderer: 'river-ribbon',
    paint: {
      'line-color': ['token', 'color-river'],
      'line-opacity': 0.88,
      'line-width': [
        '*',
        ['step', ['get', 'order'], 0.7, 3, 1.3, 5, 2.0, 7, 3.2],
        ['interpolate', ['linear'], ['zoom'], 0, 1.0, 6, 2.2],
      ],
    },
  },
]
```

### 第 3 步：配置地缘线网与行政边界

```typescript
const politicalLayers: MapStyleLayer[] = [
  // 1. 交通网络
  {
    id: 'ink-transport',
    source: 'transport-network',
    renderer: 'line',
    overlay: 'routes',
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'sea', ['token', 'color-sea-route'],
        ['token', 'color-road'],
      ],
      'line-width': 1.2,
      'line-dasharray': [
        'match',
        ['get', 'kind'],
        'sea', ['literal', [4, 3]],
        ['literal', [0, 0]],
      ],
    },
  },
  // 2. 国家边界
  {
    id: 'ink-nation-borders',
    source: 'polity-boundaries',
    renderer: 'line',
    overlay: 'nation-borders',
    paint: {
      'line-color': ['token', 'color-border'],
      'line-width': 1.6,
      'line-dasharray': [
        'case',
        ['==', ['get', 'disputed'], true], ['literal', [3, 2]],
        ['literal', [0, 0]],
      ],
    },
  },
]
```

### 第 4 步：配置聚落图标与文字注记系统

```typescript
const labelLayers: MapStyleLayer[] = [
  // 1. 聚落中心点标（圆圈渲染器）
  {
    id: 'ink-settlement-dots',
    source: 'settlement-points',
    renderer: 'circle',
    overlay: 'cities',
    paint: {
      'circle-color': [
        'case',
        ['==', ['get', 'isCapital'], true], ['token', 'color-capital'],
        ['token', 'color-city'],
      ],
      'circle-radius': [
        'case',
        ['==', ['get', 'isCapital'], true], 3.2,
        ['==', ['get', 'rank'], 'metropolis'], 2.6,
        1.8,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.0,
    },
  },
  // 2. 聚落地名注记（文字排版渲染器）
  {
    id: 'ink-settlement-labels',
    source: 'settlement-labels',
    renderer: 'symbol',
    overlay: 'cities',
    layout: {
      'visibility': 'visible',
      'text-field': ['get', 'name'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0, ['case', ['get', 'isCapital'], 1.35, 1.0],
        6, ['case', ['get', 'isCapital'], 1.70, 1.25],
      ],
    },
    paint: {
      'text-color': ['token', 'color-text'],
      'text-halo-color': ['token', 'color-halo'],
      'text-halo-width': 2.5,
    },
  },
]
```

### 第 5 步：注册样式并在应用中载入

组装完整的 `MapStyleDocument`，并调用样式运行时的注册接口将其载入全局样式表：

```typescript
import type { MapStyleDocument } from '@/core/styles/style-spec'
import { registerMapStylePreset } from '@/core/styles/style-runtime'

export const ParchmentInkStyle: MapStyleDocument = {
  version: 1,
  id: 'parchment-ink',
  name: '水墨古典 (Parchment Ink)',
  description: '东方传统宣纸与焦墨色调的典雅手绘地图主题',
  tokens: PARCHMENT_INK_TOKENS,
  layers: [
    ...naturalLayers,
    ...politicalLayers,
    ...labelLayers,
  ],
}

// 注册至全局样式表，UI 的地图主题下拉框中将自动出现此预设选项
registerMapStylePreset(ParchmentInkStyle)
```

通过这一套声明式图层定义，无论是 2D 地图投影渲染还是 3D 球面渲染，引擎都将自动完成几何调度、材质生成与实时重绘，呈现出极具艺术质感的虚拟星球画卷。
