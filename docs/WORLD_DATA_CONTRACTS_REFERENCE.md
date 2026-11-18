# 世界数据与生成产物契约参考（历史快照）

> 原始契约文档在 2026-11-18 精简前的完整副本。阶段细节供追溯，冲突时以 [WORLD_DATA_CONTRACTS.md](WORLD_DATA_CONTRACTS.md) 和当前源码/测试为准。

> 更新：2026-11-18。本文件定义字段、单位、身份和所有权；生成调度见 [生成管线](GENERATION_PIPELINE.md)，算法设计见 [技术设计](TECHNICAL_DESIGN.md)。公开入口为 `@another-earth/world-data` 与 `@another-earth/world-core`。当前快照 Schema 为 3，GenerationArtifact 不等于已发布快照。

## 快照与身份

`WorldSnapshot` 包含 `schemaVersion / snapshotId / revision / time / metadata / planet / mesh / nature / civilization`。
`nature` 下五个状态始终齐备：`geology / geography / climate / hydrology / ecology`。生成过程中的不完整产物不能作为快照。

当前 Mesh、GeologyArtifact、基础 TerrainArtifact、初步 ClimateArtifact C0、I0/H0/L1 及 E0 各自仍为阶段产物；`createNaturalPipeline` 把水文与生态分支汇入同一生成结果。`assembleNaturalWorld` 从该结果复制并组装完整自然状态，验证后交由 `WorldStore.publish` 复制、完整校验并原子切换。调用者可提供已解析内容包并记录版本/哈希；当前 Web 无文明调试请求未选内容包，故签名对应空集。Web Controller 在地图场景安装成功后才提交候选。M1.5 新链路本次尚未运行自动化检查。

`ClimateArtifact` C0 来自 T0，是阶段产物。它存储同一输出 Mesh 上的 `temperatureC` 与 `precipitationMm`（各 12N、month-major）、年均温与年降水（各 N）、Köppen 亚型索引（N，0–31，0 为海洋），以及参考 Mesh ID、四季风、季风、洋流和暖度模型场。每箱占公转年的 1/12，月降水总量随公转周期缩放，区域年值从同一月序列聚合。C1 使用独立产物身份并重算分类。

`climate-c0-v21` 的 `geographicReference`（Uint32/N）供风采样，`oceanReference`（Int32/N）供洋流和暖度采样。`oceanReference` 取参考海洋格索引，沿最终 Mesh 的相连海水区域补齐近岸空格。值 `-1` 表示陆地或无可用参考源的水体，`sampleClimateCirculation` 对此返回 0，`queryClimateRegion.oceanCurrentAvailable` 区分缺测与实际近静止。风与洋流向量使用模型相对单位，暖度代理范围为 −1 到 1。v21 的温雨与依赖这些输入的分类可能变化，字段结构沿用 v12。旧 C0 产物由 Stage 缓存版本失效并重算。

`queryClimateRegion` 增加 `windSpeedMps: number` 与 `oceanSpeedMps: number | null`。`sampleClimateSpeedMps` 提供同口径的单项查询。两者用观测分带拟合的系数估计月平均向量大小，分别对应 10 米风速与表层流速。洋流缺测返回 `null`，有效零向量返回 0。原分量和暖度字段继续使用模型单位，速度估计仅在读取时派生。`extractMonthlyCirculation` 按同一标定系数提取输出网格上的月度环流场（`windEastMps`、`windNorthMps`、`oceanEastMps`、`oceanNorthMps`、`oceanWarmth` 与 `oceanAvailable`），由 `assembleNaturalWorld` 写入 Schema 3 可选字段 `nature.climate.circulation`；旧 Schema 3 档案缺少 `circulation` 时仍合法，`WorldMapReader.capabilities.hasCirculation` 为 `false`。 [环流速度标定](benchmarks/M1.2-circulation-speed.md)

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
| climate.annualMeanTemperatureC / annualPrecipitationMm | Float32 / N | °C / mm/年；须与月字段一致 | C0 年度聚合 |
| climate.koppenClass | Uint8 / N | 0 海洋，其余为 C0 Köppen 类索引 | C0 分类；与海陆一致 |
| climate.circulation?.windEastMps / windNorthMps | Float32 / 12N | m/s，有限实数，month-major | 新生成自然快照可选持久化；从 C0 四季锚点插值并标定 |
| climate.circulation?.oceanEastMps / oceanNorthMps / oceanWarmth | Float32 / 12N | m/s 与 [-1, 1] 暖度代理，month-major | 仅在 `oceanAvailable[r] === 1` 处允许非零；缺测或陆地强制存 0 |
| climate.circulation?.oceanAvailable | Uint8 / N | 0 陆地或缺测水体，1 具备洋流估算 | 区分 0 流速与缺测，陆地必须为 0 |
| hydrology.monthlySnowWaterEquivalentMm / monthlySnowfallMm / monthlySnowmeltMm | Float32 / 12N | mm，≥ 0；month-major | I0 单年冰雪近似 |
| hydrology.downstreamRegion | Int32 / N | 同网格区域索引，-1 出口；无环 | 已确认排水事实；水文重算后替换 |
| hydrology.annualRunoffMm | Float32 / N | mm/年，≥ 0 | 已确认径流；不是河流流量 |
| hydrology.annualRunoffVolumeM3 / accumulatedAnnualFlowM3s / contributingAreaKm2 | Float64 / N | m³/年、m³/s、km²，≥ 0 | H0 局地产流、汇流与汇水面积 |
| hydrology.basinIndex / riverIndex / lakeIndex | Int32 / N | 表索引或 -1；海洋流域索引为 -1 | H0/L1 归属；同 Mesh 重建 |
| hydrology.basins / rivers / lakes | 实体表 | 稳定 ID、成员/出口/面积/流量/静态水位 | H0/L1；不表示动态湖水量 |
| ecology.*Index | Uint16 / N | 当前 biome/land-cover 字典索引 | 生态分类；换网格/字典显式重建 |
| ecology.aridityIndex / growingSeasonMonths | Float32 / Uint8，N | 无量纲非负 / 0–12 个等时长月箱 | E0 气候分类代理 |
| civilization.population | Float64 / N | 人数，≥ 0 | 区域人口权威总数 |

月气候固定为 12 个季节采样月，month-major：`month * N + region`，月份为 0..11。这是类地年内分箱，不隐含公转周期必须为 365 天；每箱占一个行星年的 1/12。没有混用日降水与月总量。

行星参数使用 km、24 小时的地球日、小时与角度。倾角范围 [0,180]；半径、自转和公转周期为有限正数。seaLevelDatumKm 相对物理参考球，地形高程再次相对该海平面。渲染半径不属于这个模型。潜在生态与实际覆盖分别存储；地图样式、GeoJSON、GPU 数据、算法诊断不进入快照。

## 所有权

WorldSnapshot 是 world-core 数据所有者使用的完整存储契约，readonly 属性防止替换引用，但 TypedArray 仍可被所有者写入。它不是 UI 可直接持有的查询对象。

1. 构建者独占工作数组；候选快照通过完整校验前不能发布。
2. `WorldStore.publish` 对候选做结构化复制、拒绝共享 Buffer、完整校验后一次替换当前快照；调用者保留的候选或阶段产物引用不能改写已发布事实。Worker 的独立候选 Buffer 在传输后失效，不复用已转移数组；阶段缓存继续持有其原数组。
3. 消费者通过 `createFieldView` 读取字段。该函数零拷贝，返回冻结的小型包装对象，仅暴露 meshId、length 和带边界检查的 get，不暴露数组/Buffer。网格的原始数组也只能留在核心所有者中；未来 Query 按需提供坐标读取。
4. 已发布数组不可原地修改、detach 或 transfer。变更必须构建下一份候选状态，重新校验并整体切换。可共享且承诺不修改的数组可跨 revision 复用。不通过冻结 TypedArray 或无条件深拷贝实现不可变性。

`WorldStore` 提供全部当前 Dense Field、区域、流域、河段、静态湖泊及球面拾取的只读查询，不返回权威 TypedArray/Buffer，并通过 `WorldStore.mapReader()` 返回绑定当前已发布快照的实例级只读 `WorldMapReader`（公开工厂为 `createWorldMapReader`）。`WorldMapReader` 在不膨胀快照存储的前提下惰性重建球面对偶 Voronoi 边界角点/边拓扑（`MapMeshReader`）、邻域贪心爬山定位 `locateRegion`（`WorldStore.pick` 同步复用该路径）、物理坡度 `slopeDeg`、地形晕渲 `hillshade` 与基于快照 Seed 的确定性多尺度卫星微纹理 `surfaceDetail`，保证新生成与档案恢复的地图数据 100% 同源且零可变 Buffer 泄漏。同一 worldId 的再次发布须使用新 snapshotId 和递增 revision；恢复档案可显式切换至存档状态。`FieldView` 仅提供边界检查的逐项读取；旧视图可以继续读取旧的不可变发布版本。

## 内容与验证

内容 ID 为 `namespace:domain/name`，与 displayNameKey 分离。ContentPack 包含内容模板、版本/哈希/依赖清单以及 locale → 翻译键 → 文本。每个声明的语言必须覆盖该包显示键。`loadBuiltinCatalog()` 提供 `core`、`earthlike`、两份风格-语言档案及民族／种族、文化、国家形态各自中英文版本的六份社会候选包；所有内容包使用当前 ContentPack v1 契约，包含 `namingStyles`、`peoples` 与 `states` 数组。`loadBuiltinGenerationCatalog()` 仍只提供自然生成所用的 `core`、`earthlike` 和默认 `western-zh-CN` 档案。旧 `geography` / `geography-zh` 内容包已从当前 Catalog 移除，不再用于历史世界档案恢复。`@another-earth/world-core` 不依赖 `world-data`，只接收结构化的 `ContentPackView` 和调用方实现的 `ContentPort`（包哈希、集合签名、风格签名、包校验）。当前只有 M2 的静态社会内容候选，尚未接入文明生成。

`validateContentPack(pack, resolvedDependencies)` 检查 ID、重复项、翻译、数值、名称池引用和显式依赖。M0 依赖使用精确版本。`createContentCatalog()` 会复制、校验并冻结已解析内容，验证每包的 `contentHash`，按包 ID 排序计算 `contentSignature`。当前哈希格式为 `fnv1a32`，用于确定性版本身份和意外篡改检测，不作为抗恶意碰撞的安全摘要。

`validateWorldSnapshot(snapshot, resolvedPacks, content, options)` 返回 `{valid, issues: [{code,path,message}]}`。`content` 是 `ContentPort`；哈希、签名和包校验都走该端口，不在 `world-core` 再实现一套。完整模式为默认值，遍历字段及图，检查月/年气候、积雪收支、径流深与体积、流域汇总、河段路由、湖泊成员/溢流、人口约束等；时间 O(N+E+实体/分组数)，需要 O(N+E) 临时图索引，错误最多报告 100 条世界问题。`structure` 检查长度、类型、元数据和实体引用，但跳过 dense 数值、图遍历和人口守恒，不能用于发布或存档验收。不能因 UI 状态变化重复调用完整校验。

两个校验器接收已经解码的类型化内存对象，不是任意 JSON 的安全解析器。`encodeWorldArchive(snapshot, packs, content)` / `decodeWorldArchive(archive, packs, content)` 提供 M0 版本化 JSON 往返，保存 TypedArray 类型并校验完整快照、内容版本和校验和；`content` 同为 `ContentPort`。解码失败不返回候选世界。当前 envelope 格式仍是 `another-earth-m0-json` v1，内部世界须为 Schema 3。旧 Schema 1/2 无迁移器，解码时拒绝，不能凭空填充缺失自然事实。针对 Schema 3 水文生成配置，解码器会为缺失的旧版参数补历史默认值 `riverDensityMultiplier = 1` 与 `minimumLakeAreaKm2 = 0`；这只补参数元数据，不改已保存河流/湖泊事实。新生成配置的河网倍率默认值现为 `0.5`。`WorldStore.restore` 只在解码与完整校验成功后替换当前世界。它不是 M4 的 `.aearth` 二进制格式、浏览器持久存储或 UI 导入流程。未引入通用 Schema 引擎。

## 名称配置与模板生成（2026-11-18）

命名配置是一个不可拆分的“风格-语言”档案，JSON 类型为 `NamingStyle`，格式标识为 `another-earth/naming-style`，`schemaVersion: 2`。它与 `ContentPack.manifest.schemaVersion`、档案内容 `version` 和命名算法版本分别管理。

- `style` 是命名规则传统标识（如 `western`），`language` 是名称文本使用的 BCP 47 语言标签（如 `zh-CN`、`en`）。它们共同确定一个完整档案；每份档案的词库与模板自包含，不跨语言或风格拼接。
- `id` 使用 `namespace:naming-style/<style>-<language-lowercase>`，例如 `builtin:naming-style/western-zh-cn`；`version` 使用内容包相同的版本格式。文化引用这个完整档案 ID。
- `displayName` 是档案标签的 locale → 文本映射，与 `language`（生成名称的语言）不同；可选 `author`、`source` 为非空说明文本。
- `pools` 是局部 ID → `{ value, weight }[]`，`rules` 是规则类别 → `{ weight, parts }[]`。局部 ID 使用小写字母开头的小写字母、数字和连字符。
- `parts` 的每项严格为 `{ pool: "局部词库ID" }` 或 `{ literal: "固定文本" }`。例如中式人名用 family + given，西式人名用 given + literal 空格 + family；完整候选名用一个 pool 片段表达。
- 权重是有限非负数，候选集合的总权重必须有限且大于零，零权重候选不被抽中。词库、规则集合、候选数组及模板 parts 不能为空；词库值不可全空白，每个模板必须能生成非空名称。固定文本按原样保留，包括空格。
- 拒绝未知字段、错误类型、缺失词库引用、递归规则和跨风格引用。对象键顺序不影响签名；条目、模板和 parts 的数组顺序属于语义，导出时保留。

`world-data` 提供 `parseNamingStyle(unknown)` 和 `decodeNamingStyleJson(string)`，返回 `{ valid: true, value, issues: [] }` 或 `{ valid: false, issues }`。成功值是独立副本。`encodeNamingStyleJson(profile)` 先校验，再输出稳定对象键顺序的可读 JSON；`createNamingStylePack(profile)` 将一个风格-语言档案转为一个 v2 内容包，包 ID 等于档案 ID，包版本等于档案版本，翻译键由适配器生成。`loadBuiltinNamingStyles()` 当前返回 `western-zh-CN` 与 `western-en` 两份档案，文件在 `packages/world-data/data/name-styles/`；Web 默认选用 `western-zh-CN` 生成大陆和大洋名称。应用可按 `profile.language` 选择可用于当前 UI 语言的档案。姓名、聚落及地理词库仍为小型示例，不代表完整语言词库。

当前 ContentPack 统一为 `ContentPackV1`，完整包含 `names`、`namingStyles`、`cultures`、`peoples`、`states`、宗教、旧政府定义、资源、预设与翻译。文化统一通过 `namingStyleId` 引用风格；peoples 与 states 是当前内容候选契约的一部分。未发布阶段不保留 v1–v4 历史投影或旧 `namePoolId` 文化结构；结构仍在调试时维持 schemaVersion 1，内容变更只重算 `contentHash`。`PeopleArchetype` 保存 ID、显示键、可选描述和标签，不保存生物属性或民族人口；两种题材共用这一候选定义，未来 M2 生成时仍需决定它如何对应世界中的物种或历史族群。`StateArchetype` 是国家层面的可复用候选原型，包含政治形态、政府组织形式、国家元首／政府首脑／立法机关称谓、继任方式与权重，不是已生成的 `Polity`。当前 `Polity.governmentArchetypeId` 到 `StateArchetype` 的映射留待 M2 设计；`GovernmentArchetype`、`governments` 数组和 `core:government/council` 仍是当前通用内容契约的一部分，不表示 state 作者包使用旧政府候选。`ContentDefinition` 的可选 `description` 参与哈希。风格文档自带 `displayName`，不同于其他内容定义的 `displayNameKey`；生成包的 manifest 显示键仍遵守翻译覆盖要求。

民族／种族、文化、国家形态各有一份英文 JSON 和一份中文 JSON；国家形态各包含 20 个对应候选。六份文件都是完整、自包含的语言包：各自包含领域定义、`language`、包名、每个候选的本地化名称与描述，以及显式依赖；JSON 中不放 `translations`，也不要求加载或组合另一语言文件。包 ID 与定义 ID 均包含语言后缀，因此同一 Catalog 可同时装入中英文版本而不发生 ID 冲突。文化英文包依赖 `western-en` 1.1.0，中文包依赖 `western-zh-CN` 1.4.0；文化引用相同语言的命名档案。此依赖是现有 v2 文化的必填契约，不表示当前已生成姓名或文化实体。民族／种族候选不固定绑定文化。社会包仅在完整 Catalog 中供将来选择，不进入当前自然世界生成所记录的内容集。

### 社会内容包 JSON

每份作者文档使用 `format: "another-earth/society-pack"`、`schemaVersion: 1`，并包含语言限定的包 `id`、`version`、`language`、直接写入的包 `displayName`、显式精确版本 `dependencies`，以及一个非空的 `peoples`、`cultures` 或 `states` 数组。每条定义直接包含 `displayName` 和必填 `description`；不写 `displayNameKey` 或 `translations`。导入适配器根据 ID 生成稳定的内部显示键和运行时翻译表，描述保留在定义对象中并参与内容哈希。文档不包含计算所得的 `contentHash` 或其他领域的空数组。作者格式与生成的 ContentPack 共用 schemaVersion 1，二者仍由各自的 `format` 与结构定义区分。`states` 定义另需 `politicalForm`、`governmentOrganization`、`headOfStateTitle`、可空的 `headOfGovernmentTitle` / `legislatureTitle`、`succession` 和非负 `weight`；其内部内容 ID 使用 `state` 域。文化文档示例：

```json
{
  "format": "another-earth/society-pack",
  "schemaVersion": 1,
  "id": "example-cultures-en",
  "version": "1.0.0",
  "language": "en",
  "displayName": "Cultures",
  "dependencies": [{ "id": "builtin:naming-style/western-en", "version": "1.1.0" }],
  "cultures": [{
    "id": "example:culture/river-valley-en",
    "displayName": "River Valley Settlers",
    "description": "A settled way of life organized around fertile floodplains, irrigation, and exchange between river communities.",
    "tags": [],
    "traits": [],
    "namingStyleId": "builtin:naming-style/western-en"
  }]
}
```

中文文件采用相同结构，将 `language`、名称与描述写成中文，并为包及定义 ID 使用 `-zh-cn` 后缀。各文件可单独导入、导出，不通过语言间继承或合并共享定义。

`parseSocietyPack(unknown)` / `decodeSocietyPackJson(text)` 从任意输入解析完整语言文档，验证语言身份、名称、描述、定义结构与字段路径错误，并返回独立副本。`encodeSocietyPackJson(document)` 校验后稳定排序对象键、保留数组顺序并输出换行。`createSocietyPack(document, resolvedDependencies)` 将一份文档适配为完整 ContentPack、生成运行时显示翻译、计算哈希并校验精确依赖；`societyPackDocumentFromPack(pack, resolvedDependencies)` 可反向导出可无损表示的单语言包。导入时调用方显式提供依赖包，再与其他包一起调用 `createContentCatalog()`；没有自动下载或默认绑定。这里实现的是 `world-data` 的 JSON 编解码；浏览器文件界面尚未接入。

多个配置通过 `createContentCatalog(styles.map(createNamingStylePack))` 组合。全局风格 ID 与其他内容 ID 一样必须唯一，冲突报错；风格内部可使用同名局部 pool。文化可引用本包或直接声明且精确版本匹配的依赖包中的风格，多个文化可以引用同一个风格。不按导入顺序覆盖或追加词库。当前 v1 哈希固定包含包的全部字段，包括完整风格内容、peoples 与 states；调试阶段内容变化通过重算哈希反映，不递增 schemaVersion。`ContentPack` 当前是单一形状，调用方无需按 schema 版本收窄。

`calculateNamingStyleSignature(profile)` 的身份包含结构版本、档案 ID、`style`、`language`、内容版本、pools 和 rules，排除显示名称、作者与来源说明。该签名仍使用现有 `fnv1a32` 摘要，不是安全签名；修改内容必须重新计算。调用方应在解析/组合阶段计算并保存签名，不应为每个实体重复解析和哈希整个配置。

`world-core` 通过 `NamingStyleView` 消费内容，公开 `generateName({ style, styleSignature, worldSeed, entityId, rule })`，算法版本为 `naming-v1`。随机流身份依次包含算法版本、标准化 Seed、对象稳定 ID、风格 ID、风格版本、生成签名及规则类别。先抽一次模板，再按顺序为每个 pool 片段抽一次，即使只有一个候选也消耗一次随机值；literal 不抽样。不同对象的调用顺序不会相互影响，未使用风格不进入随机身份。解释器不解析 JSON、不访问 DOM、不依赖 world-data，也不隐式重抽或去重；去重范围与消歧规则由具体领域调用方确定。

最小调用示例（应用层仅通过包公开 API 消费）：

```ts
import { generateName } from '@another-earth/world-core'
import { calculateNamingStyleSignature, createContentCatalog, createNamingStylePack, loadBuiltinNamingStyles } from '@another-earth/world-data'

const styles = loadBuiltinNamingStyles()
const catalog = createContentCatalog(styles.map(createNamingStylePack))
const pack = catalog.get(styles[0].id)!
if ('namingStyles' in pack) {
  const style = pack.namingStyles[0]
  const name = generateName({
    style,
    styleSignature: calculateNamingStyleSignature(style),
    worldSeed: '1024',
    entityId: 'person:1',
    rule: 'person',
  })
  // name 是候选名称；领域调用方决定如何确认和保存它。
}
```

Web 自然世界的大陆、大洋名称使用 `geographic-names-v3` 和 `western-zh-CN` 风格-语言档案；阶段与快照记录完整档案 `nameStyleId` / `nameStyleSignature`。发布校验从世界记录的内容包解析该风格，并通过 `ContentPort` 重算风格签名；世界整体 `metadata.contentSignature` 仍独立验证内容包集合。完整快照必须具有 v3 地名阶段；旧 v1/v2 地名阶段和缺少地名阶段的历史世界档案均拒绝恢复。当前 v3 档案仍支持正常编解码往返，已保存名称作为世界事实，不会重新抽取。当前没有人物/聚落/文明实体生成、浏览器配置管理或文件按钮；Worker 自定义内容传递、按文化运行的命名流程、档案正文嵌入和自定义内容分享仍待实现。本次兼容清理后已运行 world-data、world-core、Web 与 cartography 测试：43、195、29、22 项通过；未运行 typecheck、lint、build 或浏览器验证。

## 与技术设计示例的细化

- 世界身份和生成来源元数据集中于 metadata；snapshotId/revision/schemaVersion 保持快照级。
- seed 使用字符串保存调用者的原始输入，避免隐式数字转换和安全整数损失。
- 采用 MeshTopology、PlanetParameters、NatureState 命名，分别明确拓扑、物理输入与已确认自然状态。
- 当前 generationConfig 包含行星、Mesh、参考网格、地质、地貌、地形、气候、水文参数、区域数和文明开关；provenance 记录完整自然 DAG 各 Stage 的版本与输入签名。
- H0/L1 的流域、河段与静态湖泊在 M1.5 组装为已确认自然状态；湖泊水位仍是 Priority Flood 几何近似，完整水量收支没有实现。


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

`geographic-regions-v3` 独立依赖 Mesh、Geology 与最终 T0；`continentIndex`、`oceanIndex`、`seaIndex` 均为 N 长 Int32，-1 表示不属于该类。每个陆地网格恰归一个大陆，每个水域网格恰归一个洋或海。大陆从最终陆地连通块出发，每块按面积占优的候选大陆来源归并。海水到最终海岸的球面路径距离定义宽阔核心；在 `max(2 × 平均网格宽度, 0.03 × 行星半径)` 的海岸带外相连的水格构成同一核心，沿岸水格沿海水路径归入最近核心。最大连通水体的最大宽阔核心归洋；其他核心同时满足最大离岸距离不低于全球最大值 50%、核心面积不低于全部核心面积 8% 时归洋，其余归海。v3 再在每个已划洋区内找离岸距离局部峰值：候选峰值不低于该区最大值 45%，且与既有远海中心间最宽海水路径的最窄离岸距离低于候选峰值的 55%，才成为独立洋种子；海水最短路径给各洋分区，面积小于原洋区 8% 的碎区并回。全水世界为一个洋；没有宽阔核心的水体归海。洋/海边界及洋间分界为初步形态规则，不等同于气候洋流区或传统海域名称，阈值需要固定 Seed 与不同网格等级校准。区域表保存稳定 ID 和面积；改变 Mesh 或最终海岸线须重建归属。新完整自然世界将这些字段置于可选的 `nature.geography.regions`；缺失该对象的旧 Schema 3 档案保持未划分，v1 档案缺少 `seaIndex` / `seas` 时按旧数据读取，v2 档案保留原来单洋事实。`WorldStore.region` 返回 `continentId` / `oceanId` / `seaId`，并提供 `continent(id)` / `ocean(id)` / `sea(id)` 只读摘要。v3 纯分区产物不包含地名。

历史实现记录：`geographic-names-v1` 曾以大陆和大洋的稳定 ID 为对象，使用 `world-data` 内置名称词库、世界 Seed 和内容签名确定性选名；同类重名采用稳定后缀消歧，海不命名。命名结果曾作为可选 `name` 存于 `nature.geography.regions.continents` / `oceans`，并记录 `nameContentSignature`。此版本及缺少地名阶段的旧快照现均不再通过当前快照校验。`WorldStore.region` 另返回 `continentName` / `oceanName`，区域摘要也包含名称；图例与区域检查器读取快照名称。名称为原始专名，界面加中文类型后缀；译名和作者覆盖尚未实现，地图表面文字标签见下方现状。v1 当时新增独立 `geography` 1.0.0 内容包，原有 `core` / `earthlike` 版本与哈希保持不变；当时新世界记录三个内容包。该历史包和旧快照解析能力现已移除。

历史实现记录：`geographic-names-v2` 曾选用 `geography-zh` 1.0.0 内容包的中文专名，同类重名后缀为中文序号；阶段以 `geographic-name-pools` 注入词库，并可能记录 `namePoolIds`。该阶段版本、旧 `geography` / `geography-zh` 内容包及对应的历史档案恢复兼容均已移除。

`ecology-e0` 算法版本仍是 `ecology-e0-v3`。分类代码留在 `world-core`；调用方以内容键 `ecology-classes` 传入生物群系与土地覆盖的 `{ id, code, nameZh }` 词表。阶段用 `ecologyVocabularySignature` 重算签名（对 `['biome'|'land-cover', id, code]` 行做 FNV-1a 32，前缀 `ecology-classes:`），与传入签名不一致则拒绝执行。快照字段不变。阶段 `validate` 仍只做结构检查，因为它看不到注入内容；生成函数自身检查产物 ID 与词表一致。

地图标注使用 `@another-earth/cartography` 公开的 `buildGeographicLabelAnchors(mesh, regions)`，读取 Mesh 中心、面积和已命名分区的成员索引，返回大陆/洋各区域的稳定 ID、名称、面积与落在所属区域内的单位球面位置。Web 将名称格式化为显示文字并投影到视口；遮挡、重叠避让与专题图层开关均只改变显示，不回写 `WorldSnapshot`，也不参与 Stage 签名。无名称的旧分区不产生标签，海目前不产生标签。

当前为 `terrain-skeleton-v10` / `terrain-v27`。`TerrainArtifact` 仍是独立阶段产物，带 meshId、算法版本、物理半径与海平面基准；没有自然世界发布或水文事实。v25 的海底骨架与塑形坐标→km 曲线已重标定；v26 增加卫星渲染需要的表面纹理字段；v27 在末端小水体闭合后对新抬升的近岸封闭洼地沿最低溢流路径破口排海，不改动无关的内陆盆地。

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
| erosionCoordinate / depositionCoordinate | Float32 / 非负塑形坐标 | 记录参考处理器产生的侵蚀/沉积塑形坐标差，不能直接与物理 km 高程相加 |
| foldBelt | Float32 / 相对分类量 | 褶皱带诊断 |
| surfaceTexture? | 5 × Float32 / 无量纲 | tectonicBand、detail、coastal、uniformLand、postDetail；仅供显示配色，不属于地形事实或 WorldSnapshot |

统计包含面积加权的陆地覆盖率和最大连通分量面积、海陆变化数、连通分量数、最低/最高高程，以及按区域排序而非面积加权的五个高程分位数。坡度为相邻中心最大物理高差/物理距离的 atan。

`landMask[r] === (elevationKm[r] > 0 ? 1 : 0)`，以写入 Float32 后的值为准；非零 seaLevelDatumKm 可以改变最终海陆。物理径向位置必须始终为正。最终数组无 NaN/Infinity，引用和长度经核心与主线程校验。

内部塑形坐标不会因类型同为 Float32 就自动具有 km 单位。海底 `x≥-0.6` 输出 `8x` km，`x<-0.6` 在此基础上增加连续、最多趋近 6 km 的海沟深度；陆地 `0–1` 使用单调 Hermite 锚点 `(0,0)/(0.2,0.37)/(0.4,0.92)/(0.65,2.5)/(0.85,4.5)/(0.9,5.1)/(1,7.7)`（坐标、km），超过 1 从 7.7 km 按每单位 18 km 延伸，最后减海平面基准。诊断贡献不能非线性换算后冒充可精确相加的物理分量。

当前 `terrain-v27` 在 T0 的内部塑形坐标中执行与 v25 相同的基础水力/冰川侵蚀。水力处理器输入为 `terrain.hydraulicErosion × 0.5`，冰川处理器输入保持 `terrain.glacialErosion`。最终塑形后按负高程连通分量清理小于四个 L5 区域等效面积的水体，并对此次闭合形成的封闭洼地向公海最低鞍部下切破口、补齐单调顺坡，改变量一并记入 `topologyDelta`，不计入沉积物账本。`erosionCoordinate`/`depositionCoordinate` 为 N 长 Float32，记录参考处理器生成的侵蚀/沉积坐标差；它们不能直接与物理 km 高程相加。`regionalUpliftCoordinate`、`regionalReliefKm` 全零，`roughnessWeight` 全一，为旧诊断兼容值。侵蚀不读取气候/降雨，也不构造正式河网。`surfaceTexture` 保存五个由原 T0 纹理生成器计算的显示字段；它们随 TerrainArtifact 传输，检查长度和有限值，但不进入查询接口、WorldSnapshot 或世界事实校验。

`TerrainParameters` 包含 roughness、terrainWarp、smoothing、ridgeSharpening、glacialErosion 与 hydraulicErosion；两项侵蚀强度范围 [0,1]，默认各 0.5，进入 T0 签名。旧键 continentalUpliftKm 仍在规划/执行、全缓存命中前拒绝。T0 算法版本变化与 Schema 3 升级是独立事件。

`queryTerrainRegion` 只返回冻结标量对象。Pipeline getOutput 是共享借用，不能修改或 Transfer；Web 只接收独立副本。完整自然快照生成后，正式视图应使用 `WorldStore` 只读世界查询，不能直接持有权威 Buffer。

## 初步冰雪与水文产物 I0/H0

M1.3A/B 新增 `CryosphereArtifact`（`cryosphere-i0-v1`）、`HydrologyArtifact`（当前 `hydrology-h0-v4`；历史初版为 v1/v2/v3）和 `StaticLakeArtifact`（当前 `static-lakes-l1-v10`；早期版本按面积过滤，v6 曾对 Köppen B 占多数的洼地做年入流与土壤蒸散系数比较，v7 增加水深与气候筛选，v9 起将平均水深门槛降到 1 m，v10 移除海岸闭合抬升面特判并改由 T0 破口排海）。单独生成时仍是阶段产物；完整自然请求将它们装入 Schema 3 `HydrologyState`。I0/H0 要求各自输入 Mesh 身份一致，月数据为 month-major 的 `12N`；L1 直接依赖 Mesh、T0、C0 和 H0。H0 在 Köppen BW 沙漠气候区只保留由非沙漠区来水占多数的河道；BS 半干旱区仍按气候驱动产流。L1 排除平均水深不足 1 m 的填洼薄膜、最暖月低于 0°C 占一半及以上的冰原洼地，以及 Köppen BW 占一半及以上的荒漠洼地；其余候选要求湖面年降水大于与 E0 相同的温度指数潜在蒸散。生成配置中，`riverDensityMultiplier` 按倍率缩放汇水面积门槛（当前默认 0.5，使门槛高于旧默认）；`minimumLakeAreaKm2` 再过滤较小湖泊候选（默认 0 保留两区域门槛）；前者影响 H0，后者影响 L1。公转周期进入 L1 签名，土壤蒸散系数不再进入。它们仍是简化气候筛选，不是季节河或湖泊动态水量模拟。这些 Stage 不写入、不修改最终地形或海陆掩码。

| 产物字段 | 类型/单位 | 语义 |
| --- | --- | --- |
| `monthlySnowWaterEquivalentMm` | Float32 / mm | 每月末积雪储量；当前不表示多年冰川体积 |
| `monthlySnowfallMm` / `monthlySnowmeltMm` | Float32 / mm/月 | 雪水账本输入与融雪输出 |
| `monthlyEvapotranspirationMm` / `monthlyRunoffMm` | Float32 / mm/月 | H0 温度指数蒸散与地表径流近似 |
| `annualRunoffMm` | Float32 / mm/年 | 区域局地产流深度，12 月值之和 |
| `annualRunoffVolumeM3` | Float64 / m³/年 | 区域局地产流体积：深度 × `areaKm2` × 1000 |
| `accumulatedAnnualFlowM3s` | Float64 / m³/s | 下游汇流累积后按行星公转周期换算的平均流量 |
| `contributingAreaKm2` | Float64 / km² | 上游陆地区域面积累积 |
| `downstreamRegion` | Int32 / 区域索引 | 同网格相邻接收区；海洋出口/无海洋时的内流汇点为 -1 |
| `filledElevationKm` | Float32 / km | Priority Flood 的路由辅助面，不改变 `TerrainArtifact.elevationKm` |
| `basinIndex` / `riverIndex` | Int32 / 表索引 | 同产物表引用；海洋/非河道为 -1 |
| `riverMask` | Uint8 / 0 或 1 | 满足经河网密度倍率缩放后的汇水面积阈值、正累计流量；Köppen BW 沙漠区还要求非沙漠源区来水不少于沙漠源区来水 |

L1 静态湖泊字段：

| 产物字段 | 类型/单位 | 语义 |
| --- | --- | --- |
| `lakeIndex` | Int32 / 表索引，-1 为非湖泊 | 区域到湖泊摘要的归属；独立于海陆掩码和 H0 `basinIndex` |
| `lakes[].regions` | Uint32 / 区域索引 | 湖泊成员，按索引升序且在 Mesh 上连通 |
| `lakes[].areaKm2` | number / km² | 成员 `mesh.areaKm2` 之和 |
| `lakes[].waterLevelKm` | number / km | 静态溢流水位代理；成员地形必须低于水位 |
| `lakes[].basinId` | 稳定 ID | 指向 H0 汇水终止盆地 |
| `lakes[].spillRegion` / `downstreamRegion` | 区域索引或 null | 湖内溢流边界区及其 H0 即时下游；终止内流无出口时为 null |
| `lakes[].endorheic` | boolean | 当前继承 H0 内流终止盆地语义，不代表气候性内流平衡 |

L1 v4 只保留至少包含两个 Mesh 区域的连通洼地组件（`minimumLakeRegionCount = 2`），因此剔除单格湖泊且不依赖固定物理面积。水位来自 H0 Priority Flood 填洼面，不是湖泊水量平衡或逐月状态。

当前雨雪线性转化在 `snowTemperatureMinC` 与 `snowTemperatureMaxC` 之间插值；融雪、蒸散均为显式温度指数系数。年初积雪假定为零，只模拟单个公转周期的月序列；不称为冰川稳态或地球尺度水文标定。产流守恒以降水输入 = 蒸散 + 径流 + 年末积雪储量为目标，受 Float32 月数组量化误差影响。

Priority Flood 使用输出 Mesh 邻接。所有海洋区为外流根；没有海洋区时，最低高程区域是唯一内流根。河流 ID 由 Mesh ID 和源区域组成，在相同 Mesh 与算法版本中确定；不承诺跨 Mesh/版本身份稳定。当前河道最低阈值为配置值与十六个平均 Mesh 区域面积的较大者，且要求有正流量。v2 相比 v1 将网格尺度底线从 8×提高到 16×；多分辨率校准记录见 `M1.3A-river-density-calibration.json`。

`HydrologyState` 在 Schema 3 中保存 I0 月度冰雪、H0 年径流/汇流/流域/河段，以及 L1 静态湖泊与成员索引。只有完整自然 DAG 组装并通过快照校验后，这些阶段结果才成为发布事实；单独的 H0/L1 调试请求仍只返回 GenerationArtifact。

## 生态产物 E0

`ecology-e0-v3` 是 M1.4 中间 `GenerationArtifact`，使用 C0 的月温/降水、已有年均温/年降水与 T0 高程/海陆掩码。纬度与南北半球按 Mesh 中心 Y 轴计算，与 C0 一致；v3 修正 v2 误用 Z 轴的分类错误，旧阶段缓存失效。DAG 直接依赖 Mesh、T0、C0；不依赖 I0/H0/L1。所有陆地区域均按气候和地形分类，包括另由 L1 标记为湖泊成员、或另由 H0 标记为河道的区域；这些水文掩码不改写 E0 类别。当前 T0/C0 初步模型的 E0 分类和查询链路已按 M1 范围验收；它仍不会自行组装或发布 WorldSnapshot。

`@another-earth/world-data` 导出 `NATURAL_BIOME_DEFINITIONS` 与 `NATURAL_LAND_COVER_DEFINITIONS`，数组索引仅是当前产物字典索引，稳定身份使用定义 ID。E0 保存同一 Mesh 上的 `potentialBiomeIndex` 与 `landCoverIndex`（Uint16/N）、无量纲 `aridityIndex`（Float32/N）、`growingSeasonMonths`（Uint8/N，0..12）以及字典 ID 和 Mesh/T0/C0 上游身份。年均温与年降水复用 C0，不在 E0 再保存一份。

海洋由 T0 海陆掩码单独编码；陆地潜在生物群系与较粗的自然覆盖分类分开。湖泊/河流不属于这两套 E0 词表，水文实体由 I0/H0/L1 独立表达。`SnowIce` 是年度气候分类代理，不表示多年冰川或永久冰盖。PET 使用迁移自 feat-society 只读参考的温度指数近似（`0.015 × 等分箱日数 × max(T + 5, 0)^1.45`），干旱和群系边界继承旧版启发式并适配 12 个等时长月份；尚无真实植被分布标定。无文明阶段不生成农田/城市。E0 产物现可随完整自然链进入 Schema 3；M1.5 新链路待运行检查，M1.6 仍待完成。当前 E0 专项证据见 [E0 收尾记录](benchmarks/M1.4-E0-closeout.md)。
