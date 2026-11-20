# 世界数据与生成产物契约

> 更新：2026-11-20。本页定义跨模块的权威契约。实现以源码和测试为准；逐阶段字段表、单位和模型限制见 [契约参考快照](WORLD_DATA_CONTRACTS_REFERENCE.md)，Stage 执行规则见 [生成管线](GENERATION_PIPELINE.md)。当前 `WorldSnapshot` Schema 为 4。

## 数据类别与所有权

- `ContentDefinition`：生成候选，不是已生成事实，由 `world-data` 拥有。
- `GenerationArtifact`：阶段产物，可缓存和传输，不自动成为世界事实。
- `WorldSnapshot`：完整、已校验并发布的权威世界，由 `world-core` 管理。
- `MapStyle` / `ViewState`：制图与交互状态，不进入快照或生成签名。

阶段数组由生成端独占。发布时复制候选、执行完整校验，再原子替换当前快照。消费者使用只读 Query/FieldView，不取得权威数组或可写 Buffer。Worker 只转移独立副本；已发布数组的修改必须通过新快照完成。

## 快照与身份

`WorldSnapshot` 顶层包含 `schemaVersion`、`snapshotId`、`revision`、`time`、`metadata`、`planet`、`mesh`、`nature` 与 `civilization`。当前 Schema 为 4；`nature` 包含 geology、geography、climate、hydrology、ecology、resources 六个完整状态，`civilization` 包含 peoples、cultures、religions、polities、settlements、population、populationGroups 与 transport。阶段产物不能填零后冒充完整快照。

`metadata` 保存世界 ID、名称、调用方提供的 UTC 创建时间、字符串 Seed、生成器版本、内容签名/包清单、生成配置和 provenance。名称、创建时间不参与随机身份；对象 ID 不从展示名称、数组序号或当前时间隐式生成。revision 为非负安全整数；同一世界发布新快照须使用新 `snapshotId` 并递增 revision。

所有 DenseField 必须携带所属 `meshId`，长度与 Mesh 区域数匹配。索引只在该 Mesh 内有效；换 Mesh 后重建区域映射。月度气候与雪水字段采用 `month * regionCount + region` 的 12 月等时长 month-major 布局。

## 数值与实体不变量

- 数组值必须为有限数值，不使用 NaN 表示缺测；无归属使用契约规定的 `-1` 或 `null`。
- 高程单位为 km、相对海平面；`landMask` 必须与最终高程符号一致。
- 月温使用 °C，月降水使用 mm/月，年降水按月值汇总；径流深、体积和流量分别使用 mm/年、m³/年 和 m³/s。
- 人口字段为区域权威总数。稀疏人口分组与区域人口守恒；聚落人口包含于区域人口，不可重复累计。
- 图、实体引用和字段索引必须指向同一 Mesh/快照范围内的有效对象；稳定 ID 不依赖数组顺序或显示名称。

具体字段的 dtype、形状、单位、有效范围、来源和失效关系由对应 TypeScript 契约与运行时验证器定义。新增或改变公开字段时，更新源码、校验、消费者及本文件或 [契约参考](WORLD_DATA_CONTRACTS_REFERENCE.md) 中受影响的条目。

## 环流重采样

`climate-c0-v22` 的 C0 阶段产物新增可选 `projectedCirculation`：`windEast`、`windNorth`、`oceanEast`、`oceanNorth`、`oceanWarmth` 各为 Float32/4N，season-major，模型相对单位，向量位于输出格切平面。直接生成的参考场可省略此项；投影产物优先通过它提供查询及月度发布，原 `circulation`、`geographicReference` 和 `oceanReference` 继续保存参考场与来源/可用性。投影字段须有限，暖度在 [-1, 1]，`oceanReference === -1` 的区域所有投影洋流字段为零。

`extractMonthlyCirculation` 与单点查询共同使用重采样值和原标定系数。Schema 3 的 `nature.climate.circulation` 结构、单位与所有权不变；`oceanAvailable` 继续区分陆地/缺测与有效静止水域，年速度为 12 个月向量模长的均值。旧快照读取其已保存数组，不在恢复时套用新生成规则。旧 C0 缓存由 Stage 版本失效。细节及固定 Seed 对照见 [环流显示分析](benchmarks/M1.2-circulation-display.md)。

## 内容包与命名

`world-data` 拥有内容定义、Catalog、依赖解析、校验、哈希与命名 JSON 格式；`world-core` 编译期不依赖 `world-data`，内容通过调用方注入的结构化视图和 `ContentPort` 消费。

当前 ContentPack 使用 schemaVersion 1，包含 `names`、`namingStyles`、`cultures`、`peoples`、`polities`、`religions`、`resources`、`presets` 与 `translations` 等当前契约字段（已移除 `governments` 与 `states`）。内容 ID 与显示文本分离；依赖使用精确版本，Catalog 校验重复 ID、依赖、翻译和内容哈希。当前 `fnv1a32` 用于确定性身份与意外变更检测，不是安全摘要。

NamingStyle 是独立的风格-语言档案，格式为 `another-earth/naming-style`、schemaVersion 2。文化通过完整 `namingStyleId` 引用档案。社会作者 JSON 使用 `another-earth/society-pack`、schemaVersion 1（支持 `peoples` / `cultures` / `polities` / `religions` 四个互斥域），每份文件自包含单一语言领域定义，并由适配器转换为完整 ContentPack。内置默认生成目录加载中文内容包（`western-zh-cn`、`builtin-peoples-zh-cn`、`builtin-cultures-zh-cn`、`builtin-polities-zh-cn`、`builtin-religions-zh-cn` 与 `core` / `earthlike`）。

## 校验与档案

`validateWorldSnapshot` 的完整模式执行发布/恢复所需的领域校验；结构模式只用于结构检查，不能用于发布或存档验收。输入为已解码对象，校验器不是任意 JSON 的安全解析器。当 `civilizationEnabled` 为 `true` 时，校验器额外要求完整的文明阶段 provenance、族群/文化/政体/宗教/资源引用、交通拓扑连通性与人口守恒约束。

当前档案实现为 `another-earth-m0-json` v1，内部世界为 Schema 4；编码与解码均校验快照、内容身份和校验和，不保留对 Schema 1–3 旧档案的迁移或兼容。该 JSON 档案不是 M4 `.aearth` 格式，也不包含浏览器项目存储流程。

地名阶段的新生成版本是 `geographic-names-v4`。发布与恢复同时接受该版本和 `geographic-names-v3`；v3 档案保留已经写入的名称。v1/v2 以及缺少地名阶段的档案仍然拒绝。

## 文档维护边界

本页只在权威数据形状、单位、身份、所有权、发布/校验或档案兼容规则变化时更新。具体 Stage 算法变化若不改变数据契约，不需要修改本页；阶段细节仅在其契约发生变化时更新 [契约参考](WORLD_DATA_CONTRACTS_REFERENCE.md) 的对应部分。