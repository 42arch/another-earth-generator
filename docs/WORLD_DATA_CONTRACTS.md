# 世界数据与生成产物契约

> 更新：2026-11-08。本文件定义字段、单位、身份和所有权；生成调度见 [生成管线](GENERATION_PIPELINE.md)，算法设计见 [技术设计](TECHNICAL_DESIGN.md)。公开入口为 `@another-earth/world-data` 与 `@another-earth/world-core`。当前快照 Schema 为 2，GenerationArtifact 不等于已发布快照。

## 快照与身份

`WorldSnapshot` 包含 `schemaVersion / snapshotId / revision / time / metadata / planet / mesh / nature / civilization`。
`nature` 下五个状态始终齐备：`geology / geography / climate / hydrology / ecology`。生成过程中的不完整产物不能作为快照。

当前生成 Mesh、GeologyArtifact、基础 TerrainArtifact，并有待验证的初步 ClimateArtifact C0；均为阶段产物。快照中的气候、水文、生态类型已定义，但没有最终自然状态生成器和完整发布流程；不得补零伪装完整世界。完整自然结果必须通过完整校验后原子发布。

工作区新增待验证的 `ClimateArtifact` C0，来自 T0，仍是阶段产物而非已确认 `ClimateState`。它存储同一输出 Mesh 上的 `temperatureC` 与 `precipitationMm`（各 12N、month-major）、年均温与年降水（各 N）、Köppen 亚型索引（N，0–31；0 为海洋）；另保存参考 Mesh ID、输出到参考映射及四季风、季风、洋流与暖度模型场，供调试查询。这些是 C0 阶段产物，未发布为世界事实。每箱占公转年的 1/12，月降水总量随公转周期缩放；区域年值从同一月序列聚合。C1 必须使用独立产物身份并重算分类。本次校验命令尚未运行。

`metadata` 保存 worldId、实际名称、调用者提供的 UTC 创建时间、字符串 seed、生成器版本、内容签名、内容包版本/哈希、Mesh 参数以及生成来源。当前来源包含 Mesh Stage 版本、输入签名和配置签名；M1 接入新 Stage 时必须一并扩展。创建时间和名称不参与随机身份；seed 是不透明字符串。snapshotId/worldId/实体 ID 由调用者提供，不能根据数组顺序、显示名称、当前时间隐式推导。revision 是非负安全整数，同一世界的新版本必须分配新 snapshotId 并增加 revision；校验单个快照无法证明跨快照的单调性。

模拟时间以相对世界纪元的年表示，可以为小数；实体 foundedAtYear 允许负值，不能晚于快照年份。ID 在改名后不变；消亡、继承关系留待历史任务按版本扩展，不建立历史框架。

无文明世界使用空实体集合、空人口分组及全零区域人口。文明种群采用稀疏的区域/物种/文化/宗教/国家联合分组，避免互相独立的比例字段产生矛盾。null 宗教/国家表示无信仰归属/无国家归属。国家人口由分组汇总，不另存重复统计。所有聚落居民包含在区域人口中，同区域聚落人口总和不得超过区域人口。分组与区域人口容差为 max(1e-6 人, 区域人口 × 1e-9)。允许聚合模型使用小数人口。

## 字段、单位与来源

每个 DenseField 自带 meshId，必须等于快照网格 ID。N 为该网格区域数。所有字段均无 NaN 缺测值；只有下游区域的 -1 和显式 null 引用表示无归属。字段具体 dtype 由 TS 类型和运行时检查共同约束。

| 字段 | 存储/长度 | 单位/有效范围 | 来源与失效 |
| --- | --- | --- | --- |
| mesh.centers | Float64 / 3N | XYZ 单位球，向量长度误差 ≤ 1e-6 | 网格创建；换网格失效 |
| mesh.areaKm2 | Float64 / N | km²，正数；面积和相对 4πR² 误差 ≤ 1e-6 | 网格与物理半径；任一变化失效 |
| neighborOffsets / neighbors | Uint32 / N+1 / E | 无向 CSR；连通、对称、无自环和重复邻居 | 网格创建；换网格失效 |
| geology.plateIndex | Uint32 / N | 当前 plates 表索引 | 已确认地质事实；换网格/板块表重建 |
| geology.crustType | Uint8 / N | 0 海洋地壳，1 大陆地壳 | 已确认地质事实 |
| geography.elevationKm | Float32 / N | km，相对海平面；径向位置 > 0 | 最终地形事实；修改地形后重算依赖 |
| geography.landMask | Uint8 / N | 0 海洋，1 陆地；高程 > 0 为陆地，0 为海洋 | 从最终高程派生并保持一致 |
| climate.temperatureC | Float32 / 12N | 月平均 °C，≥ -273.15 | 已确认月气候；模型输入变化失效 |
| climate.precipitationMm | Float32 / 12N | 月总量 mm/月，≥ 0 | 已确认月气候；年量按月求和 |
| hydrology.downstreamRegion | Int32 / N | 同网格区域索引，-1 出口；无环 | 已确认排水事实；水文重算后替换 |
| hydrology.annualRunoffMm | Float32 / N | mm/年，≥ 0 | 已确认径流；不是河流流量 |
| ecology.*Index | Uint16 / N | 当前 biome/land-cover 字典索引 | 生态分类；换网格/字典显式重建 |
| civilization.population | Float64 / N | 人数，≥ 0 | 区域人口权威总数 |

月气候固定为 12 个季节采样月，month-major：`month * N + region`，月份为 0..11。这是类地年内分箱，不隐含公转周期必须为 365 天；每箱占一个行星年的 1/12。没有混用日降水与月总量。

行星参数使用 km、24 小时的地球日、小时与角度。倾角范围 [0,180]；半径、自转和公转周期为有限正数。seaLevelDatumKm 相对物理参考球，地形高程再次相对该海平面。渲染半径不属于这个模型。潜在生态与实际覆盖分别存储；地图样式、GeoJSON、GPU 数据、算法诊断不进入快照。

## 所有权

WorldSnapshot 是 world-core 数据所有者使用的完整存储契约，readonly 属性防止替换引用，但 TypedArray 仍可被所有者写入。它不是 UI 可直接持有的查询对象。

1. 构建者独占工作数组；候选快照通过完整校验前不能发布。
2. 发布时将整个候选快照的数组及底层 Buffer 的独占所有权交给快照所有者。构建者必须丢弃所有别名，包括 subarray；后续计算分配或使用另一套工作缓冲，不能复用已发布 Buffer。这是调用方必须执行的所有权约定，不是 JavaScript 强制隔离。
3. 消费者通过 `createFieldView` 读取字段。该函数零拷贝，返回冻结的小型包装对象，仅暴露 meshId、length 和带边界检查的 get，不暴露数组/Buffer。网格的原始数组也只能留在核心所有者中；未来 Query 按需提供坐标读取。
4. 已发布数组不可原地修改、detach 或 transfer。变更必须构建下一份候选状态，重新校验并整体切换。可共享且承诺不修改的数组可跨 revision 复用。不通过冻结 TypedArray 或无条件深拷贝实现不可变性。

FieldView 本身不实现状态事务、Worker 或 Copy-on-Write。FieldView 保证正常 API 不暴露写入口，不能阻止持有原始快照的所有者违规修改。

## 内容与验证

内容 ID 为 `namespace:domain/name`，与 displayNameKey 分离。ContentPack 包含内容模板、版本/哈希/依赖清单以及 locale → 翻译键 → 文本。每个声明的语言必须覆盖该包显示键。`loadBuiltinCatalog()` 提供最小 `core` 和 `earthlike` 包；这是 M0 契约数据，不代表 M2 文明内容库已完成。

`validateContentPack(pack, resolvedDependencies)` 检查 ID、重复项、翻译、数值、名称池引用和显式依赖。M0 依赖使用精确版本。`createContentCatalog()` 会复制、校验并冻结已解析内容，验证每包的 `contentHash`，按包 ID 排序计算 `contentSignature`。当前哈希格式为 `fnv1a32`，用于确定性版本身份和意外篡改检测，不作为抗恶意碰撞的安全摘要。

`validateWorldSnapshot(snapshot, resolvedPacks, options)` 返回 `{valid, issues: [{code,path,message}]}`。完整模式为默认值，遍历字段及图，时间 O(N+E+实体/分组数)，需要 O(N+E) 临时图索引；错误最多报告 100 条世界问题。`structure` 检查长度、类型、元数据和实体引用，但跳过 dense 数值、图遍历和人口守恒，不能用于发布或存档验收。不能因 UI 状态变化重复调用完整校验。

两个校验器接收已经解码的类型化内存对象，不是任意 JSON 的安全解析器。`encodeWorldArchive` / `decodeWorldArchive` 提供 M0 版本化 JSON 往返，保存 TypedArray 类型并校验完整快照、内容版本和校验和；解码失败不返回候选世界。它不是 M4 的 `.aearth` 二进制格式、持久存储或用户导入流程。未引入通用 Schema 引擎。

## 与技术设计示例的细化

- 世界身份和生成来源元数据集中于 metadata；snapshotId/revision/schemaVersion 保持快照级。
- seed 使用字符串保存调用者的原始输入，避免隐式数字转换和安全整数损失。
- 采用 MeshTopology、PlanetParameters、NatureState 命名，分别明确拓扑、物理输入与已确认自然状态。
- 当前 generationConfig 包含行星参数、Mesh 细分/扰动/可选 Seed 覆盖、区域数和文明开关；provenance 包含 Mesh 阶段版本及签名。M1 新阶段必须将实际使用的参数和来源加入契约。
- 本阶段水文仅定义排水接收者与年径流；河流/湖泊实体、水量收支及生成算法须在专门水文任务中一起定义和验证。


## 球面网格契约

`SphericalMesh` 扩展 `MeshTopology`，公开生成器为 `createSphericalMesh`，读取用 `MeshQueries`/`SphericalSpatialIndex`。L0–L8 区域数 `N=10×4^L+2`、`F=20×4^L`、`E=30×4^L`。半径必须给出有限正面积；irregularity 为 [0,1]，Seed 为非空字符串或安全整数。

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

所有索引只在所属 meshId 内有效。右手坐标：北极 +Y，零经度 +Z，东经 90° +X；数学角度为弧度，显示角度另行换算。距离 API 显式区分单位球角距和物理 km，面积为 km²。规则网格有 12 个五邻域；扰动网格允许其他度数。

meshId 包含算法、等级、物理半径和适用时的扰动/Seed。规则网格不因 Seed 改变几何，输出 Seed 规范为 '0'，但 Pipeline 可保守地按 World Seed 失效。换 Mesh 后旧索引、最近站点树和参考映射必须重建。核心所有者不得修改或转移查询所借用的数组。

## 地质阶段产物

`GeologyArtifact` 带 meshId、referenceMeshId、referenceRegionCount、算法版本，以及稳定板块/大陆 ID 表。参考网格默认 L6（40,962 区域），内部基础细分 100。数组长度为输出区域 N，运动板块数为 P。

| 字段 | 类型/单位 | 含义 |
| --- | --- | --- |
| geographicReference / geologicalReference | Uint32 / 参考区域索引 | 普通最近点映射、独立扰动地质映射 |
| plateIndex | Uint32 / plates 表索引 | 主/微运动板块，区别于基础细分 |
| subdivisionIndex | Uint32 / 0..99 | 内部基础细分归属 |
| candidateLandMask | Uint8 / 0 或 1 | 候选陆地，不是最终地形海陆 |
| continentIndex / nearestContinentIndex | Int32 / continents 表索引或 -1 | 候选大陆及其最近归属 |
| crustType | Uint8 / 0 海洋、1 大陆 | 当前由候选陆地确定 |
| densityGcm3 | Float32 / g/cm³ | 地壳密度 |
| thicknessKm | Float32 / km | 地壳厚度 |
| baseElevationCoordinate | Float32 / 无量纲 | 旧算法塑形坐标，不能作为物理高程 |
| plateAngularVelocity | Float32 / 相对模型量，3P | 初始 Euler 向量，不是 rad/year，未做 M1.1B 动力学校正 |

微板块目标和实际数量分开报告。候选大陆用于地壳约束，不是最终海陆，也不能把大陆表数量解释为最终连通分量数量。覆盖率按物理面积统计。零候选陆地没有占位大陆。`queryGeologyRegion` 返回冻结标量/身份查询结果，不向 UI 暴露权威数组。

## 基础地形产物 T0

当前为 `terrain-skeleton-v9` / `terrain-v22`。`TerrainArtifact` 仍是独立阶段产物，带 meshId、算法版本、物理半径与海平面基准；没有自然世界发布或水文事实。

| 字段 | 类型/单位 | 含义 |
| --- | --- | --- |
| elevationKm | Float32 / km | 相对海平面的最终高程 |
| landMask | Uint8 / 0 或 1 | elevationKm > 0 为陆地，否则海洋 |
| slopeRadians | Float32 / rad | 最大邻域高差除以物理中心距离后取 atan |
| boundaryType | Uint8 / 0..3 | 无、汇聚、张裂、走滑 |
| stress | Float32 / 相对模型量 | 地幔调整后的构造应力诊断 |
| mantleFlow | Float32 / 约 [-1,1] | 正为上涌，负为下沉 |
| plateAngularVelocity | Float32 / 相对 Euler 模型量，3P | 按 M1.1A plates 表索引的校正运动 |
| volcanicCoordinate / ridgeCoordinate | Float32 / 无量纲塑形坐标 | 火山体及山脊贡献，不与最终 km 高程直接相加 |
| regionalUpliftCoordinate | Float32 / 非负塑形坐标 | 兼容字段，当前全零，未施加额外区域隆起 |
| roughnessWeight | Float32 / 0–1 | 兼容字段，当前全一，不再施加平缓区保护 |
| regionalReliefKm | Float32 / 有符号 km | 兼容字段，当前全零，未施加额外区域起伏 |
| erosionCoordinate / depositionCoordinate | Float32 / 非负塑形坐标 | 全零兼容诊断，表示本阶段未执行侵蚀/沉积 |
| foldBelt | Float32 / 相对分类量 | 褶皱带诊断 |

统计包含面积加权的陆地覆盖率和最大连通分量面积、海陆变化数、连通分量数、最低/最高高程，以及按区域排序而非面积加权的五个高程分位数。坡度为相邻中心最大物理高差/物理距离的 atan。

`landMask[r] === (elevationKm[r] > 0 ? 1 : 0)`，以写入 Float32 后的值为准；非零 seaLevelDatumKm 可以改变最终海陆。物理径向位置必须始终为正。最终数组无 NaN/Infinity，引用和长度经核心与主线程校验。

内部塑形坐标不会因类型同为 Float32 就自动具有 km 单位。负坐标输出 `8x` km；0–0.5 使用 `6x²(3−2x)`；0.5–1 使用单调 Hermite 锚点 `(0.5,3)/(0.72,4)/(0.82,5)/(1,6)`（坐标、km）；超过 1 则从 6 km 按每单位 6 km 延伸，最后减海平面基准。诊断贡献不能非线性换算后冒充可精确相加的物理分量。

当前 `terrain-v22` 在 T0 的内部塑形坐标中执行基础水力/冰川侵蚀。水力处理器输入为 `terrain.hydraulicErosion × 0.5`，冰川处理器输入保持 `terrain.glacialErosion`。`erosionCoordinate`/`depositionCoordinate` 为 N 长 Float32，记录参考处理器生成的侵蚀/沉积坐标差；它们不能直接与物理 km 高程相加。`regionalUpliftCoordinate`、`regionalReliefKm` 全零，`roughnessWeight` 全一，为旧诊断兼容值。侵蚀不读取气候/降雨，也不构造正式河网。

`TerrainParameters` 包含 roughness、terrainWarp、smoothing、ridgeSharpening、glacialErosion 与 hydraulicErosion；两项侵蚀强度范围 [0,1]，默认各 0.5，进入 T0 签名。旧键 continentalUpliftKm 仍在规划/执行、全缓存命中前拒绝。算法变更没有修改 WorldSnapshot Schema 2。

`queryTerrainRegion` 只返回冻结标量对象。Pipeline getOutput 是共享借用，不能修改或 Transfer；Web 只接收独立副本。完整自然快照生成后，正式视图应使用只读世界查询，不能直接持有权威 Buffer。
