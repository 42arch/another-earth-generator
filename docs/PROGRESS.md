# Another Earth — 当前进度

> 更新：2026-11-23。这里仅记录当前能力、未完成事项和最近验证状态。产品目标见 [PRD](PRD.md)；完整历史记录见 [进度历史快照](PROGRESS_HISTORY.md)。

## 当前状态

项目默认交付范围为 M0–M4。当前已具备自然世界生成、资源潜力与初始文明（人口、聚落、交通网络、族群、文化、宗教、政体）生成与发布、3D/2D 地图工作台和静态世界内容；浏览器项目存储尚未交付。

| 范围 | 状态 |
| --- | --- |
| `world-data` | 内置自然生成内容、双语命名风格（v1.5.0 中文 / v1.2.0 英文，含 `people`/`culture`/`religion`/`polity` 与扩容后的 `settlement` 规则）、八份双语 `peoples`/`cultures`/`polities`/`religions` 社会候选包、独立双语国家特征目录及内置自然资源定义；默认生成目录优先加载中文内容包。 |
| `world-core` | L0–L8 球面网格、自然生成 Stage、资源/宜居性/人口聚落/交通网/族群文化/政体宗教 M2 生成 Stage 与 `createWorldPipeline`、Schema 11 `WorldSnapshot`（含 `nature.resources`、`civilization.transport`、`civilization.territoryPolityIndex`、聚落 `features` 与政体 `traits`）、世界组装/校验/发布、只读查询和 M0 JSON 档案编解码（拒绝旧 Schema 1–10 档案）。 |
| `cartography` | 3D Globe、三种 2D 投影、自然与文明/资源数据源（27 个内置数据源）、样式编译、七套预设（含政区图 `political-atlas`；人口密度与交通航路为独立专题/覆盖层）、统一拾取（含 `entityId`）与地图会话。 |
| `apps/web` | Worker 完整世界生成与发布、3D/2D 地图、自然与资源/文明专题图层及能力门控、图例统计、区域与文明实体探测、概览统计、生成参数分享链接（`#w=15.`，含文明参数）、默认中文生成内容注入；无浏览器项目持久化或世界档案导入界面。 |
| M2 初始文明 | Batch 1–4 已实现；CIV-01 A/B/C 已接入；C 批四预设、默认人口尺度校准及 L6/L7/L8 冷启动实测已完成，验证范围见下方。 |
| M4 项目存储 | 未实现。IndexedDB/OPFS、项目恢复和完整世界档案导入导出尚未接入。 |
| M5+ | 动态文明、编辑器和历史分支不在当前交付范围。 |

## 当前自然链

当前阶段基线为 `terrain-v27`、`climate-c0-v22`、`cryosphere-i0-v1`、`hydrology-h0-v4`、`static-lakes-l1-v10`、`ecology-e0-v3`，完整世界生成链在此之上串联 `resource-potential-v1`、`habitability-v4`、`population-settlements-v5`、`transport-network-v4`、`peoples-cultures-v4`、`polities-religions-v15` 组装并发布 Schema 11 快照；M1 已按用户决定收尾，未完成的验收项目保留为延期事项，不视为通过。

当前已知限制：

- C0、I0/H0/L1 与 E0 是可解释的初步模型，不代表地球尺度校准或动态水文/生态模拟。
- T0 地形形态与 C0 雨影专项仍延期。当前默认配置的 L6/L7/L8 核心生成峰值已实测；浏览器端高等级总峰值、参数极值与完整性能矩阵尚未覆盖。
- 静态湖泊使用 Priority Flood 溢流几何与年尺度气候筛选，不模拟逐月蓄水。
- 当前生成结果与约束以源码、测试和 [世界数据契约](WORLD_DATA_CONTRACTS.md) 为准；算法细节和历史对照见 [技术设计参考](TECHNICAL_DESIGN.md) 与各项 [基准记录](benchmarks/)。

## 最近工作与验证

2026-11-24，羊皮纸国界由深墨 `#3b2816` 调成浅棕 `#6f5642`。注记和聚落仍用深墨。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-24，羊皮纸风格可以点选国家领土。这套样式只画墨线国界、不铺政区填色，点在国土内部原先落不到面上。现在国界开关会带一块完全透明的政区拾取，点中国土会高亮整块国家；点在国界线上仍选中边界。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-24，2D 与 3D 注记都再缩小约 15%。2D 按样式字号的 0.85 倍绘制，3D 在原先 1.15 的屏幕系数上按同样比例缩小。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-24，政区图只改了颜色：国家领土改为低饱和填色，海洋垫底和地表海洋改为湛蓝，国界由近黑改为中灰 `#5c6b7a`。河湖、注记、晕渲、默认图层和经纬网保持原样。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-24，地图选中改为高亮点到的要素本身，不再于格子中心加圆点。线要素描边；面要素（含国家政区）只用半透明填色盖住整块区域，不描球面分块接缝。地名、国家名和聚落名不再参与拾取。没有矢量要素的底图或栅格专题仍只描出该格轮廓。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-23，国家探针补上按领土汇总的人口、面积、密度，以及首都、城市、城镇、村落、港口数量和人口最多的聚落。这些数字不写入政体记录，点击时由领土索引、区域人口和聚落归属现算。**未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-23，区域探针改为只显示本次点击命中的图层。矢量或可点选填色（河湖、地名、聚落、政区、板块等）优先；点在空白处时显示当前专题在该点的读数，未开专题时只保留地表的海陆、高程、坡度和单元面积。切换专题会更新上一次空白点击的读数，已命中的矢量保持到下一次点击。浏览器中核对了地表、年平均气温，以及气温图层上点到大陆名称时只显示地名。**未运行 test/typecheck/lint/build。**

2026-11-23，CIV-05 政体内容权重：中英文政体包升至 **1.4.0**，将原先 20 种候选全部等权改为通用形态与特殊形态分级；王国/共和国基础权重各 3，王朝制君主国/联邦各 1.5。补齐君主形态对王朝贵族特征的偏好，移除王朝制君主国受公民议政降权，王国兼容公民议政与地方分权。小面积和神权必需特征继续严格执行。仅改内容，`polities-religions-v15` / Schema 11 / 分享 v15 不变，不设政体数量配额，也不声称按历史比例校准。

四预设×三个 Seed/L6，外加独立 Seed 和实际 Web 默认 L7，共 14 组修改前后对照通过完整快照校验。Web 默认 Seed 1024 的王国 **2→8**、王朝制君主国 **0→6**；君主分组总数 **17→16**，不宣称所有 Seed 的总数增加。人口、逐格领土、首都 ID、国家特征与请求数量均保持一致；内容签名改变可能使新生成专名改变。内容包 35 项、Web 28 项，共 **7 文件 63 项**定向测试通过，内容包/Web 类型检查通过。完整权重表、全部对照和口径见 [CIV-05](benchmarks/CIV-05-polity-weights.md)。**未运行核心/制图包单测与类型复验、build、lint、浏览器或全仓验证；L7 为行为诊断，不是性能复验。** 旧世界须重新生成采用新内容。

2026-11-23，CIV-04 小面积统一为国家特征：`polity-traits.json` 新增 `small-area`（小面积），目录升至 1.1.0，新增 `territory` 维度及按规模派生的 `sizeClasses` 条件。自由领地、酋长领、自治公社和城邦改用 `requiredTraits: ["small-area"]`，内置政体包升至 1.3.0，不再重复配置 `allowedSizeClasses`。后者仍保留为可选通用内容契约。`polities-religions-v15` 在划界后、政体匹配前按实际陆地面积附加领土特征；原三维制度/经济特征与扩张规则不变，小面积不占其槽位。所有符合门槛的国家均显示“小面积”徽章。完整发布校验拒绝缺失或伪造领土特征及规模。Schema 升至 **11**（拒绝旧 1–10），分享 v15 不变。

三个 Seed/L6/1、60、200 国的 9 组诊断通过完整快照校验、确切国家数、面积/特征一致性及四类政体必须具备小面积特征检查。核心 112 项、内容包 34 项、Web 28 项，共 **18 文件 174 项**定向测试通过；核心/内容包/Web 类型检查通过，Svelte 无错误或警告。新数据与规则见 [CIV-04](benchmarks/CIV-04-polity-size.md)。**未运行 build、lint、全仓测试、浏览器、制图包或 L7/L8 性能复验。** 下方 v14 与更早验证为历史记录。

2026-11-23，CIV-04 小面积政体约束：内置中英文政体包升至 1.2.0，自由领地、酋长领、自治公社和城邦以 `allowedSizeClasses: ["city-state"]` 限定为小面积候选。`polities-religions-v14` 按实际陆地面积归类，移除“仅一座聚落也算城邦”的豁免；沿用不超过 3 个参考面积（约 3.74 万 km²，不含海面和湖面）的门槛，硬约束不能被特征偏好绕过。完整发布/归档校验从权威归属重算规模，伪造规模也会拒绝。保持先划界后选择合格政体，国家数不变；不保证每种政体出现。Schema 10 / 分享 v15 不变，旧世界须重新生成采用新结果。

生产内容/三个 Seed/L6 的 1/60/200 国共 9 组修改前后对照通过完整快照校验，修改后四类政体面积超限数全部为零，实际国家数始终等于请求数。核心 112 项、内容包 29 项、Web 28 项，共 **18 文件 169 项**定向测试通过；核心/内容包/Web 类型检查通过。方法、原始数据、兼容边界见 [CIV-04 验收](benchmarks/CIV-04-polity-size.md)。**未运行 build、lint、全仓测试、浏览器、制图包或 L7/L8 性能复验。** 下方 CIV-03 为 v13 历史验证。

2026-11-23，CIV-03 国家数量与面积差异：移除 `polityDensity`，新增 `polityCount: number`（1–200 整数、默认 60）与 `politySizeVariation`（0–1、默认 0.5）。Web 使用单个步长 1 的国家数量滑杆；核心直接生成选定数量，不随机抽取总数。先前误实现的 min/max 区间对象已移除并明确拒绝。可用独立陆地聚落不足时报告实际可行数量并保留旧世界，无人口时仍允许空文明。首都含孤岛在同一预算内确定，不在划界后追加岛国；没有本土国家且不可跨海的地区可无主。预设数量按默认 60 沿用 CIV-01 比例，农耕/城邦/王国/近代分别为 60/108/36/60。

`polities-religions-v13` 沿用面积差异目标与每国独立成本前沿；面积不含湖面和海面，受岛屿、格网与阻塞约束，不保证精确面积配额。数量和面积参数仅使末阶段失效。快照为 **Schema 10**（拒绝旧 1–9），分享为 **v15**（拒绝旧 v14 及更早）；旧区间及倍率均不迁移。当前生产内容/L6/三个 Seed 的 15 组诊断准确生成 1/60/200 国，面积差异对照、缓存、人口、首都/特征独立性与 3 次完整强制重算均通过。核心 11 文件 111 项、Web 6 文件 49 项，共 **17 文件 160 项**定向测试通过，核心/Web 类型检查通过；验证范围见 [CIV-03 验收](benchmarks/CIV-03-polity-layout.md)。**未运行 build、lint、浏览器、全仓测试、制图包复验或 L7/L8 性能复验。** 旧 v12 的 15 组诊断与 157 项测试只作为历史结果保留，不计入当前版本验收。

2026-11-22，`polities-religions-v11` 修正 v10 的分权塌缩。实测生产内容/默认参数/L6（参考 L6），v10 在 Seed 1024/42/m2-civilization-seed 分别有 21/21、21/22、20/22 个分权国家；主因是把首都占全部腹地人口的低比例当作分权，并把相近商业/生产分数的比值夹到 1 后普遍抑制集权。v11 改为比较首都与最强地方中心，用商业相对生产的正差表达特化，不再用商业普遍压低集权；权力候选按条件支持度以稳定 Seed 加权抽取，零分禁用，不设类型配额，游牧须有牧业主导的本地依据。其余阶段沿用 v8 随机流，权力选择使用独立 fork；Schema 8 / 分享 v13 不变，需重新生成才采用新结果。

同配置 v11 的集权/分权/城邦数量依次为 **4/13/4、6/14/2、8/12/2**；额外 Seed civ-validation 为 **8/10/5**。四个 Seed 均通过完整快照校验及诊断重放的政体/聚落/领土一致性检查，1024 独立重跑一致，输入配置/内容签名/上游版本一致。增加逐国只读评分诊断与 `bench:civilization:traits`，详见 [CIV-02 特征分布对照](benchmarks/CIV-02-trait-distribution.md)。定向验证通过：核心文明/快照/查询 10 文件 93 项、数据包 6 文件 62 项、Web 编排/Worker/查询统计 5 文件 37 项、制图数据源 1 文件 6 项，共 **22 文件 198 项**；四包类型检查通过。修正先前未执行夹具中的只读数组赋值、TypedArray 对象映射、相邻功能串扰、政体包依赖和 Worker 内容清单；行政竞争夹具适配宗教/国家特征共同作用后的边界。**未运行 lint/build、浏览器、高等级性能、完整全仓测试或其他预设的世界级分布验收；当前比例仍是创世启发式结果，不代表历史校准。**

2026-11-22，国家特征内容配置化：新增 `world-data/data/society/polity-traits.json`（`builtin-polity-traits@1.0.0`），统一定义 15 种语言无关 ID、三维分类及中英文名称/说明；中英文政体包升至 1.1.0，显式依赖特征目录，以 `requiredTraits` 和 `traitAffinities` 声明约束与组合偏好。核心移除按政体形式硬编码的特征匹配，`polities-religions-v9` 沿用 v8 随机流，增加神权国必须具备政教合一的约束与无候选显式失败；新目录、约束和偏好进入内容签名。快照发布检查目录引用、维度互斥和政体要求；Web 徽章统一从内容目录读取名称和悬停说明。城镇特征保持核心评分与 Web 翻译；Schema 8 和分享 v13 不变，旧快照仍需匹配其记录的内容包版本与哈希，不提供内容迁移。新增/调整内容、核心、快照和 Web 回归用例。**本次仅静态审阅，未运行 test/typecheck/lint/build、固定 Seed v8/v9 对照、性能或浏览器验证。**

2026-11-22，实现 CIV-02 城市特征与国家特征系统（详见 [CIV-02 设计说明](CIV-02-polity-traits-design.md)）：`Settlement` 新增 `features: readonly SettlementFeatureId[]`（12 种、1–3 项），`Polity` 新增 `traits: readonly PolityTraitId[]`（3 维 15 种、2–3 项）；`WORLD_SCHEMA_VERSION` 升至 **Schema 8**（拒绝旧 Schema 1–7 档案），`peoples-cultures` 升至 `peoples-cultures-v4`（暴露 `hearthRegions`，沿用 v3 随机流），`polities-religions` 升至 `polities-religions-v8`（宗教前移 → 社会能力门控与演替驱动的城市特征评分 → 首都选址 → 首都与局部腹地涌现国家特征 → 特征调制领土扩张/孤立大岛建国/远洋港口投送 → 特征对齐政体原型与聚落/人口收口）。共享参数与分享链接 `#w=13.` 保持不变；Web 区域探针（`RegionInspector.svelte`）已接入聚落特征与政体特征双语徽章，已补充 `civilization-traits.test.ts` 与相关回归用例，静态诊断无报错。**本次未运行 test/typecheck/lint/build、固定 Seed 对照或浏览器验证。**

2026-11-22，重调四套社会背景预设与默认文明参数，使各情景差异更清晰并保持独立轴不被覆写：`DEFAULT_CIVILIZATION_PARAMETERS` 将 `urbanConcentration` 由 0.5 调为 0.65、`capabilities.administrativeCapacity` 由 0.6 调为 0.75，四个 1× 生产/运输能力维持不变（保留约 1900 年人口校准基线）；Web 四套预设同步重调（农耕聚落 `0.25/0/0.25/0.05/0.20` + 密度 0.45 / 聚居 0.10 / 国数 1.00，城邦商贸 `0.55/0.10/0.50/0.70/0.40` + 密度 1.15 / 聚居 0.55 / 国数 1.80，区域王国 `0.70/0.20/0.65/0.45/0.45` + 密度 0.80 / 聚居 0.35 / 国数 0.60，近代工业商贸与核心默认一致）。切换预设与预设匹配均忽略 `enabled`、`populationScale` 与 `culturalDiversity`，避免切情景冲掉用户设置。因分享链接采用相对默认值的差量编码，分享格式升至 `#w=13.` 并拒绝旧 `#w=12.`；Schema 7 不变。已更新单测与 E2E 用例。**本次未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-22，政体宗教升为 `polities-religions-v7`，将固定约 112 km 的近岸补全升级为能力驱动的海洋领土投送，并新增孤立有人大岛的本土岛国规则。`polities-religions` 显式读取 `capabilities.seafaringCapability`（不增加额外上游缓存失效）：第一轮由已归属海岸在 `seafaringCapability` 与 `administrativeCapacity` 决定的近海预算内投送（含预算内跳岛）；第二轮为仍无主、面积不小于 4 个参考格或含至少 2 座命名聚落的孤立有人大岛在最高评分聚落建立本土岛国（受间距与数量上限约束）；第三轮由已归属港口优先（普通海岸带偏置兜底）在随 `seafaringCapability` 与 `administrativeCapacity` 增长的远洋预算内投送，使默认近代配置下几乎全部岛屿获得归属，零航海不跨海、低航海自然保留远洋无主岛。Schema 7、分享 v12 与上游自然/人口/交通/文化不变；已补充合成图与集成回归用例。**本次未运行 test/typecheck/lint/build、固定 Seed 对照或浏览器验证。**

2026-11-22，国家名称在专名后接上政体显示名，中文为「维兰共和国」这类写法，不含汉字时在中间加空格。`polities-religions` 升为 v6，随机流仍用 v5，领土与人口不变。地图注记、探针和统计都读这个名称。旧世界保留原名，重新生成后才更新。**本次未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-22，国界改为沿用湖泊已有的土地归属。本国境内的湖泊不再因为被排除在归属之外而沿湖岸画一圈虚线国境；两国在湖岸相接时仍画实线。政区填充继续不把湖泊涂进领土。`polity-borders` 升为 v4。湖岸不再锁到这条已删除的虚线上，内陆湖轮廓改为自行平滑，与真实国界或海岸重合的边仍共用顶点，`lake-polygons` 升为 v3。**本次未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-22，CIV-01 C 批完成：新增农耕聚落、城邦商贸、区域王国、近代工业商贸四种完整参数预设，默认对应近代配置；Web 拥有预设表，核心只读有效数值。选择不自动生成，保留 Seed/自然参数，按有效值识别预设与自定义，分享刷新后重识别；文化多样性独立于发展阶段。Schema 7、分享 v12、参数范围与默认数值不变。

默认背景以约 1900 年为人口尺度参照。`habitability-v4` 将承载密度系数从 145/45 调到三 Seed / L5 联合拟合并取整的 22/7；自然字段、供给约束和人口守恒策略不变。按相同地球陆地面积折算，训练均值由约 110.98 亿降至 16.84 亿（相对 16.5 亿参照 +2.05%），独立 L6 留出样本 18.36 亿（+11.28%）。这只校准默认承载人口的全局尺度；聚落数/城市规模/城市化率/交通速度/国家文化数未按历史拟合。旧世界人口事实保留，重新生成后采用新系数；派生承载力仍使用当前算法，不支持旧算法回放。

实测生产内容与默认文明 / 参考 L6，Apple M3 Pro / 18 GiB / Bun 1.4.3：L6/L7/L8 各三次独立冷进程，包含 Pipeline、快照复制装配及完整领域校验。耗时中位数分别 **3.03 / 7.57 / 26.75 秒**；三次最大峰值 RSS 分别 **0.47 / 1.00 / 3.84 GiB**。九份快照均有效，同等级关键事实指纹一致。此数据不含浏览器 Worker 传输、旧/新快照并存与制图/GPU 内存，不代表所有配置上限。`time -l` 初次采集被沙箱的系统读取限制中断，改用 `process.resourceUsage().maxRSS` 后完成正式矩阵，未将失败尝试算作验证通过。

本轮验证：受影响三个包的单元测试通过（核心 39 文件 259 项、Web 8 文件 47 项、制图 8 文件 32 项，共 **55 文件 338 项**）；全仓类型检查与构建通过，构建仍有既有大 chunk 提示。修改文件及新基准脚本定向 lint 通过。16 组 L4 参数/守恒/缓存对照在 v4 下重跑通过，B 批 v3 原始数据独立保留。系统 Chrome 的定向 Playwright **3 项通过**，覆盖四类预设中默认/农耕/王国的界面选择、完整赋值、自定义识别、真实 Worker 生成、行政单独重算、分享刷新恢复和旧链接拒绝。没有重跑 world-data 单测、整仓 lint、完整旧版 E2E、其他设备或参数极值性能；上轮既有 lint 错误见 B 批记录。

复现：`bun run --cwd apps/web bench:civilization:calibration`、`bench:civilization:performance`；数据、来源、完整参数及口径见 [CIV-01 校准与性能](benchmarks/CIV-01-calibration.md)、[校准 JSON](benchmarks/CIV-01-calibration.json) 和 [性能 JSON](benchmarks/CIV-01-performance.json)。

2026-11-22，CIV-01 B 批完成：新增聚居倾向（0–1，默认 0.5）、国家数量倾向和文化多样性（0.5–2×，默认 1×）；原 `polityCohesion` 移除，改为 `capabilities.administrativeCapacity`（0–1，默认 0.6）。聚居强度调节募集比例与范围，保留供体至少 44% 和总人口守恒；国家数量单独控制首都目标及间距，行政能力只改变跨文化/跨海整合代价和政体偏好；文化多样性控制起源数量和间距，最大起源预算随倍率调整到 24。对应阶段升为 `population-settlements-v5`、`peoples-cultures-v3`、`polities-religions-v5`。参数已贯通控件、Worker、归档与分享；Schema 7 / `#w=12.`，拒绝旧 Schema 1–6、旧分享链接和原凝聚度字段，不迁移。C 批当时未实施，现状见上方。

B 批历史验证：全仓单元测试通过，world-data 59、world-core 258、cartography 32、web 44，共 59 文件 393 项；全仓 `typecheck` 和 `build` 通过。修正两个流量测试夹具的 Float64 类型、政区适配器的可空比较，以及制图测试中的 GeoJSON 类型收窄。核心包整包 lint 通过；本次修改的 Web/制图文件定向 lint 通过。制图整包 lint 仍有未改的 `symbol-layer.ts:1002–1014` 7 项缩进报错，Web 整包 lint 仍有未改的 `naming-content.test.ts:80/82` 3 项正则规则报错；没有为通过 lint 修改这些无关文件。Web 构建保留大 chunk 提示。

固定 Seed `m2-civilization-seed` / L4 / 参考 L4 的 16 组对照通过完整快照装配校验，自然与资源链缓存均可复用。国家数基准 22、低/高倍率 11/43；文化数基准 12、低/高倍率 6/24；聚落人口占比低/高约 0.64%/2.23%，总人口均为 9,314,566,552；行政低/高改变 13/62 个归属索引但国家数仍为 22；航海 0× 海路为零。采用核心测试内容，结果用于行为对照，不代表历史人口校准或性能结论。命令 `bun run --cwd packages/world-core bench:civilization`，数据见 [B 批 v3 参数对照](benchmarks/CIV-01-parameters-habitability-v3.json)，当前 v4 记录见 [参数对照](benchmarks/CIV-01-parameters.json)。系统 Chrome 的定向 Playwright 两项通过：真实 Worker 生成与参数传递、行政单独调整只重算政体宗教、分享刷新恢复，以及旧链接拒绝且不自动生成；测试固定 zh-CN 并使用精确角色/标签定位，初次环境与定位失败已修正后复跑。命令为 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run --cwd apps/web test:browser e2e/civilization-parameters.spec.ts --workers=1`。B 批当时未运行完整旧版 E2E 套件、原算法版本对照、L7/L8 性能/内存矩阵或历史拟合；本轮补充范围见 C 批。


2026-11-22，CIV-01 A 批完成代码接入：新增农业生产、工业利用、陆运、航海四项能力，均默认 1×；农业/陆运范围 0.25–2×，工业/航海为 0–2×。增加统一参数解析与严格校验，省略字段补默认，显式非法值拒绝；Pipeline 在签名前解析，装配保存独立完整配置。`habitability-v3` 由农业能力调节食物承载、工业能力调节能源与矿产组合、陆运能力调节陆地供给衰减范围；`transport-network-v4` 在固定参考行程预算下调节陆运/航海速度，航海 0× 跳过海路。地图查询读取快照保存的能力，并修正物理半径取值为 `planet.physicalRadiusKm`。Web 增加四个基础控件、双语文案与 Worker 配置透传，分享链接升为 `#w=11.`，快照升为 Schema 6（拒绝旧 Schema 1–5 档案与旧版分享链接，不迁移）。只改航海时复用宜居性/人口缓存；生产或陆运变化从宜居性向下重算，自然与资源链可复用。新增参数、能力效果、缓存、归档查询一致性和分享链接回归，扩展 Worker 用例；**本轮先完成 A 批验证：核心 248、Web 40、制图 32 项测试通过，修正类型问题后核心/Web 类型检查及 Web 构建通过。** 后续 B 批的全仓与参数对照结果见上方，当前仍为静态潜力模型，无跨海供粮或产业演化。


2026-11-21，默认定居模型改为以 1850–1900 年技术条件为参照的 `habitability-v2`，人口聚落升为 `population-settlements-v4`。淡水与温度形成环境上限，去掉海岸供水、临海荒漠减罚及海岸承载固定奖励；农业和渔业提供食物，已保存矿点的矿产/能源类别与丰富度产生经济机会，木材可作有限燃料替代。食物和矿产机会沿陆地按物理距离及通行阻力衰减，资源组合还须有供给与通达条件才能提高承载与定居分。港口改用淡水/岸坡/遮蔽代理，选址取消沿海、河口及资源的重复加分，保留数量、间距和守恒迁入策略。地图查询同步使用矿点与物理网格，探测器改称“定居适宜度”。公开生成函数扩展 Mesh/矿点/港口代理输入，新增三个阶段分项字段；Schema 5 不变。旧人口和聚落不自动重分配，但派生宜居性按当前算法查询，重新生成后才与新人口模型一致。新增 9 项模型回归并扩展地图查询一致性、既有聚落用例；**仅静态审阅，未运行 test/typecheck/lint/build、固定 Seed `m2-civilization-seed` 的旧/新模型对照、浏览器或高等级性能/内存检查。** 参数尚未历史拟合，无跨海供粮、真实贸易流量/粮食供需守恒、矿种工艺或铁路演化；详细公式和校准限制见 [生成管线](GENERATION_PIPELINE.md)。

2026-11-21，政体宗教升为 `polities-religions-v4`，修复近岸岛屿仅一小部分有归属的问题。约 112 km 门槛改为只限制跨海水程（海陆相邻中心连线计一半，海洋相邻连线计全长），抵达后沿无主陆地及湖泊格完整扩张，不设岛内距离上限。多国按跨海加岛内距离竞争，已有归属保持不变；新岛不作为跨海起点，避免岛链接力扩张，海洋仍无主。水程是网格近似，临界海峡仍受网格精度影响。Schema 5、公开配置和上游人口/交通/文化不变，已存快照不自动修正，需重新生成。新增 8 项合成图回归用例，覆盖完整登岛、多国竞争、相等代价确定性、多格海洋的门槛、岛链和原归属保护。**仅静态审阅，未运行 test/typecheck/lint/build、固定 Seed `m2-civilization-seed` 的 v3/v4 对照、浏览器或高等级性能/内存检查。**

2026-11-21，政体宗教升为 `polities-religions-v3`，世界快照升为 Schema 5，新增 `civilization.territoryPolityIndex`。有首都的陆块上，空地和湖泊不再挡住扩张，全部划入到达代价最低的国家，不再设行程上限。该版近岸补全误将登岛后的陆地路程计入约 112 km 上限，且未继续覆盖全岛，后由 v4 修正。海洋不能有归属。政区填充和国界改读这块土地归属，湖泊不再画进政区、也不再沿湖岸绕一圈。`polity-territory` 适配器升为 v4，`polity-borders` 升为 v3。旧 Schema 1–4 档案拒绝读取，不迁移。人口、聚落和文化人数不变。**本次未运行 test/typecheck/lint/build 或浏览器验证。**

2026-11-21，人口聚落升为 `population-settlements-v3`。选址分把迁入比例从 16% 线性拉到 56%，目标人口为当地密度乘参考支撑面积再乘该比例；搜索只沿陆地由近到远，最远到约 126 km 乘分数占比。每个供体格子单次最多交出当前比例、累计最多交出 56%，海岸上的海面不扣减目标。凑不满就按实际人数缩小，等级按结果人口划分。总人口仍守恒。交通、文化、政体规则不变，但会因人口字段变化而重算；旧快照保留原事实。Schema 和公开配置不变。已运行 `population-settlements.test.ts`（2 项通过）。**未运行全仓 test/typecheck/lint/build、固定 Seed 的 v2/v3 对照或浏览器验证。** 湖泊格子仍无人、无主，湖岸被画成国界的问题未改。

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
