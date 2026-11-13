# Generation Pipeline 与 Worker

2026-11-13 `geographic-regions-v3` 依赖 Mesh、Geology 和最终 Terrain，读取候选大陆来源与最终海陆掩码，无独立配置或随机流。阶段输出大陆、洋、海的区域索引和面积表；沿用 v2 的海岸距离/海峡收窄后的洋海等级，并在宽阔洋区内按离岸峰值间的通路收窄程度划分多个大洋，抑制小面积碎区。`geographic-names-v2` 依赖该分区产物，声明 `geographic-names` 内容签名，通过 `loadBuiltinGenerationCatalog()` 读取 `world-data` 的 `geography-zh` 大陆/大洋中文词库，以 Seed、稳定区域 ID、词库 ID 和内容签名确定性命名；同类重名使用中文序号。词库或命名版本变化只使名称阶段失效；T0/海陆变化使分区与名称阶段重算，不使气候、水文和生态重算。Worker 传输带名称的独立副本，完整自然世界组装时复制入快照。旧 `geography` 词库保留供历史档案解析。当前未运行缓存、Worker 或性能验证。

> 更新：2026-11-13。记录当前执行与缓存契约，不表示完整 M1 已完成。字段见 [世界数据契约](WORLD_DATA_CONTRACTS.md)，算法与后续设计见 [技术设计](TECHNICAL_DESIGN.md)和 [M1 实施计划](M1_IMPLEMENTATION_PLAN.md)。

## 公开入口

`@another-earth/world-core` 提供 `StageRegistry`、`GenerationPipeline`、`StageCache`、Mesh/Geology/Terrain/C0/Hydrology/Ecology Pipeline，以及 `createNaturalPipeline`、`assembleNaturalWorld` 和 `WorldStore`。Hydrology Pipeline 在 T0/C0 上生成 I0、H0、L1；Ecology Pipeline 从独立的 T0/C0 分支生成 E0 `ecology-e0-v3`。Natural Pipeline 合并两支但保持 E0 的独立直接依赖；只有完整结果经过装配与校验才可发布。E0 v3 的历史专项检查见 [E0 收尾记录](benchmarks/M1.4-E0-closeout.md)；M1.5 新链路测试已添加但本次未运行。

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
| terrain | terrain-v26 | mesh、geology、tectonics、tectonic-elevation |
| geographic-regions | geographic-regions-v3 | mesh、geology、terrain |
| geographic-names | geographic-names-v2 + 内容签名 | geographic-regions |
| climate-c0 | climate-c0-v21 | mesh、reference-mesh、geology、terrain |
| cryosphere-i0 | cryosphere-i0-v1 | mesh、terrain、climate-c0 |
| hydrology-h0 | hydrology-h0-v4 | mesh、terrain、climate-c0、cryosphere-i0 |
| static-lakes-l1 | static-lakes-l1-v6 | mesh、terrain、climate-c0、hydrology-h0 |
| ecology-e0 | ecology-e0-v3 | mesh、terrain、climate-c0 |

前七项组成地质 Pipeline；Mesh Pipeline 只有 mesh；Terrain Pipeline 复用地质 Registry，再追加地形、地理分区与地名 Stage。Climate Pipeline 再追加 C0；Hydrology Pipeline 复用该分支并添加 I0/H0/L1；Ecology Pipeline 另建 C0 Registry 并追加 E0。两条调试分支共享 StageCache 的可复用上游产物，但 E0 单独计划不包含任何水文 Stage。Natural Pipeline 在同一 DAG 中包含 I0/H0/L1/E0，E0 仍直接依赖 Mesh/T0/C0，水文参数变化不会使 E0 Stage 失效。

H0 缓存签名包含蒸散系数、基准汇水面积、河网密度倍率和公转周期；L1 包含最小湖泊面积、蒸散系数和公转周期。调整河网参数重算 H0 及其下游，调整湖泊面积只使 L1 失效；上游气候和地形产物保持可复用。

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
| hydrology.riverDensityMultiplier | [0.25,4]，默认 1 | H0 河道汇水面积门槛；高倍率降低门槛、增加候选河道 |
| hydrology.minimumRiverDrainageAreaKm2 | [0,1e9] km²，默认 5000 | H0 河道汇水面积基准 |
| hydrology.minimumLakeAreaKm2 | 非负有限 km²，默认 0 | L1 过滤较小洼地候选，不扩展湖泊边界 |
| 相机、配色、专题、线框 | ViewState | 不生成 |

roughness 可调纹理强度按 `(roughness/0.4)³` 响应。`terrain.glacialErosion` 与 `terrain.hydraulicErosion` 范围 [0,1]，默认 0.5，阶段内 km 转换前运行；水力参数进入处理器前统一乘以 0.5，冰川参数不缩放。当前不读取气候/降雨。旧 `continentalUpliftKm` 参数即便为零也在计划/执行前报错，包括全缓存命中。

I0 配置通过 `hydrology.snowTemperatureMinC`、`snowTemperatureMaxC` 和 `degreeDayMeltFactorMmPerCMonth` 进入签名；H0 读取蒸散系数、基准汇水面积、`riverDensityMultiplier` 和公转周期。河道阈值为 `max(minimumRiverDrainageAreaKm2, 16 × 平均网格面积) / riverDensityMultiplier`，并要求累计流量大于零。L1 直接读取 C0 与 H0，并按干旱气候年入流/湖面蒸散约束候选；`minimumLakeAreaKm2` 过滤小湖候选。调整河网倍率/基准会重算 H0 及下游，调整最小湖泊面积只使 L1 失效。

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

Worker/Controller 支持 Mesh、Geology、Terrain、C0、水文、E0 调试请求及带 `publication` 身份的完整自然世界请求。完整请求在 Worker 内从同一 DAG 装配 Schema 3 候选；阶段缓存继续拥有原数组，调试产物使用结构化副本，独立快照 Buffer 只转移一次。Controller 复核调试产物和快照身份，使用 `WorldStore` 完整校验候选，地图场景安装成功后才提交。失败、取消和传输错误保留最后已发布世界。M1.5 新测试已添加但本次未运行；当前 E0 历史 Chrome 证据不覆盖这条新链路。

只接收最新 requestId 的生成/拾取响应。硬取消终止重建 Worker，旧显示保留但缓存丢失；重新成功生成前禁用区域查询，防止旧画面和新 Worker 事实身份错配。失败、取消和传输错误不覆盖最后有效显示。页面销毁终止 Worker 并释放场景资源。

当前调试页面用单位球和颜色表达高程，不是正式世界查询/地图发布协议。月份、风格与图层的未来显示缓存也不得进入生成签名。

## 未来的气候、水文与侵蚀

当前顺序为 `T0（基础水力/冰川侵蚀） → C0 → I0 → H0 → L1`。I0 按月温度/降水计算线性雨雪分配、雪水当量储量与融雪；H0 用温度指数蒸散近似和 Priority Flood 生成径流、排水树、流域与阈值河段；L1 v6 将 `filledElevationKm > terrain.elevationKm` 的陆地区域分成连通洼地，只保留至少覆盖两个 Mesh 区域且不小于 `minimumLakeAreaKm2` 的静态湖泊。水位取成员区域的最大 Priority Flood 高程；溢流口取湖内指向外部路由区域的边界区。该水位只表示静态溢流几何，不等于水量平衡结果，也不改地形。湖泊 ID 由 Mesh ID 与成员最小区域索引构成。无海洋网格时，H0 内流根语义传至湖泊；它不表示存在海洋的行星已具备完整内流湖判定。旧 v4 Core/Web 检查、3 Seed × L4/L5/L6 基准见 [M1.3B 基准](benchmarks/M1.3B-static-lakes.json)，不覆盖当前 v6 参数与 climate 筛选。Priority Flood 长条洼地可能对应河谷或泛滥平原型潜在积水区，尚不能保证全部是气候意义上的湖泊。Playwright headless E2E 受 Chrome 进程启动失败限制。

E0 从与水文平行的 DAG 分支运行：读取 C0 的 12 个等时长气候箱和 T0 海陆/高程，对全部陆地区域（包括 L1 标记的湖泊成员及 H0 河道区域）依气候与地形分类；不读取 I0/H0/L1，不按水文成员跳过或覆盖分类结果。C0 年均温/年降水作为唯一年度统计来源。分类词表由 `world-data` 拥有；E0 不生成湿地/农业字段，也不修改地形、湖泊或海陆。雪冰分类是温度/降水启发式代理。C0 变化会使 E0 及水文分支分别失效；水文参数变化不应使 E0 失效。E0 不代表最终 C1 驱动结果。

T0 v24 小水体连通性已通过 3 Seed × L4/L5/L6 基准：未发现低于四个 L5 网格等效面积的封闭水体残留，海洋连通分量为 1–3。terrain-v20 历史数据仍只代表旧版基线。后续 `hydrology-h0-v2` 河网密度校准将动态汇水面积底线由 8×提高到 16×；L6 固定 Seed 样本河道区域数减少约 39–44%，详见 [河网密度校准基准](benchmarks/M1.3A-river-density-calibration.json)。L1 v4 过滤单网格组件后，3 Seed × L4/L5/L6 的湖泊数量为 L4 0–2、L5 3–7、L6 33–39；统计见 [M1.3B 静态湖泊基准](benchmarks/M1.3B-static-lakes.json)。

当前 C0 使用输出面积聚合到参考 Mesh，空参考格退回最近输出格。在参考格计算四季风、洋流、月温和月雨，先汇总初估年降水与潜在蒸散，再用其比值限制最终月雨求解中的陆地水汽供给。以三个邻近参考格优先同海陆投影温雨，气温直减率仅应用于最终陆地，并按物理面积修正全球月降水体积。洋流查询使用独立的同水体参考映射。`climate-c0-v21` 延续 v20 的东岸中纬温差、冬季离岸气流降雨抑制和 1100 km 陆向传播，并按东岸暴露度平方增强夏季迎风降雨。仍读取原有自转、倾角、公转周期、温度偏移及降水倍率，物理半径来自 Mesh。风噪声沿用 v2 随机流键，产物按 v21 Stage 版本参与缓存签名，I0/H0/L1/E0 通过依赖签名重算。月份选择属于显示状态。 [v21 草原/Dwa 调整](benchmarks/M1.2-Dwa-v21-steppe-adjustment.md) · [v20 Dwa 校准](benchmarks/M1.2-Dwa-v20-adjustment.md) · [v19 Dwa 校准](benchmarks/M1.2-Dwa-v19-adjustment.md) · [v18 Csa/Csb 校准](benchmarks/M1.2-Csa-Csb-v18-adjustment.md) · [v17 Csa 范围校准](benchmarks/M1.2-Csa-v17-adjustment.md) · [v16 陆地水汽再循环对照](benchmarks/M1.2-land-water-limited-recycling.md) · [v15 大陆冬季与背风干燥对照](benchmarks/M1.2-continental-dryness.md) · [v14 副热带沙漠对照](benchmarks/M1.2-subtropical-desert.md) · [v13 西岸与内陆降水对照](benchmarks/M1.2-west-coast-inland-rainfall.md) · [v12 历史校准](benchmarks/M1.2-climate-calibration.md)

T0 复用参考 `TerrainErosionProcessor`，按内部塑形坐标运行水力/冰川侵蚀及锐化、土壤蠕动前的排水重建；当前不把其流量诊断作为正式河网事实，也不读取 C0 降雨。

## 证据与复跑

历史实测文件、对应机器/版本和当前待验收项集中在 [PROGRESS](PROGRESS.md)。`bench:hydrology` 已归档 3 Seed × L4/L5/L6 的 I0/H0/L1 冷生成、缓存命中、局部参数变化、强制重算哈希、湖泊统计、资源和 T0 海岸统计；M1.3A 初始基准见 [M1.3A 基准](benchmarks/M1.3A-hydrology-acceptance.json)，加入湖泊后见 [M1.3B 基准](benchmarks/M1.3B-static-lakes.json)。缓存命中耗时、数组字节、RSS 阶段采样与真实峰值必须分开报告。
