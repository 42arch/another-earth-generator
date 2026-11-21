# Another Earth — 当前进度

> 更新：2026-11-21。这里仅记录当前能力、未完成事项和最近验证状态。产品目标见 [PRD](PRD.md)；完整历史记录见 [进度历史快照](PROGRESS_HISTORY.md)。

## 当前状态

项目默认交付范围为 M0–M4。当前已具备自然世界生成、资源潜力与初始文明（人口、聚落、交通网络、族群、文化、宗教、政体）生成与发布、3D/2D 地图工作台和静态世界内容；浏览器项目存储尚未交付。

| 范围 | 状态 |
| --- | --- |
| `world-data` | 内置自然生成内容、双语命名风格（v1.5.0 中文 / v1.2.0 英文，含 `people`/`culture`/`religion`/`polity` 与扩容后的 `settlement` 规则）、八份双语 `peoples`/`cultures`/`polities`/`religions` 社会候选包及内置自然资源定义；默认生成目录优先加载中文内容包。 |
| `world-core` | L0–L8 球面网格、自然生成 Stage、资源/宜居性/人口聚落/交通网/族群文化/政体宗教 M2 生成 Stage 与 `createWorldPipeline`、Schema 4 `WorldSnapshot`（含 `nature.resources` 与 `civilization.transport`，统一 `People`/`Polity` 契约）、世界组装/校验/发布、只读查询和 M0 JSON 档案编解码（拒绝旧 Schema 1–3 档案）。 |
| `cartography` | 3D Globe、三种 2D 投影、自然与文明/资源数据源（27 个内置数据源）、样式编译、七套预设（含政区图 `political-atlas`；人口密度与交通航路为独立专题/覆盖层）、统一拾取（含 `entityId`）与地图会话。 |
| `apps/web` | Worker 完整世界生成与发布、3D/2D 地图、自然与资源/文明专题图层及能力门控、图例统计、区域与文明实体探测、概览统计、生成参数分享链接（`#w=10.`，含文明参数）、默认中文生成内容注入；无浏览器项目持久化或世界档案导入界面。 |
| M2 初始文明 | Batch 1–4 均已实现并完成单元与构建验证（见下方验证记录）；Playwright 浏览器端到端界面验收尚未执行。 |
| M4 项目存储 | 未实现。IndexedDB/OPFS、项目恢复和完整世界档案导入导出尚未接入。 |
| M5+ | 动态文明、编辑器和历史分支不在当前交付范围。 |

## 当前自然链

当前阶段基线为 `terrain-v27`、`climate-c0-v22`、`cryosphere-i0-v1`、`hydrology-h0-v4`、`static-lakes-l1-v10`、`ecology-e0-v3`，完整世界生成链在此之上串联 `resource-potential-v1`、`habitability-v1`、`population-settlements-v2`、`transport-network-v3`、`peoples-cultures-v2`、`polities-religions-v2` 组装并发布 Schema 4 快照；M1 已按用户决定收尾，未完成的验收项目保留为延期事项，不视为通过。

当前已知限制：

- C0、I0/H0/L1 与 E0 是可解释的初步模型，不代表地球尺度校准或动态水文/生态模拟。
- T0 地形形态与高等级内存仍需专项复验；C0 雨影专项、完整性能矩阵和 L7/L8 峰值内存尚未完成。
- 静态湖泊使用 Priority Flood 溢流几何与年尺度气候筛选，不模拟逐月蓄水。
- 当前生成结果与约束以源码、测试和 [世界数据契约](WORLD_DATA_CONTRACTS.md) 为准；算法细节和历史对照见 [技术设计参考](TECHNICAL_DESIGN.md) 与各项 [基准记录](benchmarks/)。

## 最近工作与验证

2026-11-21，古典羊皮纸默认打开国界、国名、城镇符号和城镇名，颜色改成墨棕与朱砂，沿用楷体注记。没有文明数据时这些图层仍不绘制。样式与默认图层变化，不改世界事实、数据源或公开样式字段。**本次未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-21，政区图默认关闭地表。无归属陆地纳入政区填充，使用不透明暖灰 `#6f6a64`，与浅蓝海洋垫底色区分；海洋继续用风格垫底色。无归属地使用可追踪的正分组，避免被多边形追踪丢掉后露出海洋底色。`polity-territory` 适配器版本升为 `polity-territory-v3`。

2026-11-21，湖泊轮廓改为与国界线同一套共享边界平滑。湖岸若与国界或海岸重合，顶点直接采用那条边的结果，避免两套曲线之间露出底图。`lake-polygons` 适配器版本升为 `lake-polygons-v2`。

2026-11-21，初始文明社会尺度改用固定物理面积：沿用旧 L6、半径 6371 km 的校准口径（每个参考格约 12,453 km²），聚落候选门槛、数量、间距、人口与等级不再直接由输出 Mesh 单格面积/格数决定；高分辨率聚落从物理腹地向所在格守恒转移人口。交通、文化、政体/宗教采用同一参考行进速度，政体规模由实际领土 km² 判定。相应阶段升为 `population-settlements-v2`、`transport-network-v3`、`peoples-cultures-v2`、`polities-religions-v2`，旧快照保留原事实；Schema 和公开配置不变。新增同面积不同网格粒度的聚落/人口回归用例；**本次未运行 test/typecheck/lint/build、固定 Seed 新旧版本对照或高等级性能检查**。自然模型本身的网格差异仍可改变可居住面积与选址，低分辨率无法表达亚格地理细节。

2026-11-21，交通阶段升为 `transport-network-v2`：陆路、海路及可达性搜索按每轮标记跳过已处理区域，防止旧堆条目重复消耗目标名额；候选成本在比较、保存和入队前统一为 Float32 精度。交通与下游文化/政体/宗教生成结果可能变化，上游自然、资源、宜居性与人口聚落缓存保持可复用；Schema 4 和公开函数签名不变。新增陆路/海路回归用例，覆盖目标先经较贵路径入队、随后被更便宜路径更新时仍能找到不同目标，以及路径成本、搜索范围、孤立聚落和确定性。**本次仅静态审阅，未运行 test/typecheck/lint/build 或浏览器验证；固定 Seed `m2-civilization-seed` 的 v1/v2 生成对照与高等级性能/新增工作内存复验尚未执行。** 下方 M2 验证属于 v1 历史记录，不代表 v2 已验证通过。

2026-11-20，完成 M2 Batch 4（`apps/web` 编排、UI 联调与单测）：
- Worker / 协议 / 控制器：`runtime.ts` 切换为 `createWorldPipeline`，支持传入 `civilization` 参数并在仅变更文明参数时复用自然与资源链缓存；`protocol.ts`、`controller.ts` 与 `builtin-content.ts` 接入文明配置透传、单实体只读查询（`queryWorldPeople`/`Culture`/`Religion`/`Polity`/`Settlement`/`TransportRoute`）以及 `PolityArchetype` / `ResourceDefinition` 等内容原型查询与翻译。
- HUD 与视图状态：`ParameterPanel.svelte` 新增“初始文明”开关与人口规模、聚落密度、国家凝聚度调节；`GenerationLoading.svelte` 补充 M2 阶段进度文案；`LayerPanel.svelte`、`LegendPanel.svelte` 与 `layer-statistics.ts` 接入 `political-atlas` / `population-economy` 风格、“资源与文明”6 个专题、5 个文明覆盖层与 `hasResources`/`hasCivilization` 能力门控；`OverviewPanel.svelte` 与 `RegionInspector.svelte` 展示矿点、总人口、聚落、文化、宗教、政体制度与拾取命中实体；`share-link.ts` 升至 `#w=10.`（不保留 v9 兼容），`zh-CN.json` / `en.json` 补齐中英文翻译。
- 补充单测：`apps/web/src/workers/runtime.test.ts`、`apps/web/src/lib/generation/controller.test.ts`、`apps/web/src/world-view/layer-statistics.test.ts` 与 `apps/web/src/ui/hud/share-link.test.ts`。
- **本次验证结果**：
  - 全仓 `bun run typecheck` 通过（`world-data`、`world-core`、`cartography`、`web` 均 0 errors）。
  - 全仓 `bun run test` 通过（`world-data` 5 文件 59 项、`world-core` 33 文件 207 项、`cartography` 7 文件 26 项、`web` 7 文件 39 项，共 52 文件 331 项）。
  - 全仓 `bun run build` 通过（4 个 workspace 均正常构建，含 `apps/web` Vite 生产构建与 Worker 打包）。
  - `lint`：`packages/world-core`、`packages/cartography` 整包 `eslint` 通过，本次新增/修改文件经定向 `eslint` 检查通过；仓库既有测试文件 `packages/world-data/src/catalog.test.ts`（第 34 行）与 `apps/web/src/lib/generation/naming-content.test.ts`（第 80、82 行）存在预存 `regexp/*` 规则报错（本次未触碰）。
  - **未运行**：Playwright 浏览器端到端测试（`test:browser`）与手工交互走查尚未运行。

2026-11-20，完成 M2 Batch 2（`world-core` 资源与初始文明生成 Stage DAG）：新增 `resource-potential`、`habitability`、`population-settlements`、`transport-network`、`peoples-cultures`、`polities-religions` 六个确定性 Stage 与 `UniqueNameAllocator`、`createWorldPipeline`，并将 `assembleWorld` 扩展为同时装配完整自然世界与资源/交通/文明实体（`m2-world-v1`）。已补充可复现性、局部缓存失效（调整文明参数 100% 命中自然链缓存）、开关关闭、全实体不重名及 Schema 4 校验/归档往返测试。**已运行全仓 `typecheck`（`world-data`、`world-core`、`cartography`、`web` 均通过，0 errors）与全仓单元测试（`world-data` 5 文件 59 项、`world-core` 33 文件 206 项、`cartography` 6 文件 23 项、`web` 6 文件 32 项，全部通过）；本次未运行 `lint`、`build` 或浏览器验证。**

2026-11-20，完成 M2 Batch 1 契约与内容改造：统一 `world-data` / `world-core` 的 `Polity`（`PolityArchetype`、`polities`）与 `People` 命名，移除 `GovernmentArchetype` / `governments` / `pack.states`；升级 `WorldSnapshot` 至 Schema 4（新增 `nature.resources` 与 `civilization.transport`，拒绝旧 Schema 1–3 档案）；将 `natural-world.ts` 更名为 `world-assembler.ts`（`assembleWorld` / `WorldIdentity`）；扩容中英文命名词库（含 `people`/`culture`/`religion`/`polity` 规则），将宗教拆分为独立中英文社会候选包（`religions-zh-cn.json` / `religions-en.json`）并在 `core` 包补全 7 种自然资源定义；默认生成目录切换为中文内容包。已纳入上述全仓 `typecheck` 与 `test` 验证通过。

2026-11-20，C0 升为 `climate-c0-v22`：风与洋流从参考场多源重采样到输出切平面，洋流保留海陆、同水体与缺测约束；查询和月度快照字段使用同一重采样结果。按固定 Seed 1024/L7、42/L6 的面积加权分布调整风速／流速色阶，月／年、地图／图例／统计共用断点。Schema 3 不变，既有存档不重算环流。实际运行了两组 C0 数据分析及其阶段领域校验；新增测试未执行，未运行 test/typecheck/lint/build 或浏览器验收。新增季节数组内存与 L8 峰值仍需复验。详见 [环流显示分析](benchmarks/M1.2-circulation-display.md)。

2026-11-18，`world-data` 新增六份可独立加载的双语社会候选包及解析、适配、导出契约。国家形态候选各含 20 组中英文配对定义；文化显式依赖同语言 NamingStyle。它们只进入完整 Catalog，不改变当前自然生成内容签名，也不生成文明实体。

本次文档整理没有运行 `test`、`typecheck`、`lint`、`build` 或浏览器验证。近期其他验证属于各自历史记录，不代表本次检查通过。

2026-11-18，大陆与大洋命名改为 `geographic-names-v4`。两类专名不能重名；首选名被占用时从尚未使用的候选中另选，不再追加“二”等序号。候选不足时命名阶段失败。未冲突的首选名仍由原来的模板抽取决定。已保存的 `geographic-names-v3` 档案按档案中的名称恢复。修复 Check 流水线时已运行 typecheck、lint、单元测试和 Web 生产构建，均通过；未运行 Playwright 浏览器测试，也没有固定 Seed 全图对照。

## 查阅与更新

- 每个任务先读本页；随后只读与改动范围直接相关的契约和设计章节。
- 只有当前能力、待办、已知限制或验证结论变化时才更新本页。公开契约或架构变化同步更新对应文档；局部实现、样式和文案调整无需写进进度。
- 逐次改动细节不追加到本页；确有追溯价值时写入相应基准或专项文档。

相关文档：[技术设计](TECHNICAL_DESIGN.md) · [世界数据契约](WORLD_DATA_CONTRACTS.md) · [生成管线](GENERATION_PIPELINE.md) · [M1 实施计划](M1_IMPLEMENTATION_PLAN.md) · [制图系统设计](Cartography-System-Design.md)
