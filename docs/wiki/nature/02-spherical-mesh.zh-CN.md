# 02 · 球面网格与拓扑

[English](./02-spherical-mesh.md) | [简体中文](./02-spherical-mesh.zh-CN.md)

## 直观理解

整个星球先被切成许多相邻的“地块”。每块有中心、面积和邻居。板块扩张、水汽传播、径流汇流都沿这张球面邻接图运行，因此地图投影不会改变自然地理结果。

## 从正二十面体到区域

[IcosphereBuilder](../../../src/core/mesh/icosphere-builder.ts) 从正二十面体出发，每次把一个三角形分成四个，新增顶点重新投到单位球。Level 为 `L` 时，顶点与区域数为 `10 × 4^L + 2`：Level 6 是 40,962 个区域，默认 Level 7 是 163,842 个区域。顶点成为 Voronoi 区域中心，三角面决定邻接。

`irregularity` 会在切平面内扰动区域中心。扰动非零时，代码通过球极立体投影和 Delaunator **重建三角剖分**，再计算邻接、经纬度与区域面积。因此“不规则网格每格都有 5 或 6 个邻居”并非代码保证；不要把正则 Icosphere 的度数当作普遍约束。

区域面积 `regionArea` 是**单位球面面积**，全球总和应接近 `4π`。需要真实面积时乘以物理半径的平方。邻接以 CSR 形式存储：`neighborOffsets[i]` 到 `neighborOffsets[i+1]` 是区域 `i` 在 `neighbors` 中的邻居片段。这样遍历大量区域时不需要为每块分配独立数组。

| 字段 | 每个区域中的含义 | 典型用途 |
| --- | --- | --- |
| `regionPosition` | 单位球三维中心 | 大圆距离、球面切向量 |
| `regionLatitude` / `regionLongitude` | 中心的弧度经纬度 | 气候纬度带、地图投影 |
| `regionArea` | 单位球面上的面积 | 大陆覆盖率、径流权重 |
| `neighborOffsets` / `neighbors` | 相邻区域索引 | 板块扩张、水汽传播、排水 |
| `triangles` | 区域中心形成的三角面 | Voronoi 对偶与几何构建 |

两个单位方向 `a`、`b` 之间的大圆角距离为 `acos(clamp(a·b, −1, 1))`。若算法需要以 km 表示的距离，再乘物理半径；不能把渲染球半径当作地球物理半径。

## 固定参考网格

[MeshStage](../../../src/core/simulation/pipeline/stages/mesh-stage.ts) 始终构建 Level 6 参考网格，并按细节参数构建输出网格；两者等级相同时共用对象。板块、大陆和地壳先在参考网格上确定，再通过 `outputToReference` 投到输出网格。映射查询点经过确定性噪声扰动，使宏观边界不呈现规则采样锯齿。气候使用另一条纯地理映射，避免气候场跟着构造边界扭曲。

高细节模式下气候仍在较粗网格计算，然后投到输出网格；最终排水和河流则用输出网格的实际邻接关系。改变输出精度会影响局部形状和数值离散，不保证每一格完全一致。

参考与输出映射使用 [ReferenceGridProjector](../../../src/core/mesh/reference-grid-projector.ts)。`outputToReference` 是每个输出区域对应的一个参考区域，用于离散的板块与候选大陆编号。连续气候场需要多区域加权采样，因此使用[单独的气候输出投影](../../../src/core/climate/climate-output-projector.ts)。把这两种映射混用会造成海岸附近的气候场沿板块边界偏移。

## 术语与检查

**Voronoi 区域**是“离这个中心最近”的球面范围；**对偶三角网**连接相邻区域中心；**大圆距离**是球面上的最短弧长。检查网格时应验证邻接双向、区域连通、面积为正及面积总和。相关数据结构见 [SphericalMesh](../../../src/core/mesh/mesh.ts) 与 [Voronoi 构建](../../../src/core/mesh/voronoi.ts)。
