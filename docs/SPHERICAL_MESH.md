# M0.3 球面网格、拓扑与空间查询

## 公开接口与存储

入口：`@another-earth/world-core`。

```ts
const mesh = createSphericalMesh({ subdivisionLevel: 6, physicalRadiusKm: 6371 })
const queries = new MeshQueries(mesh)
const spatial = new SphericalSpatialIndex(mesh)
const position = { x: 0, y: 0, z: 0 }
latLonToCartesian(0, Math.PI / 2, position)
const region = spatial.findNearestRegion(position)
queries.getRegionCenter(region, position)
queries.forEachNeighbor(region, (neighbor, edge, distanceKm) => { /* read only */ })
```

SphericalMesh 扩展现有 MeshTopology，不改变 WorldSnapshot schema 和 M0.2 字段。区域数 N=10×4^L+2，面数 F=20×4^L，边数 E=30×4^L。只接受整数 L0–L7，不根据目标区域数量暗中推断等级。单位球坐标与物理面积分离；physicalRadiusKm 必须产生有限且非零的面积。

| 字段 | 类型/长度 | 含义 |
| --- | --- | --- |
| centers | Float64 / 3N | 区域中心 XYZ，单位球面 |
| areaKm2 | Float64 / N | Voronoi 区域实际面积，km²；除以 R² 得球面立体角 |
| neighborOffsets | Uint32 / N+1 | CSR 半开范围；同时作为 boundaryCorners 的区域范围 |
| neighbors | Uint32 / 2E | 区域邻居，稳定的首次边遍历顺序 |
| triangles | Uint32 / 3F | 每面三个区域 ID，外向逆时针 |
| dualVertices | Float64 / 3F | 每面一个球面外心；对偶顶点 ID 等于面 ID |
| boundaryCorners | Uint32 / 3F | 每区域外向逆时针的对偶顶点序列，不重复首点 |
| edgeRegions | Uint32 / 2E | 边连接的两个区域中心 ID |
| edgeTriangles | Uint32 / 2E | 共享该边的两个面 ID，同时是对偶边的两个端点 ID |
| triangleEdges | Uint32 / 3F | 面内第 j 条边连接顶点 j 与 (j+1)%3 |
| neighborEdges | Uint32 / 2E | 与 neighbors 同槽的边 ID |
| edgeAngularDistances | Float64 / E | 两个区域中心的大圆角距，弧度；乘 R 得 km |

所有索引仅在所属 meshId 中有效。meshId 包含算法版本、细分等级与物理半径，因为 areaKm2 随半径改变。经纬度、法线和边界端点坐标不再冗余存储；按需由中心/对偶顶点推导。邻接距离每条无向边只存一份。

## 算法与旧版参考

保留旧版 IcosphereBuilder 的标准二十面体顶点、面及四子面顺序；公共边使用中点缓存，取端点和后归一化。使用预分配 TypedArray 和数值边键替代逐面对象及字符串边键。在 L7 范围内数值边键远小于 JavaScript 安全整数上限。

保留旧版 SphericalVoronoiBuilder 的外向面法线作为球面外心、局部切平面 atan2 排序及小度数插入排序；用区域中心与相邻对偶顶点构成球面三角形扇区。面积沿用 determinant / dot-product 的 `2 atan2` 球面公式，而非平面多边形面积。所有几何累加使用 Float64，最后乘物理半径平方。

标准细分面是球面 Delaunay 三角剖分；对偶采用靠近该面一侧的单位外心，适用于本模块生成的无扰动网格。校验检查外心等距与相邻面的空球冠条件；低等级测试还将所有对偶顶点与所有中心比较，核实最近站点条件。正向且相邻连续的凸单元边界避免自交。

沿用旧版 ReferenceGridProjector 的三轴轮换、稳定中位数 KD-tree 与分支裁剪最近点查询。构建复杂度 O(N log²N)，常驻子节点数组占 8N 字节，临时索引数组另占 4N 字节。查询按单位球弦长比较，等价于大圆最近中心；一般查询裁剪多数节点，极端退化情况仍可能遍历 O(N)。不引入全局单例或缓存。

后续补充任务已接入旧版切平面扰动和立体投影 Delaunator 重建，详见 SPHERICAL_DELAUNAY.md；本页原始规则网格基准保留作为对照。irregularity 默认仍为 0，不迁移噪声、地形扰动或任意分辨率算法。旧目录没有测试文件；只读查看了 Git HEAD 中既有 spherical-world 测试的网格闭合、面积与最近站点断言，未恢复或运行旧版测试。

## 坐标与查询

右手坐标系，北极 +Y、南极 -Y，零经度 +Z，东经 90° 为 +X。纬度范围 [-π/2,π/2]；输入经度允许任意有限弧度并自然环绕，输出经度为 [-π,π]。精确轴上极点的输出经度固定为零。所有数学 API 角度均为弧度。

latLonToCartesian、cartesianToLatLon、normalizeVector 和中心读取接受调用方 out 对象，便于热循环复用。tangentDirections 提供正交东/北方向，精确极点使用零经度确定方向。angularDistance 用 atan2 处理近距离和对跖点；greatCircleDistanceKm 明确接收物理半径，没有渲染半径参数。

MeshQueries 提供中心、面积、邻居数、邻接判断、邻接距离、区域遍历、邻居遍历和边界顶点遍历。SphericalSpatialIndex.findNearestRegion 接收任意非零有限方向并归一化；相同计算距离选择较小区域 ID。零向量、无穷值和越界区域查询抛出 RangeError。查询不修改 Mesh。

## 所有权与兼容

生成器返回由 world-core 所有者独占的可序列化 TypedArray 存储。readonly 属性不冻结元素，核心所有者必须承诺构建后不修改或转移已发布 Buffer。buildSphericalVoronoi 接管输入 IcosphereGeometry 的所有权；不得继续修改该输入或拿它构建可变副本。

MeshQueries 与 SphericalSpatialIndex 用 JavaScript 私有字段借用稳定存储，不向调用者返回 TypedArray、subarray 或 Buffer。它们与网格一起失效，不能在所有者违规修改、detach 后继续使用。多次生成有独立数组，不共享全局可变状态。没有无条件深拷贝或全局缓存管理器。

原 MeshTopology 保留原样，SphericalMesh 是其结构兼容扩展；WorldSnapshot 中可以安装完整生成网格。本任务没有修改快照 schema。与技术设计 §7.1 一致；本次明确细分等级、增加可追溯拓扑和局部空间索引，不实现参考/输出网格间投影映射。

## 校验和测试

validateSphericalMesh 检查数量、dtype、CSR、Euler 特征、两面共边、对称无重复邻接、规则网格的 12 个五邻域与其余六邻域（扰动网格允许可变度数）、非退化外向面、单位球中心及外心、对偶边界方向/连续性、正面积及全球面积和。它是类型化存储校验器，不是任意 JSON 解析器。区域面积和容差为相对 1e-9，坐标长度和外心等距容差 1e-10，局部空球冠 dot 容差 1e-12。

日常测试验证 L0–L7 的生成数量、L0–L4 的完整拓扑，另覆盖确定性、不同调用顺序、跨实例隔离、物理半径缩放、坐标往返、经度接缝、极点与临近极点、同距选择、全扫描对照及错误输入。独立基准对 L5–L7 执行完整校验和最近站点对照，不设机器耗时阈值。

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @another-earth/world-core bench:mesh
```

## 本机基准

2026-11-03（Asia/Shanghai），Apple M3 Pro、darwin 25.6.0、Node v24.17.0。规则版本 icosphere-v1，半径 6371 km；无随机 seed。L3 预热后每等级运行三次，下表为各指标中位数。最近查询对 5,000 个确定性全球方向取每次调用的平均耗时；每轮另以全扫描核对 16 个查询。

| 等级 | 区域数 | Icosphere ms | 拓扑/对偶 ms | KD-tree ms | 网格 MiB | 索引 MiB | 查询 μs/次 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L5 | 10,242 | 1.42 | 8.47 | 10.10 | 2.70 | 0.078 | 0.473 |
| L6 | 40,962 | 3.40 | 22.77 | 51.29 | 10.78 | 0.313 | 0.504 |
| L7 | 163,842 | 15.85 | 114.77 | 267.76 | 43.13 | 1.250 | 0.790 |

原始三轮数据及每个 TypedArray 字节数见 `benchmarks/M0.3-mesh.json`。更新后的复跑会同时测量规则与扰动配置，在系统临时目录生成 another-earth-m03-irregular-benchmark.json，不自动覆盖仓库基准记录。计时不包含校验、查询样本准备和全扫描对照。

常驻网格/索引内存是精确 TypedArray 字节总数，不包含临时 Map、构建工作区、查询闭包或校验分配。RSS 仅在阶段后采样，包含测试进程和垃圾回收影响，不是峰值；没有测量浏览器内存或浏览器性能，也没有给出帧率/渲染性能结论。
