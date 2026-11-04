# M0.2 世界数据契约

公开入口为 `@another-earth/world-data` 与 `@another-earth/world-core`。本文件记录快照 schema 2 的实际实现；不定义生成算法。

## 快照与身份

`WorldSnapshot` 包含 `schemaVersion / snapshotId / revision / time / metadata / planet / mesh / nature / civilization`。
`nature` 下五个状态始终齐备：`geology / geography / climate / hydrology / ecology`。生成过程中的不完整产物不能作为快照。

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

本阶段不实现状态事务、Worker 或 Copy-on-Write。FieldView 保证正常 API 不暴露写入口，不能阻止持有原始快照的所有者违规修改。

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
