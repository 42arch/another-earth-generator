# Generation Pipeline 与 Worker

2026-11-18 大陆和大洋名称阶段为 `geographic-names-v4`，声明 `geographic-naming-style` 内容键，由调用方注入完整风格和其生成签名；阶段调用 `naming-v1` 模板解释器，按 Seed、区域稳定 ID、风格和对应规则生成首选名。大陆与大洋专名共用一个已用名集合，并按稳定 ID 顺序分配。首选名已被占用时，从该规则尚未使用的候选中确定性另选，不在名称后追加“二”等序号；候选不足时命名阶段失败。海保持无名。Web 从冻结内容目录中选择 `western-zh-CN` 风格-语言档案，其 `continent` / `ocean` 词库各有 48 个现代音译专名候选；另有同风格的 `western-en` 档案，应用可按语言选择。产物与快照记录 `nameStyleId` 和 `nameStyleSignature`；世界完整内容签名保持独立。阶段版本和风格签名进入缓存键，风格变化只使名称阶段失效；现有风格签名覆盖整个风格，所以人物等其他规则改变也会使地名重算。通用 Pipeline 依赖调用方确保内容正文和签名一致，包括缓存命中情况；Web 由同一冻结风格对象计算签名，发布快照时按记录内容包再次验证。快照校验接受 `geographic-names-v4` 与既有 `geographic-names-v3`。缺失地名阶段或 v1/v2 档案不再恢复；v3 档案仍按已保存名称往返，不会重抽。v4 只改变冲突时的选名：未冲突的首选名仍是同一条 `generateName` 抽取，冲突名不再使用序号后缀。未做固定 Seed 全图对照。修复 Check 时已通过 typecheck、lint、单元测试和 Web 生产构建；未运行 Playwright 浏览器测试。

历史记录（2026-11-13）：`geographic-regions-v3` 依赖 Mesh、Geology 和最终 Terrain，读取候选大陆来源与最终海陆掩码，无独立配置或随机流。阶段输出大陆、洋、海的区域索引和面积表；沿用 v2 的海岸距离/海峡收窄后的洋海等级，并在宽阔洋区内按离岸峰值间的通路收窄程度划分多个大洋，抑制小面积碎区。`geographic-names` 依赖该分区产物，阶段版本为纯 `geographic-names-v2`，不再把内容签名写进版本字符串，也不再调用 `loadBuiltinGenerationCatalog()`。它声明内容键 `geographic-name-pools`；调用方传入大陆/大洋 `NamePoolView`，并提供 `contentSignatures['geographic-name-pools']`。缓存键已经包含该签名，词库变化只使名称阶段失效。命名仍由 Seed、稳定区域 ID、词库 ID 和内容签名决定，同类重名使用中文序号；新产物写入 `namePoolIds`。`apps/web` 注入 `geography-zh` 中文词库。T0/海陆变化使分区与名称阶段重算，不使气候、水文和生态重算。Worker 传输带名称的独立副本，完整自然世界组装时复制入快照。旧 `geography` 词库保留供历史档案解析。`ecology-e0` 另声明内容键 `ecology-classes`，算法版本仍是 `ecology-e0-v3`；调用方传入生物群系与土地覆盖词表，签名必须等于 `ecologyVocabularySignature`。

> 更新：2026-11-23。记录当前执行与缓存契约，不表示完整 M1 延期事项或浏览器验收已完成。字段见 [世界数据契约](WORLD_DATA_CONTRACTS.md)，算法与后续设计见 [技术设计](TECHNICAL_DESIGN.md)和 [M1 实施计划](M1_IMPLEMENTATION_PLAN.md)。

## 公开入口

`@another-earth/world-core` 提供 `StageRegistry`、`GenerationPipeline`、`StageCache`、Mesh/Geology/Terrain/C0/Hydrology/Ecology Pipeline，以及 `createNaturalPipeline`、`createWorldPipeline`、`assembleWorld` 和 `WorldStore`。Hydrology Pipeline 在 T0/C0 上生成 I0、H0、L1；Ecology Pipeline 从独立的 T0/C0 分支生成 E0 `ecology-e0-v3`。Natural Pipeline 合并两支但保持 E0 的独立直接依赖；World Pipeline 在自然链之后串联 `resource-potential`、`habitability`、`population-settlements`、`transport-network`、`peoples-cultures`、`polities-religions`（调整 `civilization` 参数不会使自然 Stage 缓存失效）。只有完整结果经过装配与校验才可发布。E0 v3 的历史专项检查见 [E0 收尾记录](benchmarks/M1.4-E0-closeout.md)；M2 初版的历史全仓单测与构建结果见进度；当前 CIV-03 的验证范围见下方验收记录。

```ts
import { createTerrainPipeline, DEFAULT_GEOLOGY_PARAMETERS,
  DEFAULT_LANDFORM_PARAMETERS, DEFAULT_TERRAIN_PARAMETERS,
} from '@another-earth/world-core'
import type { TerrainArtifact } from '@another-earth/world-core'

const pipeline = createTerrainPipeline()
const input = { seed: '42', config: {
  planet: { physicalRadiusKm: 6371, seaLevelDatumKm: 0 },
  mesh: { subdivisionLevel: 4, irregularity: 0.75 },
  geology: DEFAULT_GEOLOGY_PARAMETERS,
  landforms: DEFAULT_LANDFORM_PARAMETERS,
  terrain: DEFAULT_TERRAIN_PARAMETERS,
} }
const plan = pipeline.plan(input)
const result = await pipeline.execute(input)
const terrain = result.getOutput<TerrainArtifact>('terrain') // 共享借用，不可修改或 Transfer
```

## 当前 Stage 与直接依赖

| Stage | 版本 | 直接依赖 |
| --- | --- | --- |
| mesh | 1 | 无 |
| reference-mesh | geology-v2 | 无 |
| reference-subdivisions | geology-v2 | reference-mesh |
| plate-topology | geology-v2 | reference-mesh、reference-subdivisions |
| continental-crust | geology-v2 | reference-mesh、plate-topology |
| geological-mapping | geology-v2 | mesh、reference-mesh |
| geology | geology-v2 | mesh、reference-mesh、geological-mapping、plate-topology、continental-crust |
| plate-dynamics | terrain-v2 | reference-mesh、plate-topology、continental-crust |
| tectonics | terrain-v2 | mesh、geology、plate-topology、continental-crust、plate-dynamics |
| tectonic-elevation | terrain-skeleton-v10 | mesh、geology、tectonics |
| terrain | terrain-v27 | mesh、geology、tectonics、tectonic-elevation |
| geographic-regions | geographic-regions-v3 | mesh、geology、terrain |
| geographic-names | geographic-names-v4 | geographic-regions；内容键 `geographic-naming-style` |
| climate-c0 | climate-c0-v22 | mesh、reference-mesh、geology、terrain |
| cryosphere-i0 | cryosphere-i0-v1 | mesh、terrain、climate-c0 |
| hydrology-h0 | hydrology-h0-v4 | mesh、terrain、climate-c0、cryosphere-i0 |
| static-lakes-l1 | static-lakes-l1-v10 | mesh、terrain、climate-c0、hydrology-h0 |
| ecology-e0 | ecology-e0-v3 | mesh、terrain、climate-c0；内容键 `ecology-classes` |
| resource-potential | resource-potential-v1 | mesh、geology、terrain、climate-c0、hydrology-h0、ecology-e0；内容键 `resource-definitions` |
| habitability | habitability-v4 | mesh、terrain、climate-c0、hydrology-h0、static-lakes-l1、ecology-e0、resource-potential |
| population-settlements | population-settlements-v5 | mesh、terrain、hydrology-h0、static-lakes-l1、resource-potential、habitability |
| transport-network | transport-network-v4 | mesh、terrain、hydrology-h0、static-lakes-l1、habitability、population-settlements |
| peoples-cultures | peoples-cultures-v4 | mesh、habitability、population-settlements、transport-network；内容键 `civilization-content` |
| polities-religions | polities-religions-v15 | mesh、terrain、hydrology-h0、static-lakes-l1、ecology-e0、resource-potential、habitability、population-settlements、transport-network、peoples-cultures；内容键 `civilization-content` |

`polities-religions-v4` 修正近岸领土补全：以原有已归属海岸为源，只沿海洋搜索，水面路径不超过参考面积平方根（约 112 km）时记录登岛点。海洋—海洋中心连线全长计入水程，海陆相邻连线按中点岸线估计，仅计一半；不把登岛后的陆地距离计入跨海门槛。随后全部登岛点同时沿原本无主的陆地（含湖泊格）扩张，不设岛内距离上限，按跨海加岛内距离的最小值划分，同成本由固定网格遍历顺序确定。已有归属保持不变；新接管的岛屿不再发起跨海搜索，避免岛链接力；海洋始终无主。仅政体宗教及其下游缓存失效，上游自然、人口、交通和文化可复用。该轮近岸算法不变；当时 Schema 7 拒绝旧版档案。近岸合成图回归已在本轮核心测试中通过；原 v3/v4 的固定 Seed 新旧算法对照与岛屿截图专项未补做；当前全链路高等级实测见 C 批。

文明社会尺度的参考面积取半径 6371 km 的 L6 等面积格（约 12,453 km²），对应旧版默认量级。人口仍由区域面积乘承载密度决定；聚落数量按可居住总面积换算参考格数。`population-settlements-v5` 在默认聚居倾向 0.5 时沿用选址分决定迁入比例（16%–56%）和搜索距离：目标人口为当地密度乘参考面积再乘该比例，只沿陆地由近到远征集，最远到支撑半径的两倍（约 126 km）乘分数占比。每个供体格子单次最多交出当前比例、累计最多交出 56%，因此不会被抽成无人区；凑不满则聚落按实际人数缩小，等级按结果人口划分。海岸上的海面不扣减目标。交通和文化传播使用该参考面积对应的固定基准行进速度；政体规模使用实际 km²。输出 Mesh 等级变化会使所有相关 Stage 随 Mesh 失效，但不再直接重设上述社会单位。当前已完成同 Seed L6/L7/L8 的三次冷启动统计与峰值实测，详见 C 批；自然形态随网格变化，尚无全参数跨等级不变性保证。

### 默认近代定居模型

`habitability-v4` 默认以约 1900 年的技术条件为参照，计算包含经济机会的定居适宜度。C 批预设仅填写能力与格局参数，不增加时代分支或产业演化。承载密度的全局尺度已按三 Seed / L5 样本拟合并经独立 L6 样本验证；其他权重仍是建模假设，不将英国工业化分布当作全球通用比例。

- 环境上限 `E = sqrt(T × W) × G × biomeFactor`。`T` 沿用年均温 −12/8/25/35°C 的分段舒适度，`G` 沿用坡度与海拔评分。冰盖为零，苔原/高山苔原系数 0.25；去掉临海荒漠的特殊减罚。淡水 `W` 取降水、河流和湖岸代理的最大值：降水为 `clamp(aridity/0.45) × clamp(年降水/600 mm)`，有河流时为 `clamp(log10(1+年均流量 m³/s)/5)`，湖岸为 0.85。海洋不提供淡水。
- 本地食物潜力 `L = clamp(农业 + 0.25 × 渔业)`；环境上限为零的格子不提供食物。林业不直接作为食物。对食物、矿产、能源分别进行多源陆地传播，潜力沿路径按 `距离 km × 平均通行阻力 / R` 递减，取可达来源中的最大值，不能跨海；湖泊格允许通行但不产粮、不居住。`R = 2 × sqrt(参考面积) × landTransportCapability`，基准 1× 时约 223 km，表示满潜力来源在阻力 1 路径上的衰减范围，弱来源更短。这里得到的是供给可达潜力 `F`，不代表运输流量或可重复分配的粮食总量。
- 矿产 `M`、能源 `C` 以已保存矿点的类别和丰富度为源，不使用快照未保存的综合地质潜力场。木材作为有限燃料替代 `B = max(C, 0.25 × 林业)`；资源机会为 `I = 0.35 × max(M,C × industrialCapability) + 0.65 × sqrt(M × B) × industrialCapability`。矿点不代表已投产矿山，不模拟矿种工艺、储量耗竭或开采深度。
- 港口代理 `P = 平缓度 × W × (1−海洋邻居占比)`，仅海岸有效，反映粗略遮蔽；没有港湾水深或风浪模型。`P >= 0.5` 且定居分不低于 0.14 才标记港口。通达潜力 `A = 0.45 × 平缓度 + 0.4 × 河流供水代理 + 0.15 × P`，不读取后续生成的道路、航线或铁路。
- 经济机会 `O = clamp(I × F × A)`。最终定居分 `H = clamp(E × (0.5 + 0.25F + 0.15O + 0.1A))`；环境限制不能被矿产加分抵消。`H > 0.01` 时承载密度为 `E × (22 × max(0, L + 农业潜力 × (agriculturalProductivity−1)) + 7F × O)` 人/km²，反映本地生产与有供给条件的工业聚集，没有海岸固定奖励。不是完整的粮食贸易守恒模型。
- `population-settlements-v5` 沿用选址分 `0.9H + 汇流点加分0.06 + [0,0.04)确定性扰动`，满分基准为 1；取消港口、河口、农业、矿产、渔业和坡度的重复独立加分。全球数量目标及间距策略暂保留，不预设沿海/内陆配额。

版本变化使宜居性、人口聚落及下游交通/文化/政体宗教缓存失效，自然和资源链仍可复用。新增 `environmentalSuitability`、`economicOpportunity`、`portPotential` 为阶段字段，不作为快照权威字段保存；公开生成函数输入相应扩展，详见 [世界数据契约](WORLD_DATA_CONTRACTS.md)。最初新增的 9 项合成输入回归及聚落用例已在 A/B 批测试中通过。C 批补充密度范围回归、历史尺度校准与高等级实测，见下方；更早 v2/v3 和交通 v3/v4 的算法对照未补做。年均温与年流量不能代表季节极端或枯水保障，港口代理、市场范围和供给潜力仍需专项校准。

CIV-01 A 批的生产/运输能力使用 `CivilizationParameters.capabilities`，范围与默认值见 [世界数据契约](WORLD_DATA_CONTRACTS.md)。所有输入先由统一解析器补全并严格校验，再进入 Stage 签名；显式能力 1× 与省略能力必须得到相同签名。`habitability-v4` 只读取农业、工业和陆运能力；航海能力不影响先于实际交通生成的供给模型。`transport-network-v4` 读取陆运/航海能力，速度分别为基准 km/day 乘对应能力；陆路、海路及可达性行程预算保持基准值固定，不随速度缩放。航海 0× 跳过海路搜索。默认 1× 使用经人口尺度校准的承载系数，能力极值仍不能绕过淡水和地形约束。

只改航海能力时，从交通向下失效，宜居性/人口缓存复用；农业、工业或陆运变化从宜居性向下失效；自然与资源链可复用。Stage 不读取预设名称或不属于自己的配置键，模型不反向依赖后续道路与航线。完整有效配置保存于 Schema 7 元数据，地图查询使用同一配置和 Planet 物理半径；分享链接为 v12。新增参数解析、能力效果、缓存失效、档案恢复查询与 Worker/分享回归；A 批最初交付时尚未运行检查；本轮已完成核心与 Web 测试、类型和构建验证，随后 B 批完成全仓验证与参数组合对照。原 v2/v3 宜居性、交通 v3/v4 的新旧版本对照未补做；当前 v4 的校准与高等级性能见 C 批记录，浏览器结果见进度记录。

CIV-01 B 批在 Pipeline 解析阶段加入 `urbanConcentration`（现默认 0.65，募集公式基准仍为 0.5）、`polityDensity` / `culturalDiversity`（默认 1）与 `capabilities.administrativeCapacity`（现默认 0.75），移除旧 `polityCohesion`。新增参数在保存配置、校验、控件和分享中使用同一契约；Schema 7 不迁移旧版，分享链接随默认值更新升至 v13。

- `population-settlements-v5` 的募集比例为 `min(0.56, 0.16 + 0.4 × scoreShare × urbanConcentration/0.5)`，募集半径再乘 `0.5+urbanConcentration`。0 表示弱聚居而非没有聚落；默认 0.5 对应旧募集公式。供体累计流出上限仍为原人口的 56%，所有迁入守恒。只读新增的聚居参数，格局变化不重算宜居性。
- `peoples-cultures-v3` 的文化起源目标按 `culturalDiversity` 缩放，起源间距除以其平方根；原 12 个起源预算也按倍率缩放，最高 24，并受有效聚落与内容/命名约束。默认倍率 1 保持旧目标量级。
- `polities-religions-v5` 用旧默认 0.6 的首都数量和间距公式作为基线，数量目标乘 `polityDensity`、间距除以其平方根。行政能力不参与这两个量，改为调节异文化惩罚：陆地 `1.08+(0.6-admin)×0.6`，交通捷径 `1.12+(0.6-admin)×0.6`，同文化分别保持 0.78/0.82；海路系数保持 `1.4−0.35×admin`。宗教起源间距使用未缩放的首都基线，近岸补全和全陆块归属规则不变。行政改变相对代价，不能仅把所有路径同比缩放。候选扩张成本统一到 Float32 后再比较和入队。
- `polities-religions-v6` 在专名后接上所选政体的显示名，中文直接相连（如「维兰共和国」），不含汉字时用空格。随机流仍固定为 v5，领土、宗教和人口不变。已发布的旧名称保留到重新生成。
- `peoples-cultures-v4` 沿用 v3 随机流与文化起源算法（按 `culturalDiversity` 缩放），仅在产物中新增暴露 `hearthRegions` 供下游评估文化中心特征。
- `polities-religions-v8` 在阶段内实现无循环的 CIV-02 六步流水线并切换至 v8 随机流：① 宗教起源与传播前移至扩张前，产出 `religions` 与区域主导宗教；② 结合自然/资源/交通/文化起源/宗教与 5 项社会能力门控和同源演替（`craft ↔ industrial`、`tribal-kinship ↔ centralized` 等）评估 12 种城市特征并按社会分工收放槽位数（1–3 项）；③ 沿用现有规则选首都；④ 扩张前由首都（50%）、局部腹地聚落距离加权均值（25%）及各特征峰值（25%）（无腹地时仅首都）涌现 3 维正交国家特征（权力形态 1 项 + 治理取向 0–1 项 + 经济导向 1 项）；⑤ 将国家特征转为扩张速率与文化/宗教/地形/交通捷径系数调制主扩张 Dijkstra，Pass 1 近海无偏置、Pass 2 孤立有人大岛建国同步涌现岛国特征、Pass 3 远洋港口投送叠加每政体海权成本系数 `politySeaCostFactors`；⑥ 领土统计后以国家特征强加权对齐 `PolityArchetype`、收口首都特征槽位与守恒 `PopulationGroup[]`。`politiesReligionsStage` 显式追加依赖 `hydrology-h0`、`ecology-e0` 并读取 `urbanConcentration`、`industrialCapability`、`landTransportCapability`，不破坏上游参数局部失效边界。Schema 升至 8，分享链接维持 v13。**本次未运行 test/typecheck/lint/build 或固定 Seed 对照。**

- `polities-religions-v9` 沿用 v8 随机流；国家特征目录由调用方通过 `CivilizationContentBundle.polityTraits` 注入。`PolityArchetype.requiredTraits` 筛除不满足要求的候选，`traitAffinities` 根据全部/排除特征及规模条件按序乘权，替代核心按政体形式的特征匹配分支。内置神权国要求 `theocratic`，无正权候选时明确失败。目录 ID/维度与匹配规则进入文明内容签名；完整包内容及翻译参与内容哈希。现有文明阶段共用 `civilization-content`，修改目录规则会重算文明链，自然与资源链仍可复用。Schema 8 / 分享 v13 不变。新增回归未运行，未做固定 Seed v8/v9 对照、性能或浏览器验证。

- `polities-religions-v11` 修正 v10 默认世界几乎全部分权的问题。局部人口结构改为首都与最强腹地中心的相对规模（地方中心人口沿用距离衰减权重），不以腹地总人口稀释首都；商业特化用 `max(0, civicFunction−productiveCore)`，不再普遍抑制集权。权力候选按支持度通过独立 `power-structure:capitalId` 随机 fork 加权选择，零分禁用；游牧要求本地牧业评分领先农业/工业/林木/工坊。地形和文化继续影响支持度，能力门控保留，没有各类型配额。其余随机流仍为 v8。Stage 版本使政体宗教缓存失效，上游可复用，Schema 8 / 分享 v13 不变。已实测四 Seed L6 完整校验及诊断重放，1024 重跑一致；v10/v11 同配置三 Seed 对照与未覆盖范围见 [CIV-02 特征分布](benchmarks/CIV-02-trait-distribution.md)。

- `polities-religions-v13` 以 `civilization.polityCount`（1–200 整数、默认 60）与 `politySizeVariation` 替换数量倍率。单个滑杆选择确切总数，核心不再随机抽取数量；候选聚落不足请求数时报错。陆地和现有可用交通捷径定义片区，按人口优先播种片区后以选址加权最远点补齐首都；孤岛计入预算，无后置追加国家。政治腹地采样限制在同一可达片区。目标陆地份额按片区归一化的 `rank^(-2*variation)` 分配，保留首都格面积；独立成本前沿按每国已占/目标面积调度扩张，地理、文化、宗教与路线成本决定该国方向。海路在零航海时禁用，近海/远洋投送保留但不增国。全局等面积不是保证；孤岛、阻塞、格网与投送可改变最终分布。面积统计排除湖面和海面，最终再对齐政体并守恒分组人口。Schema 10 / 分享 v15。三个 Seed/L6 的 15 组数量及面积、缓存、人口与重算对照见 [CIV-03](benchmarks/CIV-03-polity-layout.md)。

- `polities-religions-v14` 增加政体 `allowedSizeClasses` 硬匹配；实际陆地面积决定小规模，移除单聚落豁免。内置自由领地、酋长领、自治公社和城邦仅匹配不超过 3 个参考支撑面积的 `city-state`，特征权重不能绕过。大领土选其他合格原型，无合格候选则失败，不改国家预算。完整快照校验重算实际面积和已归属人口份额，拒绝伪造规模。中英文政体包升至 1.2.0，限制进入内容哈希与文明签名；内容改变仍失效共用内容键的文明链，自然/资源链可复用。Schema 10 / 分享 v15 不变。三 Seed 九组前后对照见 [CIV-04](benchmarks/CIV-04-polity-size.md)。

- 当前 `polities-religions-v15` 在划界后、候选政体匹配前按目录的 `territory` / `sizeClasses` 派生 `small-area`，四类小政体以 `requiredTraits` 引用，硬条件与偏好权重分离。保留原三维特征形成与扩张；总特征上限从 3 升为 4，Schema 升为 11（旧 1–10 拒绝），分享 v15 不变。目录升至 1.1.0、政体内容包升至 1.3.0，领土条件进入文明内容签名。实际面积、领土特征与必需引用均在完整快照校验中核对，方法和九组复验见 [CIV-04](benchmarks/CIV-04-polity-size.md)。

- 政体内容包 1.4.0 调整基础权重及君主形态的王朝贵族/公民议政偏好；代码公式和阶段版本 `polities-religions-v15` 不变，以内容版本及签名记录结果变化。权重只作用于划界后的政体选择，不改变本轮人口、首都、国家特征和领土；共用文明内容签名仍会使文明链缓存失效，命名可能变化。实际 Web L7 及多预设/多 Seed 的 14 组前后对照见 [CIV-05](benchmarks/CIV-05-polity-weights.md)。

缓存顺序：聚居改变从人口聚落向下失效；文化多样性从族群文化向下失效；确切国家数、面积差异或行政能力仅使政体宗教失效。参数校验拒绝显式旧字段、非法范围和非有限值，不靠隐藏常数补偿无效配置。全仓单元、类型和构建通过；核心整包及本次修改文件定向 lint 通过，其余既有 lint 错误见 [进度](PROGRESS.md)。16 组固定 Seed/L4 对照数据见 [参数对照](benchmarks/CIV-01-parameters.json)，可运行 `bun run --cwd packages/world-core bench:civilization` 复现；它使用测试内容，不代表历史校准或性能矩阵。B 批定向 Playwright 两项已通过真实 Worker/缓存/分享恢复与旧链接拒绝验证；完整旧版 E2E 与更早算法版本对照未运行。C 批增加预设浏览器验证与高等级矩阵。

### C 批预设、人口尺度校准与性能口径

Web 的 `civilization-presets.ts` 拥有四份完整参数表：农耕聚落、城邦商贸、区域王国、近代工业商贸（默认）。选择只替换待生成文明参数，保留 Seed、自然参数和文明开关；不自动生成。按全部有效数值匹配预设，编辑后显示自定义，分享/恢复后重新匹配。预设 ID 不进入核心配置、缓存键或世界事实，Schema 7 / 分享 v12 不变。文化多样性在四份表中保持 1×，不与发展阶段绑定。

以联合国 1900 年约 16.5 亿人口、148.94 百万 km² 地球陆地面积为参照，比较 `人口 / 实际陆地面积 × 地球陆地面积`，只在离线基准中做面积换算，生成器不强制总人口。三个 L5 Seed 的旧平均约 110.98 亿，联合缩放系数约 0.14868；将原 145/45 系数的拟合值 21.56/6.69 取整为 22/7。校准后三样本平均 16.84 亿（+2.05%），独立 L6 Seed 18.36 亿（+11.28%）。拟合均值 ±15%、留出样本 ±25% 是工程验收范围，不是历史估计置信区间。工业相对权重没有独立识别；交通速度、聚落数量、国家/文化数量与城市规模分布未按历史拟合，已命名聚落人口占比不等于真实城镇化率。

`habitability-v3 → v4` 使该阶段及所有文明下游缓存失效，自然与资源阶段保持可复用；旧世界人口不自动重分配。派生承载力仍按当前算法复算，不支持旧算法回放。生产内容的 L6/L7/L8 各三次独立冷进程运行，包含领域校验与快照装配；记录分阶段耗时及 `process.resourceUsage().maxRSS` 峰值，核对重复世界的关键事实指纹。它不覆盖浏览器 Worker 传输、GPU/制图或旧/新快照共存峰值。复现：`bun run --cwd apps/web bench:civilization:calibration` / `bench:civilization:performance`。详情与原始数据见 [校准与性能](benchmarks/CIV-01-calibration.md)。

`transport-network-v2` 为陆路、海路及多源可达性搜索增加每轮已处理标记，并将候选成本统一到 Float32 精度后再比较、保存和入队；同一目标的旧堆条目不再重复消耗搜索名额。版本变化使交通及下游文化、政体/宗教缓存失效，上游人口聚落与自然链可复用。已有 Schema 4 快照保留已存路线，不在读取时重算。最初补充的确定性合成图回归已在后续 A/B 与 C 批核心测试中通过；固定 Seed `m2-civilization-seed` 的 v1/v2 旧版本对照未补做，当前版本性能见 C 批。

前七项组成地质 Pipeline；Mesh Pipeline 只有 mesh；Terrain Pipeline 复用地质 Registry，再追加地形、地理分区与地名 Stage。Climate Pipeline 再追加 C0；Hydrology Pipeline 复用该分支并添加 I0/H0/L1；Ecology Pipeline 另建 C0 Registry 并追加 E0。两条调试分支共享 StageCache 的可复用上游产物，但 E0 单独计划不包含任何水文 Stage。Natural Pipeline 在同一 DAG 中包含 I0/H0/L1/E0，E0 仍直接依赖 Mesh/T0/C0，水文参数变化不会使 E0 Stage 失效。

H0 缓存签名包含蒸散系数、基准汇水面积、河网密度倍率和公转周期；L1 包含最小湖泊面积和公转周期。调整河网参数重算 H0 及其下游，调整湖泊面积或公转周期只使 L1 失效；上游气候和地形产物保持可复用。土壤蒸散系数不再进入 L1 签名。

配置按源码 configKeys 声明：Mesh 读等级、扰动、可选 Mesh Seed、物理半径；参考 Mesh 另读参考等级（默认 L6，显式 L2–L6）；板块读主/微板块数和板块面积差异；大陆读大陆数、面积差异与候选覆盖率；骨架读三项 landforms；terrain 读纹理/扭曲/平滑、山脊锐化、水力/冰川侵蚀强度、islandDensity 和海平面基准。侵蚀强度只使 terrain Stage 失效。

## 配置与局部失效

| 配置 | 当前默认/范围 | 重算边界 |
| --- | --- | --- |
| 输出 Mesh | 核心 L0–L8，扰动 [0,1]；UI L4–L8 | 输出 Mesh、映射及输出地质/构造/地形 |
| 参考 Mesh | 默认 L6，显式 L2–L6 | 参考地质与全部消费者 |
| 主/微板块 | 默认 10/14，实际数受连通性约束 | 板块拓扑及消费者 |
| 板块/大陆面积差异 | 默认 0.8/0.35 | 各自 Stage 及消费者 |
| 候选大陆数/覆盖率 | 默认 7/0.3 | 地壳、投影及后续，不重算板块拓扑 |
| islandArcCount/islandDensity/hotspotCount | 默认 6/0.65/5 | 骨架及 terrain；islandDensity 也是 terrain 直接输入 |
| roughness | [0,0.5]，默认 0.4 | terrain |
| terrainWarp/smoothing/ridgeSharpening | [0,1]，默认 0.75/0.1/0.5 | terrain |
| seaLevelDatumKm | 默认 0，须满足物理径向约束 | terrain |
| hydrology.riverDensityMultiplier | [0.25,4]，默认 0.5 | H0 河道汇水面积门槛；高倍率降低门槛、增加候选河道 |
| hydrology.minimumRiverDrainageAreaKm2 | [0,1e9] km²，默认 5000 | H0 河道汇水面积基准 |
| hydrology.minimumLakeAreaKm2 | 非负有限 km²，默认 0 | L1 过滤较小洼地候选，不扩展湖泊边界 |
| civilization.enabled | boolean，默认 true | `population-settlements`、`transport-network`、`peoples-cultures`、`polities-religions`（关闭仍保留自然链与 `resource-potential` / `habitability` 缓存） |
| civilization.populationScale | [0.1,4]，默认 1 | `population-settlements` 及下游文明 Stage |
| civilization.settlementDensity | [0.25,4]，默认 1 | `population-settlements` 及下游文明 Stage |
| civilization.polityCount | 1–200 整数，默认 60；单滑杆选择确切数量 | 仅 `polities-religions` |
| civilization.politySizeVariation | [0,1]，默认 0.5 | 仅 `polities-religions` |
| 相机、配色、专题、线框 | ViewState | 不生成 |

roughness 可调纹理强度按 `(roughness/0.4)³` 响应。`terrain.glacialErosion` 与 `terrain.hydraulicErosion` 范围 [0,1]，默认 0.5，阶段内 km 转换前运行；水力参数进入处理器前统一乘以 0.5，冰川参数不缩放。当前不读取气候/降雨。旧 `continentalUpliftKm` 参数即便为零也在计划/执行前报错，包括全缓存命中。

I0 配置通过 `hydrology.snowTemperatureMinC`、`snowTemperatureMaxC` 和 `degreeDayMeltFactorMmPerCMonth` 进入签名；H0 读取蒸散系数、基准汇水面积、`riverDensityMultiplier` 和公转周期。河道阈值为 `max(minimumRiverDrainageAreaKm2, 16 × 平均网格面积) / riverDensityMultiplier`，并要求累计流量大于零。L1 读取 C0 月降水、月温和 Köppen，并按平均水深、冰原、荒漠和湖面降水/潜在蒸散筛选候选；`minimumLakeAreaKm2` 再过滤小湖。调整河网倍率/基准会重算 H0 及下游。调整最小湖泊面积或公转周期只使 L1 失效；土壤蒸散系数不再进入 L1 签名。

## DAG、签名与随机流

Registry 拒绝重复 ID、空声明、缺失依赖和循环。Kahn 排序的 ready 集按 Stage ID 的 JS 字符顺序排序，注册顺序不决定结果。getDependency/getConfig/getContentSignature 只能读已声明输入。

签名对 Stage ID/版本、World Seed、声明配置（含缺失标记）、内容签名、上游签名、Seed 派生版本、随机 Profile 和 PRNG 版本规范序列化后做 FNV-1a 64。对象键排序；非法非有限值、循环或非 JSON 配置拒绝。Cache Key 同时保留规范原文避免缓存内短哈希碰撞歧义；它不是密码学哈希。未知显示状态不参与生成签名。

`force: true` 重跑全部，Stage ID 列表强制该节点及下游。plan 是当前缓存的预测，执行时会再次确认可命中。

默认 Stage 随机流由 World Seed、Stage ID、版本派生 Mulberry32，稳定 fork 只依赖不可变流身份，不依赖父流当前取数位置。Mesh 用 `alea-direct-v1` 保留旧几何取数兼容，可由 mesh.seed 覆盖 World Seed；规则网格几何可不受 Seed 影响，Pipeline 仍保守包含 World Seed。

骨架/terrain 显式固定 `terrain-skeleton-v5`/`terrain-v7` 的随机派生版本，同时使用当前 Stage 版本失效缓存。这样输出曲线调整不会顺带换一套噪声；同版本确定性仍须按固定 Seed 验收，不承诺跨版本或与参考项目逐字节一致。

## 所有权与执行

1. Stage 拥有新建工作数组，返回后经 validate 才进入 Pipeline/Cache；校验失败或取消不提交该阶段产物。
2. getDependency 返回零拷贝只读 Proxy，禁止属性写入、原地方法与 .buffer 访问。热循环由内部 copyDependency 按消费字段生成原生 TypedArray 工作副本；不能绕过输入声明或改写上游。
3. getOutput 返回共享借用，不是不可变深副本。调用者不得修改、detach、Transfer 或保留构建时可写别名；普通元素篡改不能无成本侦测。
4. StageCache 默认 512 MiB LRU，以容纳 L8 地形完整阶段链（core 实测约 430.5 MiB，Worker 实测约 399.3 MiB）。预算统计包含 Buffer 去重后的主要产物字节，不等于进程/GPU峰值；过大条目不缓存。查到 Buffer 已 detach 时丢弃条目，clear 可手动清空。
5. Stage 顺序执行；AbortSignal 在阶段前后和主动检查点生效。同步长循环不能接收同线程新消息来即时中断，强制终止由 Worker 负责。

事件含 runId、stageId、进度、适用时耗时和错误；订阅者异常不改变结果。失败保留 cause 并停止下游，不自动重试；有效的已完成缓存仍可保留。Pipeline 成功不等于完整 WorldSnapshot 发布。

## Web Worker 与显示

Worker/Controller 支持 Mesh、Geology、Terrain、C0、水文、E0 调试请求及带 `publication` 身份的完整世界请求（`createWorldPipeline`）。完整请求在 Worker 内从同一 DAG 装配 Schema 4 候选；阶段缓存继续拥有原数组，调试产物使用结构化副本，独立快照 Buffer 只转移一次。Controller 复核调试产物和快照身份，使用 `WorldStore` 完整校验候选，地图场景安装成功后才提交。失败、取消和传输错误保留最后已发布世界。全仓 `typecheck`、单元测试与生产构建均已通过，Playwright 浏览器验收尚未运行。

只接收最新 requestId 的生成/拾取响应。硬取消终止重建 Worker，旧显示保留但缓存丢失；重新成功生成前禁用区域查询，防止旧画面和新 Worker 事实身份错配。失败、取消和传输错误不覆盖最后有效显示。页面销毁终止 Worker 并释放场景资源。

当前调试页面用单位球和颜色表达高程，不是正式世界查询/地图发布协议。月份、风格与图层的未来显示缓存也不得进入生成签名。

## 未来的气候、水文与侵蚀

当前顺序为 `T0（基础水力/冰川侵蚀） → C0 → I0 → H0 → L1`。I0 按月温度/降水计算线性雨雪分配、雪水当量储量与融雪；H0 用温度指数蒸散近似和 Priority Flood 生成径流、排水树、流域与阈值河段；L1 v10 将 `filledElevationKm > terrain.elevationKm` 的陆地区域分成连通洼地，只保留至少覆盖两个 Mesh 区域、不小于 `minimumLakeAreaKm2`、平均水深至少 1 m，且湖面不是荒漠或全年封冻、年降水大于开放水面潜在蒸散的静态湖泊；末端小水体闭合产生的近岸洼地已在 T0 `terrain-v27` 破口排海，不在 L1 做高程特判。水位取成员区域的最大 Priority Flood 高程；溢流口取湖内指向外部路由区域的边界区。该水位只表示静态溢流几何，不等于逐月储水，也不改地形。湖泊 ID 由 Mesh ID 与成员最小区域索引构成。无海洋网格时，H0 内流根语义传至湖泊；它不表示存在海洋的行星已具备完整内流湖判定。旧 v4 Core/Web 检查、3 Seed × L4/L5/L6 基准见 [M1.3B 基准](benchmarks/M1.3B-static-lakes.json)，不覆盖当前 v7 的深度和气候筛选。Priority Flood 长条洼地仍可能对应河谷；1 m 平均水深只去掉不足一米的填洼薄膜，低地数米深的闭合仍会成湖。

E0 从与水文平行的 DAG 分支运行：读取 C0 的 12 个等时长气候箱和 T0 海陆/高程，对全部陆地区域（包括 L1 标记的湖泊成员及 H0 河道区域）依气候与地形分类；不读取 I0/H0/L1，不按水文成员跳过或覆盖分类结果。C0 年均温/年降水作为唯一年度统计来源。分类词表由 `world-data` 拥有；E0 不生成湿地/农业字段，也不修改地形、湖泊或海陆。雪冰分类是温度/降水启发式代理。C0 变化会使 E0 及水文分支分别失效；水文参数变化不应使 E0 失效。E0 不代表最终 C1 驱动结果。

T0 v24 小水体连通性已通过 3 Seed × L4/L5/L6 基准：未发现低于四个 L5 网格等效面积的封闭水体残留，海洋连通分量为 1–3。terrain-v20 历史数据仍只代表旧版基线。后续 `hydrology-h0-v2` 河网密度校准将动态汇水面积底线由 8×提高到 16×；L6 固定 Seed 样本河道区域数减少约 39–44%，详见 [河网密度校准基准](benchmarks/M1.3A-river-density-calibration.json)。L1 v4 过滤单网格组件后，3 Seed × L4/L5/L6 的湖泊数量为 L4 0–2、L5 3–7、L6 33–39；统计见 [M1.3B 静态湖泊基准](benchmarks/M1.3B-static-lakes.json)。

当前 C0 使用输出面积聚合到参考 Mesh，空参考格退回最近输出格。在参考格计算四季风、洋流、月温和月雨，先汇总初估年降水与潜在蒸散，再用其比值限制最终月雨求解中的陆地水汽供给。以三个邻近参考格优先同海陆投影温雨，气温直减率仅应用于最终陆地，并按物理面积修正全球月降水体积。洋流查询使用独立的同水体参考映射。`climate-c0-v21` 延续 v20 的东岸中纬温差、冬季离岸气流降雨抑制和 1100 km 陆向传播，并按东岸暴露度平方增强夏季迎风降雨。仍读取原有自转、倾角、公转周期、温度偏移及降水倍率，物理半径来自 Mesh。风噪声沿用 v2 随机流键，产物按 v22 Stage 版本参与缓存签名，I0/H0/L1/E0 通过依赖签名重算。月份选择属于显示状态。 [v21 草原/Dwa 调整](benchmarks/M1.2-Dwa-v21-steppe-adjustment.md) · [v20 Dwa 校准](benchmarks/M1.2-Dwa-v20-adjustment.md) · [v19 Dwa 校准](benchmarks/M1.2-Dwa-v19-adjustment.md) · [v18 Csa/Csb 校准](benchmarks/M1.2-Csa-Csb-v18-adjustment.md) · [v17 Csa 范围校准](benchmarks/M1.2-Csa-v17-adjustment.md) · [v16 陆地水汽再循环对照](benchmarks/M1.2-land-water-limited-recycling.md) · [v15 大陆冬季与背风干燥对照](benchmarks/M1.2-continental-dryness.md) · [v14 副热带沙漠对照](benchmarks/M1.2-subtropical-desert.md) · [v13 西岸与内陆降水对照](benchmarks/M1.2-west-coast-inland-rainfall.md) · [v12 历史校准](benchmarks/M1.2-climate-calibration.md)

`climate-c0-v22` 在温雨投影后新增输出网格的四季环流重采样：风优先同海陆多源加权，洋流只取同一最终水体所属的相邻参考海水源；向量先沿大圆平行移动到输出切平面再混合。`projectedCirculation` 供查询与月度快照提取共同读取，保留原始参考场与原缺测掩码。参考环流、温雨公式和随机流键不变；C0 版本变化仍使下游依赖缓存失效。固定 Seed 数据分析、色阶依据及未验证范围见 [v22 环流显示分析](benchmarks/M1.2-circulation-display.md)。

T0 复用参考 `TerrainErosionProcessor`，按内部塑形坐标运行水力/冰川侵蚀及锐化、土壤蠕动前的排水重建；当前不把其流量诊断作为正式河网事实，也不读取 C0 降雨。

## 证据与复跑

历史实测文件、对应机器/版本和当前待验收项集中在 [PROGRESS](PROGRESS.md)。`bench:hydrology` 已归档 3 Seed × L4/L5/L6 的 I0/H0/L1 冷生成、缓存命中、局部参数变化、强制重算哈希、湖泊统计、资源和 T0 海岸统计；M1.3A 初始基准见 [M1.3A 基准](benchmarks/M1.3A-hydrology-acceptance.json)，加入湖泊后见 [M1.3B 基准](benchmarks/M1.3B-static-lakes.json)。缓存命中耗时、数组字节、RSS 阶段采样与真实峰值必须分开报告。
