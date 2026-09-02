# 3D Globe 模式技术实现方案

## 1. 文档目的

本文给出奇幻地图生成器第一阶段 3D Globe 模式的具体实现方案。

本阶段优先验证球面世界的数据模型、地理生成效果和三维展示效果，暂不实现二维地图投影。3D Globe 是球面世界数据的第一个消费者，不是二维贴图的来源：

> 第一版 Globe 使用固定半径球面。高程只通过颜色表达，不进行任何基于高程的顶点径向位移。

```text
确定性种子与球面参数
        │
        ▼
Icosphere 球面网格
        │
        ▼
球面板块、大陆、高程与海陆分类
        │
        ▼
SphericalWorldData
        │
        ├──► 第一阶段：3D Globe
        └──► 后续阶段：二维投影
```

二维投影后续应直接读取同一份 `SphericalWorldData`，不能从 3D 渲染结果截图或烘焙得到权威地图数据。

---

## 2. 核心技术决策

### 2.1 使用 Three.js 渲染 3D Globe

现有二维视图与 Three.js 3D Globe 由 `WorldEngine` 协调；3D 渲染器负责场景、相机、光照、球面几何、轨道控制和射线拾取。

不建议把 Three.js 场景直接塞入现有 `MapEngine`，原因是当前 `MapEngine` 与以下平面概念耦合较深：

- PixiJS `Application` 和 `Container`；
- 单一二维 Canvas；
- `DiagramMesh`；
- `width`、`height`、overscan 和 viewport mask；
- 二维平移缩放和高程笔刷事件。

两个 Engine 分别管理自己的渲染资源，由上层 `AppController` 负责模式切换和生命周期。

### 2.2 使用 Icosphere 作为核心球面拓扑

3D 模式不运行当前的平面 Poisson Disk Sampling，也不依赖平面 Delaunay/Voronoi。Icosphere 顶点、边和三角形是球面世界唯一的主拓扑。

```text
bounded-plane                       sphere
Poisson Disk Sampling               Icosphere subdivision
        │                                   │
        ▼                                   ▼
平面 Delaunay / Voronoi              球面三角形 + CSR 邻接
```

Icosphere 的顶点作为 region 和标量场采样点。它具有闭合拓扑、近似均匀的面积和稳定的邻接关系，适合确定性生成。球面 Voronoi 必须由这套三角形构造，不能重新计算另一套球面 Delaunay 邻接。

### 2.3 从 Icosphere 构造球面 Voronoi 对偶

板块、大陆、高程和海陆分类继续使用 Icosphere region 图。高度图、海岸线、精确拾取以及后续二维投影使用同一拓扑的球面 Voronoi 对偶：

```text
Icosphere vertex                  Voronoi cell
Icosphere triangle               Voronoi corner（球面外心）
相邻两个 Icosphere triangle       Voronoi edge
```

每个 region 周围的外心投影到局部切平面后按角度排序，得到稳定的五边形或六边形单元。球面 Voronoi 是派生几何，不是第二套拓扑。

### 2.4 不使用 `d3-geo-voronoi` 重建核心拓扑

`d3-geo-voronoi` 可以用于原型和独立地理点集，但它会从经纬度重新计算球面 Delaunay。对当前 Icosphere 再运行一次会产生两个潜在不同的邻接来源。因此核心单元直接从 `mesh.triangles` 构造；球面等高线也直接在同一组 Icosphere 三角形上执行 marching triangles。

### 2.5 球面生成与三维渲染解耦

球面生成器只能依赖球面网格、邻接关系、面积、三维单位向量和确定性随机数。生成器不能依赖 Three.js 的 `Vector3`、相机或材质。

生成阶段继续优先使用 TypedArray，避免创建大量临时三维对象。

---

## 3. 第一阶段范围

### 3.1 包含内容

- Icosphere 构建、三角形索引和 CSR 邻接；
- region 经纬度和近似球面面积；
- Icosphere 的球面 Voronoi 对偶、单元面积和共享边界；
- 球面板块种子、板块扩张和边界分类；
- 基于球面面积配额的大陆与基础岛屿；
- 基于 xyz 的三维 Simplex 分形噪声；
- 山脉、洋中脊、海沟与海盆基础高程；
- 全球海洋和湖泊基础分类；
- Three.js 固定半径球面与 Voronoi 单元着色；
- 地形、高程、等高线、板块四种显示模式；
- 沿 Voronoi 单元边界绘制的海岸线；
- 仅由地形驱动的洼地处理、排水方向、汇流面积和球面河网；
- 带源头收窄、汇流增宽和 Voronoi 边界河口的 3D 河道；
- 板块边界调试线；
- 球体旋转、缩放、复位和 region 拾取；
- seed 与参数变化后的分级重新生成；
- 现有 2D 与新增 3D 模式切换。

### 3.2 暂不包含

- 等距圆柱、墨卡托等二维投影；
- 降水、蒸发、季节和风场等气候水文；
- 3D 高程笔刷、撤销和重做；
- 根据高程对球面顶点做径向位移；
- 独立海洋球体；
- 云层、大气散射、复杂海水着色和后处理；
- LOD、Web Worker 和高分辨率纹理导出。

---

## 4. 推荐代码结构

```text
src/
├── app-controller.ts
├── core/
│   ├── spherical/
│   │   ├── spherical-mesh.ts
│   │   ├── spherical-world-data.ts
│   │   ├── spherical-world-generator.ts
│   │   ├── mesh/
│   │   │   ├── icosphere-builder.ts
│   │   │   └── spherical-voronoi.ts
│   │   ├── geometry/
│   │   │   ├── spherical-math.ts
│   │   │   └── tangent-frame.ts
│   │   ├── algorithms/
│   │   │   ├── distance-field.ts
│   │   │   ├── influence-spread.ts
│   │   │   ├── pathfinder.ts
│   │   │   └── priority-queue.ts
│   │   ├── climate/
│   │   │   ├── climate-data.ts
│   │   │   └── climate-generator.ts
│   │   ├── geology/
│   │   │   ├── geology-data.ts
│   │   │   ├── plate-generator.ts
│   │   │   ├── landmass-generator.ts
│   │   │   └── elevation-generator.ts
│   │   ├── hydrology/
│   │   │   ├── hydrology-data.ts
│   │   │   ├── lake-generator.ts
│   │   │   └── river-generator.ts
│   │   └── society/
│   │       ├── society-data.ts
│   │       ├── human-generator.ts
│   │       ├── culture-generator.ts
│   │       ├── polity-generator.ts
│   │       └── religion-generator.ts
│   ├── rendering/
│   │   ├── globe/
│   │   │   ├── renderer.ts
│   │   │   ├── surface-geometry.ts
│   │   │   ├── coastline-geometry.ts
│   │   │   └── picker.ts
│   │   ├── map/
│   │   │   └── view.ts
│   │   └── shared/
│   │       ├── world-colorizer.ts
│   │       ├── spherical-contour-geometry.ts
│   │       └── spherical-graticule-geometry.ts
│   └── world/
│       └── world-engine.ts
├── ui/
└── main.ts
```

职责划分：

- `IcosphereBuilder`：纯函数式构建球面顶点、三角形和邻接数据；
- `SphericalMesh`：封装球面拓扑查询和距离计算；
- `SphericalVoronoi`：保存球面单元角点、共享边界和精确单元面积；
- `SphericalWorldGenerator`：调度球面地理生成管线；
- `GlobeSurfaceGeometry`：把固定半径球面转换成 Three.js BufferGeometry；
- `core/spherical/geometry/spherical-polyline`：拼接共享端点线段，并生成固定半径的平滑球面路径；
- `GlobeRenderer`：管理场景、相机、灯光、材质和渲染循环；
- `GlobePicker`：将屏幕指针转换成球面 region；
- `WorldEngine`：协调生成、几何更新、渲染与 UI；
- `AppController`：协调 2D/3D 模式切换和两个 Engine 的生命周期。

---

## 5. 依赖与基础渲染环境

新增依赖：

```bash
pnpm add three
pnpm add -D @types/three
```

主要使用：

```ts
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
```

Three.js 官方参考：

- [Installation](https://threejs.org/manual/en/installation.html)
- [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Responsive Design](https://threejs.org/manual/en/responsive.html)

---

## 6. 球面网格数据结构

```ts
export interface SphericalMeshData {
  numRegions: number
  numTriangles: number

  // 单位球面 xyz，长度为 numRegions * 3
  regionPosition: Float32Array
  regionLatitude: Float32Array
  regionLongitude: Float32Array
  regionArea: Float32Array

  // CSR 邻接
  neighborOffsets: Uint32Array
  neighbors: Uint32Array

  // 长度为 numTriangles * 3
  triangles: Uint32Array
}
```

`SphericalMesh` 提供最小查询接口：

```ts
export class SphericalMesh {
  readonly kind = 'sphere'

  forEachNeighborOfRegion(region: number): IterableIterator<number>
  distanceBetweenRegions(a: number, b: number): number
  dotBetweenRegions(a: number, b: number): number

  readonly voronoi: SphericalVoronoi
}
```

`SphericalVoronoi` 使用 TypedArray 保存可投影的单元几何：

```ts
export interface SphericalVoronoiData {
  cornerPosition: Float32Array
  cellCornerOffsets: Uint32Array
  cellCorners: Uint32Array
  cellArea: Float32Array
  edgeRegions: Uint32Array
  edgeCorners: Uint32Array
}
```

球面距离使用单位向量夹角：

```text
angle = acos(clamp(dot(a, b), -1, 1))
distance = planetRadius × angle
```

只做候选比较时使用点积或弦长，避免频繁调用 `acos`。

---

## 7. Icosphere 构建

### 7.1 构建流程

1. 创建标准二十面体的 12 个单位顶点和 20 个三角形；
2. 每轮将一个三角形拆成四个三角形；
3. 用无向边 key 缓存共享中点，防止重复顶点；
4. 将中点归一化回单位球面；
5. 保持稳定的三角形遍历和顶点插入顺序；
6. 从三角形边构建并排序 CSR 邻接数组；
7. 计算纬度、经度和 region 面积。

细分规模：

| Subdivision | Region 数 | 三角形数 | 用途 |
| ---: | ---: | ---: | --- |
| 4 | 2,562 | 5,120 | 快速调试 |
| 5 | 10,242 | 20,480 | 默认 Globe MVP |
| 6 | 40,962 | 81,920 | 高质量交互 |
| 7 | 163,842 | 327,680 | 后续高质量导出 |

第一阶段默认使用 level 5。

### 7.2 Region 面积

单位球面三角形面积使用：

```text
triangleArea = 2 × atan2(
  abs(a · cross(b, c)),
  1 + a·b + b·c + c·a
)
```

将三角形面积的三分之一累计到三个顶点：

```text
regionArea[a] += triangleArea / 3
regionArea[b] += triangleArea / 3
regionArea[c] += triangleArea / 3
```

最终应满足：

```text
sum(regionArea) ≈ 4π
```

这个面积近似已经足够用于第一阶段的板块面积和陆地覆盖率统计。

---

## 8. 球面世界数据

现有 `TectonicData` 使用二维质心和速度，因此第一阶段新增球面专属结构，不改变当前平面数据结构。

```ts
export interface SphericalTectonicData {
  regionPlate: Int32Array
  plateSeeds: Int32Array
  plateArea: Float32Array

  // 每个板块连续保存 xyz
  plateCentroid: Float32Array
  plateAngularVelocity: Float32Array

  regionBoundaryType: Uint8Array
  regionStress: Float32Array
}

export interface SphericalWorldData {
  elevation: Float32Array
  landMask: Uint8Array
  regionFeature: Uint8Array
  regionFeatureId: Int32Array
  regionContinent: Int16Array
  tectonics: SphericalTectonicData
  rivers: SphericalRiverData
}
```

```ts
export interface SphericalRiverData {
  drainageElevation: Float32Array
  downstreamRegion: Int32Array
  flowAccumulation: Float32Array
  riverMask: Uint8Array
  sourceRegions: Uint32Array
  segmentSource: Uint32Array
  segmentTarget: Uint32Array
  thresholdArea: number
}
```

所有数组都以 Icosphere region 索引作为稳定主键。Three.js 对象不是权威数据源。

---

## 9. 球面地理生成管线

### 9.1 板块种子

使用球面 farthest-point sampling，不使用平面 Poisson Sampling：

1. 第一个板块种子由 seed 决定；
2. 后续种子寻找与已选种子最远的 region；
3. 候选排序直接比较单位向量点积；
4. 在最远的少量候选中使用确定性随机选择，避免分布过于规则。

### 9.2 板块生长

使用多源 BFS 或优先队列扩张：

```text
priority =
  accumulatedDistance
  + directionalBias
  + deterministicNoise
```

扩张后执行有限次数的邻接平滑，并确保每个板块保留一个主要连通分量。

### 9.3 板块切向速度

为每个板块生成欧拉角速度向量。任意球面位置的切向速度按需计算：

```text
velocity(position) = plateAngularVelocity × position
```

应满足：

```text
dot(position, velocity(position)) ≈ 0
```

相邻板块的相对速度用于分类汇聚、分离和转换边界，并生成 `regionStress`。

### 9.4 大陆与岛屿

大陆参考现有二维 `ContinentGenerator`，使用每块大陆独立状态、面积配额和候选评分进行球面生长，不使用会产生近圆形测地圆盘的全局多源最短路径：

- 按 `regionArea` 累计陆地面积；
- 根据 `sizeVariety` 为各大陆分配不同目标面积；
- 在种子点建立球面局部切平面，为每块大陆生成独立主轴和长宽比；
- 使用球面 logarithmic map 将候选点投影到种子切平面，计算方向性距离；
- 优先沿相同板块扩张；
- 使用同类邻居比例和 `compactness` 控制紧凑度；
- 使用三维连续噪声和 `coastlineRoughness` 增加海湾、半岛与海岸粗糙度；
- 通过 `elongation`、`spread` 和板块吸引域产生延伸方向与分布差异；
- 大陆完成后，把剩余土地配额交给基础岛屿生成器。

终止条件为：

```text
landArea / 4π >= landCoverage
```

不能使用 region 数量比例作为最终覆盖率。

### 9.5 无缝高程

三维 Simplex Noise 直接采样单位球面 xyz：

```ts
const value
  = noise3D(x * frequency, y * frequency, z * frequency) * 0.6
    + noise3D(x * frequency * 2, y * frequency * 2, z * frequency * 2) * 0.28
    + noise3D(x * frequency * 4, y * frequency * 4, z * frequency * 4) * 0.12
```

最终高程由以下部分构成：

```text
大陆内部抬升
+ 汇聚边界山脉
+ 分离边界洋中脊
- 汇聚型海沟
- 海洋盆地深度
+ 三维分形噪声
```

海平面继续使用项目现有的 `SEA_LEVEL`。生成高程保持归一化，第一版只将它映射为颜色，不修改球面几何。

### 9.6 海洋与湖泊

球面没有地图边界，因此不能从边界水域开始泛洪：

1. 找出全部低于海平面的水域连通分量；
2. 累计每个分量的球面面积；
3. 将最大分量识别为全球海洋；
4. 其余封闭水域识别为湖泊。

### 9.7 纯地形球面河流

第一版河流不计算降水差异。每个陆地 region 贡献自身 `regionArea` 作为均匀径流，因此汇流结果表示上游集水面积，并且不会因 subdivision 改变而显著改变河流密度。

生成流程：

1. 将全部海洋和湖泊 region 放入最小优先队列作为排水出口；
2. 使用球面 Priority-Flood 抬升封闭洼地的排水高程；
3. 为每个陆地 region 保存一个严格通向更低排水高程的 `downstreamRegion`；
4. 按排水高程从高到低累计 `regionArea`；
5. 根据最小流域面积、源头高程和最小长度提取河网；
6. 湖泊与海洋都是合法终点，河流数据不感知二维投影切口。

应满足：所有陆地排水路径无环并最终进入水域，全部水域出口收到的累计流量之和接近总陆地面积。

---

## 10. Three.js Globe 渲染

### 10.1 固定半径 Voronoi 单元几何

每个 Voronoi 单元使用“region 中心 + 相邻两个单元角点”展开成三角扇。不同单元复制各自的渲染顶点，从而让一个单元保持同一种颜色，禁止 Three.js 在相邻 region 之间插值颜色：

```ts
const geometry = new BufferGeometry()

geometry.setAttribute(
  'position',
  new BufferAttribute(renderPosition, 3),
)
geometry.setAttribute(
  'color',
  new BufferAttribute(regionColor, 3),
)
geometry.userData.faceRegions = faceRegions
```

第一版中，每个顶点的显示位置只取决于单位球面位置和星球半径：

```text
renderPosition = unitPosition × planetRadius
```

`elevation` 不参与 position 计算，只用于顶点颜色映射、海陆分类和地理数据验证。高程参数变化时只更新 color buffer，不更新 position 和 normal buffer。

推荐初始显示参数：

```ts
planetRadius: 100
subdivision: 6
```

### 10.2 球面材质与颜色模式

第一版使用带顶点色的 `MeshStandardMaterial`：

```ts
new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
})
```

支持四种显示模式：

- `terrain`：深海、浅海、平原、丘陵、山地、雪线；
- `elevation`：按 Voronoi 单元离散显示的高程色带；
- `contours`：量化高程分层色带，并叠加球面 marching triangles 等高线；
- `plates`：板块调试色。

切换显示模式只更新展开后的 color buffer 和显示叠层，不重新生成世界。

### 10.3 海陆与高度着色

第一版不创建独立海洋球体。陆地、海洋和不同高度全部绘制在同一个固定半径球面上，通过顶点颜色区分：

- 低于海平面的高程映射为深海到浅海色带；
- 海平面附近映射为海岸或低地颜色；
- 陆地高程映射为平原、丘陵、山地和雪线颜色；
- `terrain` 模式使用分段地貌色带；
- `elevation` 模式使用连续色带，以便检查高程场是否平滑。

这样可以避免海洋球体与固定地表重合产生的深度冲突，也能确保第一版的高程效果完全由颜色表达。

### 10.4 灯光

第一版使用：

- `HemisphereLight` 提供基础环境光；
- `DirectionalLight` 提供球体整体明暗和立体感；
- 深色场景背景；
- 不启用实时阴影和后处理。

### 10.5 板块边界调试层

遍历相邻 region，在板块编号不同的边上生成固定半径略大于球面的 `LineSegments`，这个常量偏移只用于避免调试线与球面发生深度冲突，与 region 高程无关：

- 汇聚边界：红色；
- 分离边界：蓝色；
- 转换边界：黄色。

该图层用于验证山脉、海沟和洋中脊是否与板块结构对应。

### 10.6 海岸线与等高线

海岸线遍历球面 Voronoi 共享边界。当一条边两侧的 `landMask` 不同时，记录其两个 Voronoi corner 以及陆地/水域 region；随后按共享 corner 将这些边拼接成闭合海岸路径。每条路径使用球面 Catmull–Rom 等价三次 Bézier 重采样，并生成共享采样点的 ribbon 几何：

- 粗海岸描边宽度为 `0.275` 个世界单位（约为上一版的一半），使用深色 `MeshBasicMaterial`，与 Contour 细线区分；
- 完整球面保持原始 Voronoi Cell 的陆地/水域颜色，避免闭环投影或掩膜裁剪错误地覆盖大陆；
- 每一段平滑海岸线与对应的原始 Voronoi 边之间生成一块连续填缝面：平滑线向水域偏移时补陆地颜色，向陆地偏移时补水域颜色；
- 填缝面只覆盖两条边界之间实际存在的窄带，不会产生对称的可见缓冲带；
- 描边和填缝面都重新归一化到固定球面半径，常量图层半径只用于避免深度冲突，不表达高程。

这样海陆可见边界与粗海岸线保持贴合，同时仍保留底层 Cell 的高度颜色。`plates` 调试模式同样保留完整板块 Cell 颜色，再以窄填缝面消除海陆平滑边界的裂缝。

等高线遍历 Icosphere 三角形，对给定阈值在线性标量场的边上插值交点。交点以所属 Icosphere 边为稳定标识，因此相邻三角形共享同一交点；同阈值的线段据此拼接成开口路径或闭环，再以较低平滑系数重采样。等高线使用主三角形标量场，海岸线使用 Voronoi 单元边界，两者职责不同。

平滑路径和填缝面仅改变叠加渲染几何，不改变 `landMask`、Cell 数据或高程值；它们只负责让 Cell 海陆边界贴合连续海岸线，不参与高程计算。

### 10.7 河流

河流拓扑仍由陆地 region 指向下游 region；入海或入湖路径结束于两侧 Voronoi cell 的共享边界中点。渲染层不再把每个 Cell 河段作为独立带状网格，而是参照二维河流的竞争与平滑方式完成以下处理：

1. 在汇流点选择上游流量最大的分支延续为干流，其余分支作为支流结束于同一个汇流点；
2. 将源头、连续河道、汇流点和河口组织成完整路径；
3. 在每个原始河段的三分之一与三分之二处加入确定性横向偏移；
4. 对整条路径使用 Catmull–Rom 等价的三次 Bézier 控制点进行球面采样；
5. 使用平滑中心线的前后采样点计算局部切线和左右河岸，避免 Cell 连接处法线跳变；
6. 在汇流点生成共享的圆形连接面，覆盖主支流河岸之间的接缝；
7. 支流抵达汇流点时保持自身宽度，干流宽度按汇流后的累计流量继续增长。

所有平滑采样点都会重新归一化到球面。河流使用 `planetRadius + 0.26` 的固定图层半径避免深度冲突，这不是高程位移。

---

## 11. 相机、控制与 Region 拾取

### 11.1 相机和控制

```ts
const camera = new PerspectiveCamera(
  45,
  canvasWidth / canvasHeight,
  0.1,
  1000,
)

camera.position.set(0, 0, 280)
```

OrbitControls 初始配置：

```ts
controls.enableDamping = true
controls.enablePan = false
controls.minDistance = 125
controls.maxDistance = 500
controls.rotateSpeed = 0.6
controls.zoomSpeed = 0.8
```

开启 damping 后在动画循环中调用 `controls.update()`。

### 11.2 Region 拾取

使用 `Raycaster` 命中地形三角形：

1. 将鼠标转换为 NDC；
2. raycast 地形 `Mesh`；
3. 读取命中的 `faceIndex`；
4. 从 `geometry.userData.faceRegions` 直接取得对应 Voronoi region。

选中信息包括：

- region ID；
- 经纬度；
- 高程；
- plate ID；
- Ocean、Island 或 Lake；
- 可见的选中标记。

同一份映射后续也可以用于完整 Voronoi 单元高亮。

---

## 12. 球面世界与后续 2D 投影

球面世界是唯一权威数据源。后续 2D 模式不再运行平面 Poisson Sampling 和 `DiagramMesh` 世界生成管线，而是投影 `SphericalMesh.voronoi` 和 `SphericalWorldData`：

```text
SphericalMesh + SphericalVoronoi + SphericalWorldData
                 │
                 ├──► GlobeRenderer
                 └──► MapProjection ──► 2D Renderer
```

中央经线、投影类型、平移和缩放只影响二维显示几何，不能触发球面世界重新生成。旧平面代码暂时保留作效果参考，但不再作为新架构的数据源。

---

## 13. 参数与更新粒度

建议新增球面配置：

```ts
export interface GlobeGenParams {
  seed: number
  subdivision: number
  planetRadius: number

  plateCount: number
  continentCount: number
  landCoverage: number
  sizeVariety: number
  spread: number
  compactness: number
  elongation: number
  coastlineRoughness: number
  islandCount: number
  islandLandShare: number
  mountainStrength: number
  noiseStrength: number
  riverBasinThreshold: number
  riverMinSourceElevation: number
  riverMinLength: number

  displayMode: 'terrain' | 'elevation' | 'contours' | 'plates'
  showRivers: boolean
  showCoastlines: boolean
  showPlateBoundaries: boolean
  wireframe: boolean
  autoRotate: boolean
}
```

参数变化应分级处理：

| 参数 | 更新范围 |
| --- | --- |
| 相机、自动旋转 | 只更新视图 |
| `displayMode`、wireframe | 只更新材质或 color buffer |
| 山脉、噪声参数 | 重新生成高程与 feature，并更新 color buffer |
| 河流流域、源头与长度参数 | 只重新生成排水与河网 |
| 板块数、大陆参数 | 重新生成球面地理数据 |
| seed、subdivision | 重建整个球面世界 |

球面模式不再使用当前二维 `spacing`、overscan 和 `edgeOceanMargin` 参数。

---

## 14. 生命周期与性能

- 使用 `ResizeObserver` 监听 Globe Canvas 容器尺寸；
- 限制设备像素比或最大 drawing buffer 像素数；
- level 5 作为默认交互网格，level 6 作为高质量选项；
- 更新高程时复用 `Float32Array` 和 color BufferAttribute；
- 仅在拓扑变化时重建 index buffer；
- 重新生成或销毁时调用 `geometry.dispose()` 和 `material.dispose()`；
- 非活动模式停止动画循环；
- 第一阶段不启用阴影、后处理和额外透明海洋层；
- 生成阶段避免使用 Three.js `Vector3` 临时对象。

如果后续 level 6 生成导致明显主线程阻塞，再将 `SphericalWorldGenerator` 迁移到 Web Worker。本阶段先保证接口可以传输 TypedArray，但不把 Worker 作为前置条件。

---

## 15. 测试与验收

### 15.1 Icosphere 拓扑测试

- 顶点数和三角形数符合细分公式；
- 所有 `regionPosition` 长度接近 1；
- 所有三角形索引合法；
- 每条无向边恰好属于两个三角形；
- 邻接关系对称；
- 不存在边界 region；
- 每个 Voronoi cell 的角点数与 region 邻接数一致；
- 每条 Icosphere 边对应两个不同的 Voronoi corner；
- `sum(voronoi.cellArea)` 在容差内接近 `4π`；
- 满足 `V - E + F = 2`；
- 只有 12 个五邻接 region，其余通常为六邻接；
- `sum(regionArea)` 在容差内接近 `4π`。

### 15.2 确定性测试

相同的 seed、subdivision 和生成参数必须得到完全相同的：

- 顶点和三角形数组；
- 板块种子；
- `regionPlate`；
- `landMask`；
- `elevation`；
- feature 分类。

### 15.3 生成质量测试

- 所有 region 都属于一个板块；
- 高程不存在 NaN 或 Infinity；
- 陆地覆盖率按面积落在允许误差内；
- 最大水域稳定识别为全球海洋；
- 板块切向速度与质心近似正交；
- 生成结果不依赖相机方向或 3D 显示参数。
- 所有陆地 region 的排水路径最终进入海洋或湖泊；
- 排水图不存在环；
- 全部水域出口流量总和接近 `landArea`；
- 河段与下游 region 保持邻接；
- 平滑海岸线与等高线的所有采样点都保持固定渲染半径；
- 平滑等高线不包含零长度线段；

### 15.4 视觉验收

- 球体无缺口、破面和生成边界；
- 任意角度旋转时高程颜色连续；
- 所有球面顶点保持相同半径，高程不会改变球面轮廓；
- 相邻 Voronoi 单元之间不发生高程颜色插值；
- 海岸描边沿球面 Voronoi 单元边界闭合，且 Cell 拐角处连续平滑；
- 等高线在球面背面和经度接缝处不会断裂，并以连续平滑路径绘制；
- 河流不会因经度接缝中断，且河口与海岸边界衔接；
- 深海、浅海、低地、山地等色带能够清晰区分；
- 球体整体光照不会破坏高程颜色的可读性；
- 山脉主要出现在汇聚边界附近；
- 拾取结果与可见位置一致；
- 切换颜色模式不会重新生成世界；
- level 5 下旋转与缩放保持流畅；
- 切换 2D/3D 模式不会泄漏 Canvas 事件或 GPU 资源。

---

## 16. 实施顺序

### 步骤 1：Globe 渲染外壳

- 安装 Three.js；
- 增加 Globe Canvas；
- 实现 `WorldEngine` 和 `GlobeRenderer`；
- 创建相机、灯光、OrbitControls 和响应式尺寸处理；
- 先显示普通测试球体。

验收：可以稳定旋转、缩放、复位和切换模式。

### 步骤 2：Icosphere 数据网格

- 实现确定性 Icosphere 构建；
- 输出 TypedArray 顶点和三角形；
- 构造 CSR 邻接和 regionArea；
- 完成拓扑单元测试；
- 使用随机调试色显示网格。

验收：球面闭合、数组稳定、面积总和接近 `4π`。

### 步骤 3：无缝球面高程着色

- 接入 `noise3D`；
- 保持所有顶点位于固定半径球面；
- 将高程映射为海洋与陆地颜色；
- 支持 terrain、elevation 和 plates 颜色模式更新。

验收：任意角度观察都没有高程颜色接缝，球面轮廓不受高程影响。

### 步骤 4：球面地理生成

- 实现板块种子与生长；
- 实现切向速度和板块边界分类；
- 实现大陆、岛屿和面积覆盖率；
- 加入地质高程；
- 完成海洋与湖泊分类；
- 增加板块边界调试层。

验收：能够根据 seed 生成完整、无边界的球面世界。

### 步骤 5：交互与工程收尾

- 实现 region 拾取和选中信息；
- 完成 Globe Tweakpane 参数；
- 实现参数更新粒度；
- 完成资源销毁、模式切换和性能检查；
- 补齐确定性与视觉验收测试。

### 步骤 6：纯地形河流

- Priority-Flood 洼地处理；
- 排水方向和面积汇流；
- 河网提取与参数控制；
- 球面带状河流渲染；
- 排水无环、面积守恒和固定半径测试。

---

## 17. 主要风险与约束

### 17.1 过早追求视觉效果

云层、大气、反射和后处理容易掩盖数据问题并扩大范围。第一阶段以固定球面、高程配色、基础光照和调试图层为限。

### 17.2 直接迁移平面生成器

当前板块、高程和 feature 生成器依赖 `DiagramMesh`、二维坐标和矩形边界。第一阶段使用球面专属生成器，避免用假的 width/height 适配球面。

### 17.3 Icosphere 网格规则感

不要通过随机扰动 Icosphere 顶点解决规则感。自然形状应主要来自板块生长、面积配额、海岸扰动和多尺度三维噪声。默认不显示三角网格线。

### 17.4 误把高程用于几何位移

第一版的所有球面顶点必须保持固定半径，`elevation` 只能参与颜色映射和地理分类，不能参与 position 计算。权威 `elevation` 保持统一归一化范围，保证后续二维投影能够读取相同数据。

---

## 18. 后续二维投影接口

第一阶段虽然不实现二维投影，但必须保留以下稳定数据：

- 单位球面 `regionPosition`；
- `regionLatitude` 和 `regionLongitude`；
- `triangles`；
- CSR 邻接；
- `regionArea`；
- `voronoi.cornerPosition`；
- `voronoi.cellCornerOffsets` 和 `voronoi.cellCorners`；
- `voronoi.edgeRegions` 和 `voronoi.edgeCorners`；
- 河流排水方向、汇流面积、源头和河段数组；
- `SphericalWorldData` 全部地理属性。

后续投影层直接消费这些数组：

```text
SphericalMesh + SphericalWorldData
                 │
                 ├──► GlobeRenderer
                 └──► MapProjection + 2D Renderer
```

修改中央经线或投影类型只能重建二维显示几何，不能重新生成球面世界。

---

## 19. 最终建议

第一阶段采用以下最小闭环：

```text
Icosphere 主拓扑
+ 球面 Voronoi 对偶
+ 球面板块和大陆
+ 三维无缝高程
+ Voronoi 单元高度图
+ 球面海岸线和等高线
+ 纯地形球面河流
+ OrbitControls 和 Raycaster
```

不引入：

```text
平面 Poisson Disk Sampling
二维投影
高程径向位移
独立海洋球体
复杂 3D 视觉效果
```

该方案可以验证球面大陆分布、板块结构、高程分布和整体星球观感。`SphericalMesh`、`SphericalVoronoi` 与 `SphericalWorldData` 是下一阶段二维投影的唯一数据源，不再维护独立的平面世界生成状态。
