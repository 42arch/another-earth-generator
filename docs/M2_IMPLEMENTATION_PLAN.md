# Another Earth — M2 文明生成实施计划

> 创建：2026-11-20｜适用分支：`feat-civilization`
> 本文档为 M2（初始文明生成、自然资源分布、交通网络与地图/Web 联调）的实施规划，不代表以下能力已实现；当前已实现能力与验证状态以 [当前进度](PROGRESS.md) 为准。

---

## 1. 目标与范围边界

### 1.1 交付目标
在已有自然世界生成链（Mesh → Geology → Terrain → Geographic Regions/Names → Climate C0 → Cryosphere I0 → Hydrology H0 → Static Lakes L1 → Ecology E0）之上，交付可复现、可解释、满足人口与引用守恒的初始文明生成与可视化闭环：
- 基于自然条件的**资源潜力分布**与**宜居性/承载力**；
- **区域人口与聚落**（含选址、层级、规模，聚落人口包含于区域总人口）；
- **交通网络**（陆路、河运与近海航线图及市场可达性）；
- **民族/种族（People）与文化**（起源、沿交通网扩散、基于 `NamingStyle` 的中文命名）；
- **国家/政体（Polity）与宗教**（基于 `PolityArchetype` 的国家形态匹配、领土划分、宗教传播与稀疏 `PopulationGroup` 守恒装配）；
- **Schema 4 世界快照**（含资源与交通持久化）、只读查询、档案往返、制图图层与 Web 联调。

### 1.2 明确非目标
- 不实现 M5+ 动态文明时间推进、战争/外交事件模拟、完整历史分支与世界编辑器。
- 不实现 M4 浏览器持久化（IndexedDB/OPFS）或工程项目管理界面。
- 不引入微观个体/逐建筑模拟或跨城商品价格均衡求解。
- **不保留旧版数据契约兼容**：Schema 3 及更早快照/档案、旧 `GovernmentArchetype` / `governments` 与旧 `pack.states` 契约直接清理并拒绝，不编写迁移器或双轨兼容分支。

---

## 2. 已定契约与设计决策

1. **政体命名统一（`Polity`）**
   - `world-data` 中 `ContentPackV1.states` 改为 `polities`；`StateArchetype` / `StatePoliticalForm` / `StateGovernmentOrganization` / `StateSuccession` 及 `another-earth/society-pack` 中的 `states` 统一改名为 `PolityArchetype` / `polities`（文件、Pack ID、ContentId 域名 `*:polity/*` 同步对齐）。
   - 移除 `GovernmentArchetype`、`pack.governments` 及 `core:government/council` 占位定义。
   - `world-core` 中的实体继续保持 `Polity`（`civilization.polities`、`polityId`），其模板字段由 `governmentArchetypeId` 改为 `archetypeId: ContentId`，直接引用 `PolityArchetype`。

2. **族群/物种层统一（`People`）**
   - `world-core` 中 `Species` 改为 `People`（`civilization.peoples`），新增 `archetypeId: ContentId` 引用 `world-data` 的 `PeopleArchetype`；`Culture` 与 `PopulationGroup` 中的 `speciesId` 改为 `peopleId`。
   - M2 首版以 `People` 承载民族/原生人群分类；后续可扩展生理适应与奇幻种族属性，无需破坏实体关系结构。

3. **资源与交通持久化（Schema 4）**
   - `WORLD_SCHEMA_VERSION` 升为 `4`。
   - **自然资源**写入 `nature.resources`（属于自然世界连接文明的权威事实，包含资源字典、`agriculturalPotential` 稠密场与矿产/能源/渔林资源点或分布记录及其主要自然成因）。
   - **交通网络**写入 `civilization.transport`（包含交通节点/枢纽、连接路径 `routes` 及网格级通达性/通行成本摘要）。

4. **默认语言策略**
   - 默认生成与内置联调使用**中文（`zh-CN`）**内容包与命名风格（`western-zh-cn`、中文 `peoples` / `cultures` / `polities` 及中文宗教/资源包）；`en` 内容包保持同构与完整校验，后续可按需接入语言切换。

---

## 3. 分批实施路线

### Batch 1：契约改造、Schema 4 校验与中文默认内容包

#### 1.1 `packages/world-data`
- **Schema 与打包/校验器改造**
  - `src/schemas/content.ts`：删除 `GovernmentArchetype` 与 `governments`；将 `StateArchetype` 等类型重命名为 `PolityArchetype` / `PolityPoliticalForm` / `PolityGovernmentOrganization` / `PolitySuccession`，`ContentPackV1.states` 改为 `polities`。
  - `src/schemas/society-pack.ts`、`src/society/parse-society-pack.ts`、`src/society/society-pack.ts`、`src/society/builtin-society-packs.ts`：作者格式域名由 `peoples | cultures | states` 改为 `peoples | cultures | polities`（`:polity/` 域名与 `-zh-cn` / `-en` 后缀校验），同步移除 `governments` 空字段。
  - `data/society/states-en.json`、`data/society/states-zh-cn.json`：重命名为 `polities-en.json`、`polities-zh-cn.json`；Pack ID 改为 `builtin-polities-en` / `builtin-polities-zh-cn`，定义 ID 改为 `builtin:polity/*`。
  - `src/validation/validate-content-pack.ts`、`src/catalog.ts`、`src/names/naming-style-pack.ts`：统一切换为 `polities`，清理 `governments` 检查。
- **命名词库扩容与规则补全**
  - `data/name-styles/western-zh-CN.json`（及同构更新 `western-en.json`）：
    - 扩充 `settlement` 词根/后缀池与组合规则（保证至少可稳定产出 500+ 无重复聚落名称，满足 L6–L8 大图防重需求）。
    - 新增 `people`、`culture`、`religion`、`polity` 命名规则与对应词池（国家展示名可结合文化词根与 `PolityArchetype` 政体称谓拼装或独立专名规则生成）。
- **补全宗教社会包、资源与默认生成目录**
  - 新增 `data/society/religions-zh-cn.json` 与 `religions-en.json`（纳入 `another-earth/society-pack` 的第 4 个互斥域 `religions`，覆盖自然/泛灵、祖灵、多神、一神、哲学传统等，带 `organization`、`tolerance`、`spreadBias`、`traits`、`weight`），并在 `core` 中补全**自然资源定义**（覆盖铁矿、铜矿、贵金属、煤矿/能源、良田作物、林木、渔场等，带 `category` 与 `geologyTags`）。
  - `src/builtins.ts`：清理 `core:government/council` 与内置占位 `core:religion/local`；保留自然资源定义，并提供完整的默认中文生成 Catalog（`core` + `earthlike` + `western-zh-cn` + `builtin-peoples-zh-cn` + `builtin-cultures-zh-cn` + `builtin-polities-zh-cn` + `builtin-religions-zh-cn`）。

#### 1.2 `packages/world-core`（契约与校验）
- `src/content/content-port.ts`、`src/content/test-content.ts`：
  - `ContentPackView` 移除 `governments`，增加 `peoples`、`polities`；新增只读视图接口（`PeopleArchetypeView`、`CultureArchetypeView`、`PolityArchetypeView`、`ReligionArchetypeView`、`ResourceDefinitionView`）及对应签名辅助函数，保持 `world-core` 零依赖 `world-data`。
- `src/generation/civilization/civilization-types.ts`：
  - `Species` → `People`（带 `archetypeId: ContentId`）；
  - `Culture.speciesId` → `peopleId`；
  - `Polity.governmentArchetypeId` → `archetypeId: ContentId`；
  - `PopulationGroup.speciesId` → `peopleId`；
  - 新增 `TransportLink`、`TransportNode`、`TransportState`（归属 `CivilizationState`）；
  - 在 `nature/nature-types.ts`（或资源专属模块）新增 `ResourceDeposit`、`NatureResourcesState`。
- `src/world/world-snapshot.ts`、`src/world/world-metadata.ts`、`src/world/world-validator.ts`、`src/world/world-archive.ts`、`src/world/world-assembler.ts`（原 `natural-world.ts` 更名，统一导出 `assembleWorld` 与 `WorldIdentity`）：
  - `WORLD_SCHEMA_VERSION` 升至 `4`。
  - `generationConfig` 补充文明配置参数（如 `civilizationEnabled` 及文明配置对象）。
  - `validateWorldSnapshot` 改为校验 `peoples`、`polities`、`nature.resources`、`civilization.transport`；`civilizationEnabled === true` 时验证文明 Stage `provenance`、人口分组守恒、聚落人口上限、首都归属与路径拓扑有效。
  - `world-archive.ts` 只接受 Schema 4 与当前归档校验规则。

---

### Batch 2：自然-文明连接与文明生成 Stage DAG（`packages/world-core`）

#### 2.1 DAG 结构与缓存隔离原则
- **严格单向依赖**：自然链不读取任何文明配置；调整文明参数只失效对应的文明 Stage，绝不重算 Mesh、Geology、Terrain、Climate、Hydrology、Ecology。
- **独立确定性随机流**：每个 Stage 通过不可变 `(worldSeed, stageId, stageVersion, entityOrRegionKey)` 派生 PRNG，不依赖对象迭代顺位外的隐式状态。
- **零越界依赖**：Stage 间一律通过 `copyDependency` 读取声明依赖的必要字段。

#### 2.2 新增 Stage 清单

| 序号 | Stage ID | 直接依赖 | 配置 / 内容声明 | 核心职责与输出 |
| --- | --- | --- | --- | --- |
| 1 | `resource-potential` | `mesh`, `geology`, `terrain`, `climate-c0`, `hydrology-h0`, `ecology-e0` | 内容键 `resource-definitions` | 计算各区域农业潜力场 `agriculturalPotential`（气候/生长季/水源/坡度）、林业/渔业潜力，以及基于板块边界/造山/火山/地壳的矿产/能源储量点 `deposits`（含 `primaryFactor` 成因）。 |
| 2 | `habitability` | `mesh`, `terrain`, `climate-c0`, `hydrology-h0`, `static-lakes-l1`, `ecology-e0`, `resource-potential` | 文明配置（如生态/宜居权重） | 合成陆地区域宜居度、环境承载力 `carryingCapacity`（人/km²）与网格基础通行阻力 `movementCost`（坡度/高程/荒漠/冰原/渡海海峡成本）。 |
| 3 | `population-settlements` | `mesh`, `terrain`, `hydrology-h0`, `static-lakes-l1`, `resource-potential`, `habitability` | 配置 `civilization.enabled`, `populationScale`, `settlementDensity` | 分配区域权威人口 `population`（`Float64Array`）；结合承载力、河口/港口、河流交汇、矿产节点与最小测地间距抑制生成 `Settlement`（含层级/功能/人口，且区域内聚落人口总和 ≤ 区域人口）。若关闭文明则输出空表与全零人口。 |
| 4 | `transport-network` | `mesh`, `terrain`, `hydrology-h0`, `habitability`, `population-settlements` | 配置 `civilization.enabled` | 以聚落和沿海良港为节点，基于 `movementCost` 运行有界 Dijkstra/A* 构建陆路、沿河与近海航线图（`nodes`、`routes`），计算区域通达性与枢纽中心性。 |
| 5 | `peoples-cultures` | `mesh`, `habitability`, `population-settlements`, `transport-network` | 内容键 `civilization-content`（`peoples`, `cultures`, `namingStyles`） | 按地形/生态特征匹配文化与族群发源核心，实例化 `People` 与 `Culture`；沿交通网做竞争扩散（保留边界混合与少数群体）；使用文化绑定 `NamingStyle` 与全局防重集合生成 `People`、`Culture` 与 `Settlement` 唯一中文名称。 |
| 6 | `polities-religions` | `mesh`, `population-settlements`, `transport-network`, `peoples-cultures` | 内容键 `civilization-content`（`polities`, `religions`） | ① 以高中心性/高人口聚落为首都按行政投送代价扩张领土（保留无归属边疆与独立城邦）；② 依规模、地理与文化特征加权匹配 `PolityArchetype` 并命名 `Polity`；③ 在文化核心或圣地诞生 `Religion` 并沿商路按 `spreadBias`/`tolerance` 扩散；④ 联合 `(peopleId, cultureId, religionId, polityId)` 生成 `PopulationGroup[]` 并对每区域执行精准配额收口，保证人口守恒。 |

#### 2.3 Pipeline 与世界组装入口
- 在 `packages/world-core/src/generation/stages/` 新增 `civilization-stage.ts` 与 `world-stage.ts`（提供 `createWorldPipeline`）。
- 在 `packages/world-core/src/world/world-assembler.ts` 扩展 `assembleWorld`（不保留旧 `assembleNaturalWorld` 兼容别名），将全部自然产物、资源、交通与文明状态装配为 `WorldSnapshot` 并通过 `validateWorldSnapshot` 完整模式校验。

---

### Batch 3：只读查询契约与制图渲染（`packages/world-core` + `packages/cartography`）

1. **只读查询扩展（`world-core`）**
   - `WorldMapReader`（`src/world/world-map-reader.ts`）：新增 `peoples()`、`cultures()`、`religions()`、`polities()`、`settlements()`、`resources()`、`transportRoutes()`，以及只读衍生区域归属视图（主导国家索引、主导文化索引、主导宗教索引、农业潜力/宜居度/人口密度字段），确保不向外部暴露可变内部 TypedArray 或数组引用。
   - `WorldStore`（`src/world/world-store.ts`）：`region(region, month)` 补充返回该区域人口、承载力、农业潜力、周边资源点、所属国家、主要文化与宗教构成、聚落清单。

2. **制图数据源与样式预设（`packages/cartography`）**
   - `sources/registry.ts` & `sources/adapters/`：
     - 栅格/面源：`population-density`（人口密度）、`polity-territory`（国家领土填色，无国家区保持自然底色/浅灰）、`culture-dominant`（主导文化）、`religion-dominant`（主导宗教）、`resource-potential`（农业/矿产潜力）。
     - 矢量/符号/标注源：`polity-borders`（复用 `ring-tracer` 从 `polity` 归属提取平滑国界线）、`transport-routes`（陆路/海路分级线）、`settlements`（首都星标与聚落分级圆标）、`polity-labels` 与 `settlement-labels`（接入现有视口碰撞避让）。
   - `styles/presets/`：新增 `political-atlas`（政区图）和 `population-economy`（人口与交通专题）预设。
   - `picking/map-picker.ts`：支持聚落点位与政区边界的统一 `PickResult`（携带 `entityId`）。

---

### Batch 4：Web 编排、UI 联调与验收收尾（`apps/web` + 文档）

1. **内容与 Worker 编排**
   - `apps/web/src/lib/generation/builtin-content.ts`：切换至默认中文完整生成 Catalog，注入 `resource-definitions` 与 `civilization-content` 及其内容签名。
   - `apps/web/src/lib/generation/protocol.ts`、`transfer.ts`、`controller.ts`、`apps/web/src/workers/generation.worker.ts`：
     - 透传文明配置参数（开关 `enabled`、人口规模倍率、聚落密度、国家凝聚度等）。
     - 在 Worker 内运行 `createWorldPipeline` 并组装 Schema 4 快照；保持缓存原件与转移副本分离。

2. **工作台界面接入**
   - `ParameterPanel.svelte`：新增“生成文明”开关及关键初始文明参数滑块（开关关闭时完整跳过文明渲染，参数变动不触发自然链重建）。
   - `LayerPanel.svelte` & `LegendPanel.svelte`：增加政区/国界、人口密度、文化、宗教、聚落、交通线与资源图层控制及对应图例（样式遵循 TailwindCSS 标准 utility）。
   - `RegionInspector.svelte`：选中区域/聚落时展示人口总数与构成、聚落信息、所属国家（含 `PolityArchetype` 政体形式与元首/政府/议会称谓）、文化、宗教及资源成因。

---

## 4. 验证策略与完成判据

每批完成后（在获得运行检查授权后）按受影响范围逐层验证：

1. **Batch 1（内容与契约）**
   - `world-data` 单测：所有内置中文/英文社会包、命名风格、宗教/资源包通过 `createContentCatalog` 与 `validateContentPack`；命名词池容量压力校验。
   - `world-core` 单测：`validateWorldSnapshot` 对 Schema 4 合法世界通过、对人口不守恒/聚落超区域人口/非法 `archetypeId`/断链 `transport` 报错；`encodeWorldArchive` / `decodeWorldArchive` 往返一致，Schema 3 旧档案明确拒绝。

2. **Batch 2（核心算法）**
   - 固定 Seed（例如 Seed `1024` / L5–L6 与 Seed `42` / L5）Node 单测：
     - **可复现性**：同 Seed + 同配置 + 同内容签名，两次生成全字段/实体深一致。
     - **局部缓存失效**：调整 `civilization` 参数后，自然 Stage 100% 命中缓存；调整水文参数不使自然上游失效。
     - **守恒与拓扑不变量**：所有区域 `∑PopulationGroup.population ≈ population[r]`；`∑Settlement.population ≤ population[r]`；首都必属该政体；所有 `Settlement` / `Culture` / `Polity` / `People` 名称全局不重名且无序号兜底；`transport.routes` 节点与区域路径合法连通。

3. **Batch 3 & Batch 4（制图与端到端）**
   - `cartography` 单测：国界提取、聚落点源与样式编译检查通过。
   - 全仓检查：`bun run typecheck`、lint、各包单测与 Web 生产构建通过，并在浏览器中完成真实 Worker 生成、切换政区/人口/文化图层及点选区域/聚落检查。
   - 文档收尾：按 `AGENTS.md` 事实变化原则更新 [当前进度](PROGRESS.md)、[世界数据契约](WORLD_DATA_CONTRACTS.md) 与 [生成管线](GENERATION_PIPELINE.md)。
