# 世界数据与生成产物契约

> 更新：2026-11-23。本页定义跨模块的权威契约。实现以源码和测试为准；逐阶段字段表、单位和模型限制见 [契约参考快照](WORLD_DATA_CONTRACTS_REFERENCE.md)，Stage 执行规则见 [生成管线](GENERATION_PIPELINE.md)。当前 `WorldSnapshot` Schema 为 11。

## 数据类别与所有权

- `ContentDefinition`：生成候选，不是已生成事实，由 `world-data` 拥有。
- `GenerationArtifact`：阶段产物，可缓存和传输，不自动成为世界事实。
- `WorldSnapshot`：完整、已校验并发布的权威世界，由 `world-core` 管理。
- `MapStyle` / `ViewState`：制图与交互状态，不进入快照或生成签名。

阶段数组由生成端独占。发布时复制候选、执行完整校验，再原子替换当前快照。消费者使用只读 Query/FieldView，不取得权威数组或可写 Buffer。Worker 只转移独立副本；已发布数组的修改必须通过新快照完成。

## 国家特征内容与政体引用

`ContentPackV1` / `ContentPackView` 可选携带 `polityTraits`；省略表示未提供特征目录，兼容既有无此字段的内容包。内置目录为 `builtin-polity-traits@1.1.0`，源码位于 `packages/world-data/data/society/polity-traits.json`，采用原生内容包结构（加载时计算哈希）。每项包含语言无关的短 `id`、`dimension: power | governance | economy | territory`、`displayNameKey` 和 `descriptionKey`，每个 locale 必须覆盖名称与说明。领土维度必须声明非空、去重的合法 `sizeClasses` 条件；其他维度禁止此条件。内置共 16 项，`small-area` 属于 `territory` 且条件为 `["city-state"]`，依据划界后实际面积派生。短 ID 属于独立特征命名空间，不采用实体内容的 `namespace:domain/name` 格式；目录内及跨包不允许重复。

`PolityArchetype` / `PolityArchetypeView` 可选声明：

- `allowedSizeClasses: readonly (city-state | regional | kingdom | empire)[]`：硬规模约束，省略表示不限；显式数组须非空、去重且仅含合法值。不满足时候选权重为零，特征偏好不能覆盖。
- `requiredTraits: readonly string[]`：国家必须同时持有的特征；省略或空数组表示无额外要求。
- `traitAffinities: readonly PolityTraitAffinity[]`：每项包含非空 `traits`、可选 `excludedTraits`、可选非空 `sizeClasses`（`city-state | regional | kingdom | empire`）和有限正数 `weight`。全部要求命中且排除项未命中、规模符合时，将候选权重乘该值；多个条目按文档顺序相乘，省略或空数组不修正权重。

引用只解析到本包及明确声明、精确版本已解析的依赖目录；未知引用、重复引用、要求与排除重叠以及同维度的矛盾要求均拒绝。内置中英文政体包为 1.4.0，引用同一双语目录；神权国要求 `theocratic`；自由领地、酋长领、自治公社和城邦通过 `requiredTraits: ["small-area"]` 限定为小面积，内置不再重复设置 `allowedSizeClasses`。小面积门槛沿用 3 个参考支撑面积（37,356.41 km²，排除海面与湖面），不以聚落数量代替面积。政体基础权重表达内容先验，特征偏好按序乘权，不表示世界级出现比例；当前权重表及验证见 [CIV-05](benchmarks/CIV-05-polity-weights.md)。当前核心实现 15 种制度/经济特征及小面积领土特征，目录 ID 本身不会自动新增算法语义。城镇特征保持核心定义，不新增城镇特征 JSON。

调用方将目录合入 `CivilizationContentBundle.polityTraits`；目录 ID/维度/领土规模条件、政体基础权重、规模限制、特征要求及偏好进入文明内容签名，完整定义和翻译进入内容包哈希。现有文明阶段共用该内容键，修改匹配规则会使文明链缓存失效；尚未拆成只使末阶段失效的独立内容键。Web 徽章名称及悬停说明从目录翻译读取。

`PolitiesReligionsExtraContext.onPowerEvaluated` 为可选诊断回调，接收冻结的 `PolityPowerDiagnostic` 副本（首都 ID、选中权力特征、候选分数和局部输入信号）。诊断不进入快照、生成配置或内容签名；生成事实仍通过快照查询契约读取。v11 的权力评分表达条件支持度，由稳定 Seed 加权选择，零分候选禁用，不保证每个世界都出现全部类型或固定比例。

## 快照与身份

`WorldSnapshot` 顶层包含 `schemaVersion`、`snapshotId`、`revision`、`time`、`metadata`、`planet`、`mesh`、`nature` 与 `civilization`。当前 Schema 为 11；`nature` 包含 geology、geography、climate、hydrology、ecology、resources 六个完整状态，`civilization` 包含 peoples、cultures、religions、polities、settlements、population、populationGroups、territoryPolityIndex 与 transport。`territoryPolityIndex` 是长度等于区域数的 `Int32Array`，记录陆地归属的政体序号，`-1` 为无主；海洋必须为 `-1`。它独立于人口分组，无人陆地和湖泊也可以有归属。Schema 8 在 `Settlement` 新增 `features: readonly SettlementFeatureId[]`（12 种合法特征 ID，1–3 项去重），在 `Polity` 新增 `traits: readonly PolityTraitId[]`（当前 4 维 16 种合法特征 ID，1–4 项去重，生成管线产出 2–4 项）；`WorldMapReader` 与 `WorldStore` 对外仅暴露冻结拷贝。阶段产物不能填零后冒充完整快照。记录的内容包提供特征目录时，发布校验还要求国家特征全部存在于目录、每维最多一项，且权力/经济维度各一项；领土维度在划界后派生，不占原三维槽位，完整校验依据实际面积及人口份额检查其存在与缺失，不能只改标签绕过；任何政体候选的 `requiredTraits` 都必须被实际国家特征满足；存在 `allowedSizeClasses` 时声明规模必须合格，完整校验还从权威领土面积及已归属人口份额重算规模，拒绝伪造的小规模标签。旧无目录内容仍沿用合法 ID/数量/去重约束。

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

## 定居适宜度与派生查询

默认 `habitability-v4` 表示约 1900 年技术参照下的定居适宜度，综合环境限制、食物可达性、矿产/能源经济机会及通达潜力。它不是单纯的气候舒适度或已经存在的城市发展程度。矿点仍由 `nature.resources.deposits` 拥有，计算经济机会不会创建矿山、消耗储量或修改自然事实。

`HabitabilityArtifact` 新增三个长度 N、范围 [0,1] 的 `Float32Array`：`environmentalSuitability`（环境上限）、`economicOpportunity`（有供给与通达约束的资源机会）、`portPotential`（岸坡/淡水/遮蔽代理）。最终 `habitability` 不得超过环境上限。它们仅在阶段间传递，不作为快照中的权威人口或自然字段保存。公开 `generateHabitability` 的 Mesh 输入新增 `centers` / `physicalRadiusKm`，资源输入新增 `deposits`；`generatePopulationSettlements` 的宜居性输入新增必需的 `portPotential`，调用方须同步提供。

`CivilizationParameters.capabilities` 保留农业（0.25–2）、工业（0–2）、陆运（0.25–2）、航海（0–2）四项默认 1× 的能力，以及行政整合（0–1，默认 0.75）。根级格局字段：

- `populationScale`（0.1–4）、`settlementDensity`（0.25–4）、`urbanConcentration`（0–1，默认 0.65）与 `culturalDiversity`（0.5–2，默认 1）保持原契约。
- `polityCount: number`：1–200 的整数，默认 60。Web 使用单个滑杆（步长 1）选择确切国家总数，包含岛国；启用文明且有人口时，实际国家数必须与保存值完全相等，不进行数量随机抽取。可用独立陆地聚落不足时阶段明确失败，报告可行数量并保留已发布世界；无人口自然世界仍返回零文明实体。
- `politySizeVariation`：0–1，默认 0.5，表示期望的国家陆地面积差异。0 使用片区内接近均衡的目标份额；1 使用逆平方名次权重形成大小梯度。首都格的物理面积先保留，剩余面积按权重分配。目标不保证最终精确兑现，受可达性、孤岛、首都格、边界阻塞与后续海洋投送影响。陆地面积为归属区域 `areaKm2` 之和，排除海面和 `lakeIndex >= 0` 的湖面。

`polityDensity` 与 `polityCohesion` 为已移除字段，显式提供时拒绝，不映射到新参数。`CivilizationParametersInput` 允许省略字段及部分能力；解析器补全默认并复制能力对象，拒绝显式 NaN/Infinity/null、字符串、分数、越界国家数与旧 min/max 数量对象。启用文明时快照必须保存完整有效配置；候选装配和归档往返不保留调用方可写对象引用。Schema 11 拒绝旧 Schema 1–10，不回放旧算法或迁移旧倍率。

社会背景预设由 Web 拥有，预设 ID 不进入世界事实或签名；切换与匹配保留独立轴 `enabled`、`populationScale`、`culturalDiversity`。预设数量/面积差异分别为农耕 60/0.35、城邦商贸 108/0.25、区域王国 36/0.65、近代工业商贸 60/0.5；国家数以默认 60 沿用 CIV-01 的 1×/1.8×/0.6×/1× 情景比例，核心只消费整数值。数量与差异属于预设有效值，自定义修改须重新识别。分享保存 `polityCount` 和 `politySizeVariation`，采用 `#w=15.`，拒绝旧版本并校验 1–200 整数。承载密度系数 22/7 与默认生产/运输能力未改。

公开 `generateHabitability` 在资源输入后、进度回调前增加可选的生产/陆运能力输入；`generateTransportNetwork` 在聚落输入后、回调前增加可选的陆运/航海能力输入。省略时采用基准能力；已有传回调的调用方须调整参数位置。能力不改变自然矿点与农业潜力字段，人口与聚落变化通过新快照发布。

`WorldMapReader` 的 `habitability` / `carryingCapacityPerKm2` 从快照自然字段、矿点、`planet.physicalRadiusKm` 和 `metadata.generationConfig.civilization.capabilities` 重算，不读取当前编辑面板或预设名称。Schema 11 保存完整能力、确切国家数、面积差异及聚落/政体特征；旧 Schema 1–10 档案拒绝读取，不静默补新默认值、不执行旧档案人口重分配。仍不支持旧算法回放。`generatePopulationSettlements` 的参数新增必需的 `urbanConcentration`；`generatePeoplesCultures` 在 Seed 后、回调前新增文化多样性输入（默认 1）并在产物中暴露 `hearthRegions`；`generatePolitiesReligions` 读取 `polityCount` / `politySizeVariation`、可选 `urbanConcentration` 与 `capabilities`（`administrativeCapacity`、`seafaringCapability`、`industrialCapability`、`landTransportCapability`），并支持可选 `hydrology`/`ecology` 辅助输入用于城市特征评分。

## 内容包与命名

`world-data` 拥有内容定义、Catalog、依赖解析、校验、哈希与命名 JSON 格式；`world-core` 编译期不依赖 `world-data`，内容通过调用方注入的结构化视图和 `ContentPort` 消费。

当前 ContentPack 使用 schemaVersion 1，包含 `names`、`namingStyles`、`cultures`、`peoples`、`polities`、`religions`、`resources`、`presets` 与 `translations` 等当前契约字段（已移除 `governments` 与 `states`）。内容 ID 与显示文本分离；依赖使用精确版本，Catalog 校验重复 ID、依赖、翻译和内容哈希。当前 `fnv1a32` 用于确定性身份与意外变更检测，不是安全摘要。

NamingStyle 是独立的风格-语言档案，格式为 `another-earth/naming-style`、schemaVersion 2。文化通过完整 `namingStyleId` 引用档案。社会作者 JSON 使用 `another-earth/society-pack`、schemaVersion 1（支持 `peoples` / `cultures` / `polities` / `religions` 四个互斥域），每份文件自包含单一语言领域定义，并由适配器转换为完整 ContentPack。内置默认生成目录加载中文内容包（`western-zh-cn`、`builtin-peoples-zh-cn`、`builtin-cultures-zh-cn`、`builtin-polities-zh-cn`、`builtin-religions-zh-cn` 与 `core` / `earthlike`）。

## 校验与档案

`validateWorldSnapshot` 的完整模式执行发布/恢复所需的领域校验；结构模式只用于结构检查，不能用于发布或存档验收。输入为已解码对象，校验器不是任意 JSON 的安全解析器。当 `civilizationEnabled` 为 `true` 时，校验器额外要求完整的文明阶段 provenance、族群/文化/政体/宗教/资源引用、交通拓扑连通性与人口守恒约束。

当前档案实现为 `another-earth-m0-json` v1，内部世界为 Schema 11；编码与解码均校验快照、内容身份和校验和，不保留对 Schema 1–10 旧档案的迁移或兼容。该 JSON 档案不是 M4 `.aearth` 格式，也不包含浏览器项目存储流程。

地名阶段的新生成版本是 `geographic-names-v4`。发布与恢复同时接受该版本和 `geographic-names-v3`；v3 档案保留已经写入的名称。v1/v2 以及缺少地名阶段的档案仍然拒绝。

## 文档维护边界

本页只在权威数据形状、单位、身份、所有权、发布/校验或档案兼容规则变化时更新。具体 Stage 算法变化若不改变数据契约，不需要修改本页；阶段细节仅在其契约发生变化时更新 [契约参考](WORLD_DATA_CONTRACTS_REFERENCE.md) 的对应部分。
