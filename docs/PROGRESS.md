# Another Earth — 当前进度

> 更新：2026-11-08。记录当前工作区能力、验收状态与下一步，不作为逐轮调参日志。目标范围为 M0–M4；产品规则见 [PRD](PRD.md)。

## 当前结论

M1.2 初步气候 C0 的实现、代码和 Worker 链路验收通过：实现基于 feat-society 参考算法迁入四季风场、洋流代理、季风、月度三轮温度／两轮降水求解和 Köppen 亚型分类，并适配参考网格面积聚合、12 个等时长分箱、三源海陆感知投影及逐月全局降水体积修正。实际检查、Worker 浏览器回归和 3 Seed × L4/L5/L6 基准均通过，证据见下方及[气候验收基准](benchmarks/M1.2-climate-c0-acceptance.json)。按 M1 通用气候形态标准，地形雨影仍缺专门合成夹具验证，因此形态验收保留一项待补。

按用户调整，当前工作区在 M1.2 基线上恢复 T0 塑形阶段的基础水力与冰川侵蚀：`terrain-v24` 在高程转物理 km 前调用迁移的 `TerrainErosionProcessor`，参数默认 0.5/0.5；水力参数在处理器入口统一乘以 0.5，冰川强度不变。完成侵蚀、山脊锐化和土壤蠕动后，按最终负高程连通分量清理小于 4 个 L5 网格等效面积的水体，将其抬至海平面以上并记入拓扑诊断；较大的湖盆或海域保留，之后重建排水和最终海陆掩码。T0 不读取气候/降雨，也没有后续追加侵蚀。Seed 42/314159/8675309 × L4/L5/L6 基准中，最终封闭水体均无小于门槛的残留，海洋连通分量为 1–3。

M1.3A 已实现并完成 Core/Web 自动化与包级检查：I0 以显式温度阈值、融雪系数生成月末雪水当量/降雪/融雪；H0 以蒸散系数和液态降水/融雪生成月径流、年径流深/体积、Priority Flood 填洼路由、下游关系、汇水面积、流域摘要及河流段/Strahler 级序。当前 `hydrology-h0-v2` 把河道面积底线从 8×调整至 16×平均网格面积，调试河网按 Strahler 级序淡化低级支流。温度指数蒸散/融雪仅为近似，积雪只模拟一个周期，不计算多年冰川体积。真实 Chrome 可见页面通过 L4/L6 Worker 生成、区域查询和缓存失效检查；Playwright 自动回归因受管环境无法启动 headless Chrome（进程 SIGABRT）而未通过。Core/Web tests、typecheck、lint、build 均通过；Core 125/125，Web 32/32。

初版 `hydrology-h0-v1` Seed 42/314159/8675309 × L4/L5/L6 基准见[初始基准](benchmarks/M1.3A-hydrology-acceptance.json)。河网减密后 v2 的 9 组结果见[密度校准基准](benchmarks/M1.3A-river-density-calibration.json)：L6 从 1,627–1,874 个河道区域降至 912–1,138 个（减少 39–44%），河段从 534–541 降至 221–245。L5 减少约 46–59%。L4 更稀，Seed 314159 此样本只有 2 个河道区域；若 L4 是主要展示尺度，需单独校准粗网格阈值。

M1.2 的历史记录：新增核心月值／边界、等时长 forcing、Köppen、Worker 缓存与 Transfer、Controller 缺失结果回归；历史 core 测试 121/121、Web 测试 30/30，core/Web lint、typecheck 和 build 均通过。真实 Chrome Worker 浏览器回归 6/6 通过，涵盖 Mesh、Geology、Terrain、L8 与 C0 气候。该记录仅属于 M1.2 基线，不覆盖本轮 M1.3A 改动。

`pnpm --filter @another-earth/world-core bench:climate` 已完成 Seed 42/314159/8675309 × L4/L5/L6 的 9 组样本。每组强制重算的温度／降水哈希稳定；冷生成约 1.63–2.29 s、缓存命中约 0.15–0.52 ms、变更重算约 1.26–1.51 s，缓存占用约 24.3/30.7/56.5 MiB（L4/L5/L6）。机器、配置、完整哈希与数据见[基准记录](benchmarks/M1.2-climate-c0-acceptance.json)。

M0 工程基础和 M1.1 地质/基础地形 terrain-v20 已完成历史验收。当前基础地形算法为 terrain-v24，T0 侵蚀与末端小水体清理已纳入 M1.3A 的 L4/L5/L6 多 Seed 基准。terrain-v20 的 core/Web 单测、全仓类型检查与构建、lint、真实 Worker 浏览器回归，以及 L4/L6/L8 多 Seed 和参数样本历史通过。StageCache 默认预算为 512 MiB；旧 L8 基准留存约 430.5 MiB，峰值 RSS 未测。

当前 T0（terrain-v24）在地形塑形阶段执行基础冰川与水力侵蚀，默认参数 0.5/0.5；水力实际强度为参数的一半，冰川强度不变。参数进入 T0 缓存签名，UI 可分别调整。侵蚀在 km 映射前执行；侵蚀后的末端连通修复清理小于 4 个 L5 网格等效面积的负高程水体，不读取气候、降雨或冰雪阶段产物，也不执行气候驱动追加侵蚀。

## 已实现能力

| 范围 | 当前状态 |
| --- | --- |
| 工程与内容 | pnpm Workspace 四包、公开 exports、内容定义/Catalog/签名、最小 core/earthlike 包 |
| 世界契约 | Schema 2、Dense Field/实体、只读 FieldView、完整校验、人口约束、版本化 JSON 档案编解码 |
| Mesh | L0–L8 规则/扰动 Icosphere、Delaunay/Voronoi、CSR、物理面积、校验、最近站点查询 |
| 生成 | Stage DAG、声明输入、命名随机流、LRU 缓存、阶段事件和取消/失败边界 |
| Worker | Mesh/Geology/Terrain/C0/I0/H0 生成、传输、校验、缓存及查询链路已验收；Playwright 自动化受本机 headless Chrome 启动限制 |
| 地质 | L6 参考网格、100 基础细分、主/微板块、候选大陆、地壳与普通/地质投影 |
| 地形 T0 | 动力学、构造骨架、山脊/火山、纹理/Warp/整形/平滑、基础水力/冰川侵蚀、锐化/土壤蠕动；物理 km 高程、海陆、坡度与统计 |
| 调试 | /mesh-debug Mesh/Geology/Terrain/C0 专题、月份切换和查询已通过历史浏览器回归；I0/H0 专题、区域水量查询和缓存失效已手动可见验收 |
| 初步气候 C0（M1.2 实现与链路已验收；雨影专项待验证） | climate-c0 Stage、四季风场／洋流代理、12 月耦合温度/降水、年统计与 Köppen 亚型、Worker 传输、调试月份／风／洋流与区域查询；非最终气候 C1 |
| 初步冰雪与水文 I0/H0（M1.3A 已实现/验收） | 月度雪水当量/降雪/融雪，水量指数近似，Priority Flood、下游无环验证、面积汇流、流域与阈值河段、Stage 缓存、Worker 传输和水文调试查询；不含湖泊/追加侵蚀 |

关键规则：内部地形统一塑形坐标，末端一次转 km；粗糙度 0–0.5、默认 0.4，强度相对默认为 `(roughness/0.4)³`；低地与中高段映射、字段兼容性见 [数据契约](WORLD_DATA_CONTRACTS.md)和 [技术设计](TECHNICAL_DESIGN.md)。当前高程用颜色表达，没有正式地形位移、完整 3D/2D 地图或已发布自然世界。

## M1.1 收尾与下一步

1. M1.1 验收完成。检查覆盖 core/Web 单元测试、全仓类型检查与构建、lint、真实 Worker 生成/缓存/取消/失败恢复。
2. 固定 Seed 矩阵覆盖 3 Seed × L4/L6/L8；另在 L6 验证粗糙度 0.1/0.4/0.5 与海平面基准 ±0.5 km。每组强制重算并比较高程和海陆哈希，统计海陆比例、高程范围与连通分量见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
3. 浏览器地形预览和查询通过，无明显孤立尖峰或海陆不一致。高程模型仍是程序生成基线，不代表全球 DEM 标定。
4. M1.2 C0 的实现与链路验收通过；若按 M1 通用气候形态条件收口，还需补地形雨影专项夹具或可复核证据。用户决定先在 T0 恢复基础水力/冰川侵蚀，不实现气候驱动追加侵蚀；后续 M1.3 可在 T0/C0 上建立初步径流/冰雪并另行设计最终气候水文。

最终气候 C1、水文/湖泊、生态、完整自然快照发布尚未实现；M2 初始文明、M3 Cartography、M4 浏览器存储/导入导出均未交付。

## 已知限制与待决事项

- C0 已通过代码、缓存与 Worker 链路验收，但这不等于全球气候学标定。`climate-c0-v2` 是基于旧版启发式算法的初步模型；地球类参数边界、季节性与降水面积加权/逐月总量修正已覆盖，仍需后续依据领域参考校准空间形态和数值。月度气候仅是 T0 的阶段产物，不可发布为完整世界。
- C0 类地参数限定物理半径 6371 km、自转周期 24 小时、倾角 0–45°、公转周期 300–430 地球日、温度偏移 -20–20°C 和降水倍率 0–3；超出明确拒绝。风和洋流在调试层按分量／暖度着色与查询，尚无矢量箭头层。
- 本轮自动化覆盖季节反转、投影逐月降水体积守恒、月份/年值与 Worker 路径；未建立专门地形雨影合成夹具，也未做人工作图形态审阅。若将 M1 的通用气候形态验收标准用于 C0，雨影仍需补专项证据。
- 参考 L6 与输出 L8 的两个 12N Float32 字段约 60 MiB，仅是数组容量估算；气候 L4/L5/L6 core 缓存字节已实测，但气候 L8 与浏览器端峰值内存/性能尚未测量。
- 当前模型未按全球地球 DEM 标定。高程映射是视觉/程序生成模型，不保证固定全球比例或各 Seed 的空间连通形态。
- T0 前置侵蚀复用参考项目按汇水格数与角格距调参的启发式算法；当前恢复的是基础形态塑造，不是地球侵蚀速率标定。T0 不读取气候/冰雪，降雨驱动的追加侵蚀尚未实现。
- 同步长计算需硬取消兜底，Worker 重建会丢缓存；重新成功生成前禁用拾取。显示数组准备仍可能阻塞主线程。
- 部分区域诊断为兼容零/一数组，其含义不是世界事实。后续移除字段必须同步查询、Worker、校验与消费者。
- L8 单次 terrain artifact 约 31.25 MiB；全链路缓存实测约 399–430.5 MiB，StageCache 默认预算为 512 MiB。core 基准与真实 Chrome Worker 第二次请求均确认全链路缓存命中。峰值 RSS 仍未测，设备端长期内存压力需后续验证；预算试验见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
- CPU/GPU 峰值 RSS、长期浏览器资源压力和远端 CI 未核实；基准记录的缓存/数组字节不是进程峰值。

## 验证证据与历史基准

2026-11-08 M1.3A 代码、Core/Web 自动化和包级验证已完成；固定 Seed 多分辨率水文/T0 指标已归档。随后按视觉反馈将 H0 升为 v2 并把 L6 河道区域数减少 39–44%，Chrome 可见页面确认减密结果。Playwright headless E2E 因 Chrome 进程 SIGABRT 未能执行。基准仅证明算法确定性和约束检查，非全球水文气候学标定。

2026-11-04/05 的历史记录曾包含全仓检查通过、core 89/Web 28 项及 Chrome 4/4 回归、L8 规则/扰动生成拾取等。terrain-v20 历史基线不代表 terrain-v24 逐值一致；当前 terrain-v24 检查证据见 M1.3A 基准文件。

2026-11-06 曾进行 Seed 42/L8/扰动 0.75 的逐步生成及单项对照：低地在骨架时已存在，Finalizer 在该样本中提高中位数，关闭侵蚀对目标区域视觉改善有限。这些诊断促成后续映射修订，不是物理正确性、当前性能或多 Seed 验收。

仅保留有实测值的历史原始文件；其中机器、配置、版本、哈希和测量范围以文件为准：

| 原始记录 | 用途/限制 |
| --- | --- |
| [规则 Mesh](benchmarks/M0.3-mesh.json) | 原始几何/拓扑/查询采样 |
| [扰动 Mesh](benchmarks/M0.3-irregular-mesh.json) | Delaunay 与规则/扰动配置对照 |
| [Mesh Pipeline](benchmarks/M0.4-pipeline.json) | 首次生成与缓存命中，不是完整自然链 |
| [地质](benchmarks/M1.1A-geology.json) | 旧版本参考/输出投影采样 |
| [地形](benchmarks/M1.1B-terrain.json) | 旧算法的地形分布与生成采样 |
| [依赖读取性能修复](benchmarks/M1.1B-terrain-performance-fix.json) | 旧版本 L7 的工作副本与数组哈希对照 |
| [L8 距离精度修复](benchmarks/M1.1B-l8-distance-fix.json) | 距离代价 Float32 统一后的规则/扰动 L8 及浏览器采样 |

数组字节与阶段后 RSS 采样都不是峰值内存；不将历史秒数外推为当前配置保证。

## 本次修复与验证

2026-11-06：修正 `world-core` 的 package subpath imports，使跨包 TypeScript 解析指向明确的 `.ts` 文件及目录 `index.ts`；修正 terrain finalizer 测试桩的显式类型断言，更新 Worker 浏览器用例以检查当前实际提供的专题，并清理受影响源码、测试及基准脚本的 lint 问题。随后将 StageCache 默认值从 128 MiB 提高至 512 MiB，并加入 L8 Worker 缓存回归。未修改地形算法、公开世界契约或生成 Stage 版本。

本轮实测：core 113/113、Web 28/28 单测通过；全仓 `pnpm typecheck`、`pnpm build`、`pnpm lint` 通过；真实 Chrome Worker 回归 5/5 通过，新增 L8 首次生成后第二次请求 `Cache Hit`（浏览器回归在受限环境外完成）；`git diff --check` 通过。Web 构建仍提示 `MeshDebug` chunk 大于 500 kB，尚无性能结论。

terrain-v20 验收基准：L4/L6/L8 × Seed 42/314159/8675309 均通过强制重算哈希一致性；L6 在 roughness 0.1/0.4/0.5 与 seaLevelDatumKm -0.5/+0.5 样本也通过，粗糙度变化只重算 terrain。海平面提高时陆地比例下降，降低时上升。L8 在 3 个 Seed 中海陆覆盖为 31.6%–32.5%，高程范围约 -4.6–6.5 km。512 MiB StageCache 使 L8 11/11 Stage 全部命中，粗糙度变化仅重算 terrain。所有详情、哈希和耗时见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。基准没有测峰值 RSS，设备端长期内存压力需后续验证。

## 先前代码整理与重构

2026-11-06：
- 将标量数学工具函数（`clamp`、`smoothstep`、`gaussian`）由私有路径 `packages/world-core/src/nature/geology/math.ts` 迁移至通用数学模块 `packages/world-core/src/math/math.ts`，并在 `packages/world-core/src/index.ts` 统一重导出。
- 为三个核心子包（`world-core`、`world-data`、`cartography`）配置 Subpath Imports 路径别名。`world-core` 的初始 `"#*": "./src/*"` 映射在跨包类型检查中无法解析无扩展名目标，本轮已改为 `.ts` 目标及四个目录入口的显式映射；其余两包当前无 `#` 内部导入。
- 按照方案二重构 `@nature` 目录代码结构，保持零业务逻辑与计算结果变更：
  - 新建 `nature/common/`，将共用的算法网格桥接（`algorithm-mesh.ts`）、球面距离场（`distance-field.ts`）与优先队列（`priority-queue.ts`）抽离至公共基建层，并提供 `common/index.ts` 聚合出口，彻底消除 `geography` 反向借用 `geology` 底层实现的架构异味。
  - `nature/geology/` 分层划分：板块模拟与动力学收敛至 `plates/`；地壳、构造动力与高程骨架收敛至 `tectonics/`；根目录保留产物契约与校验，建立 `geology/index.ts`。
  - `nature/geography/` 分层划分：表面纹理、后处理编排与整形收敛至 `terrain/`；根目录保留高程物理单位与产物契约，建立 `geography/index.ts`。
- 将所有生成相关代码收敛至 `packages/world-core/src/generation/` 统一管理，并按形式二解耦管线调度引擎与具体阶段：
  - `generation/pipeline/`：纯粹的流水线调度引擎与基础工具（核心调度引擎直接作为 `index.ts`，配合 `copy-dependency.ts`、`errors.ts` 及各测试，不设立无业务逻辑的重导出中间层）。
  - 新增 `generation/stages/`：具体生成阶段实现与集成封装（`mesh-stage.ts`、`geology-stage.ts`、`terrain-stage.ts` 及相应测试，各 Stage 按需直引，不设立冗余的重导出出口）。
  - 将 `src/nature/` 移动至 `src/generation/nature/`，将 `src/civilization/` 移动至 `src/generation/civilization/`。
  - 规范 `package.json` 与 `tsconfig.json` 的别名配置；生成模块使用 `#generation/pipeline`、`#generation/stages/*`、`#generation/nature/*` 与 `#generation/civilization/*` 等内部导入。当前 `world-core` 的实际 `package.json` 映射以本轮修复为准。
  - 同步更新下游消费者导入、`src/index.ts` 导出以及 [技术设计](TECHNICAL_DESIGN.md) 目录树与章节说明。
- 为通用数学工具补充针对性单元测试 `packages/world-core/src/math/math.test.ts`，覆盖区间截断、退化 Hermite 插值与高斯衰减边界。
- 当轮验证状态：只执行 `git status` 与 `git diff` 核对修改范围；当时未运行 `build`、`lint`、`test`、`typecheck` 或浏览器验证。本轮授权后的检查结果见上文。

### 2026-11-07：M1.2 C0 验收

- `pnpm --filter @another-earth/world-core test`：18 个测试文件通过，121/121 项通过；`pnpm --filter @another-earth/web test`：30/30 项通过。
- core/Web lint、typecheck 与 build 均通过。Web build 成功，同时提示 `MeshDebug` chunk 压缩前约 587 KiB，超过 500 KiB 建议阈值。
- 真实 Chrome `pnpm --filter @another-earth/web test:browser`：6/6 通过，包括 C0 月气候/环流/缓存、失败保留有效 Mesh、取消恢复、Geology、Terrain 与 L8 Worker 缓存。
- 气候性能矩阵 9/9 通过并保存于[基准记录](benchmarks/M1.2-climate-c0-acceptance.json)；基准包含算法哈希、冷/命中/变更/强制生成耗时和缓存字节。未测进程峰值 RSS。
- `git diff --check` 通过。当前验收未包含视觉形态人工审阅或地球气候学标定；C0 不替代 M1.3 水文/冰雪、侵蚀后的 C1 或完整 WorldSnapshot。

## 历史文档整理记录

保留 PRD、技术设计、世界数据契约、生成管线、当前进度和 M1 实施计划六份主文档。合并网格/调试器/地质地形接口和当前决策，删除小阶段流水、被取代 ADR、空测量基线及过期临时诊断文件。参考源码 docs/old-src 保持只读。有实测数据的历史基准保留；旧轮次未运行的检查没有被改写成通过。

本次仅整理文档与文档引用，不修改生成行为。已检查 57 个本地 Markdown 链接及其章节锚点，无失效项；`git diff --check` 通过。PRD 与参考源码未修改。本次未运行 build/lint/test/typecheck 或浏览器验证。
