# Another Earth — 当前进度

> 更新：2026-11-06。记录当前工作区能力、验收状态与下一步，不作为逐轮调参日志。目标范围为 M0–M4；产品规则见 [PRD](PRD.md)。

## 当前结论

M0 工程基础和 M1.1 地质/基础地形已实现并完成本轮验收。当前算法为 geology-v2、terrain-skeleton-v9、terrain-v20。core/Web 单测、全仓类型检查与构建、lint、真实 Worker 浏览器回归，以及 L4/L6/L8 多 Seed 和参数样本均已通过。StageCache 默认预算已调至 512 MiB；L8 core 基准留存约 430.5 MiB，浏览器 Worker 留存约 399.3 MiB，重复请求可命中全部 Stage；峰值 RSS 未测，继续跟踪。

M1.1 只交付基础地形 T0，不执行冰川/水力侵蚀或代理排水重建。两个侵蚀配置、默认值、UI 和签名键已移除，显式旧键包括 0 都会拒绝。侵蚀/沉积兼容数组恒零表示未执行；现有参考算法保留供后续气候/水文接入，不代表已注册未来 Stage。

## 已实现能力

| 范围 | 当前状态 |
| --- | --- |
| 工程与内容 | pnpm Workspace 四包、公开 exports、内容定义/Catalog/签名、最小 core/earthlike 包 |
| 世界契约 | Schema 2、Dense Field/实体、只读 FieldView、完整校验、人口约束、版本化 JSON 档案编解码 |
| Mesh | L0–L8 规则/扰动 Icosphere、Delaunay/Voronoi、CSR、物理面积、校验、最近站点查询 |
| 生成 | Stage DAG、声明输入、命名随机流、LRU 缓存、阶段事件和取消/失败边界 |
| Worker | 三类生成任务、复制后 Transfer、latest request wins、硬取消重建、区域拾取、传输校验 |
| 地质 | L6 参考网格、100 基础细分、主/微板块、候选大陆、地壳与普通/地质投影 |
| 地形 T0 | 动力学、构造骨架、山脊/火山、纹理/Warp/整形/平滑/锐化/土壤蠕动；物理 km 高程、海陆、坡度与统计 |
| 调试 | /mesh-debug 三种生成内容，L4–L8，专题/图例/区域查询、缓存/耗时、五邻域中心标记 |

关键规则：内部地形统一塑形坐标，末端一次转 km；粗糙度 0–0.5、默认 0.4，强度相对默认为 `(roughness/0.4)³`；低地与中高段映射、字段兼容性见 [数据契约](WORLD_DATA_CONTRACTS.md)和 [技术设计](TECHNICAL_DESIGN.md)。当前高程用颜色表达，没有正式地形位移、完整 3D/2D 地图或已发布自然世界。

## M1.1 收尾与下一步

1. M1.1 验收完成。检查覆盖 core/Web 单元测试、全仓类型检查与构建、lint、真实 Worker 生成/缓存/取消/失败恢复。
2. 固定 Seed 矩阵覆盖 3 Seed × L4/L6/L8；另在 L6 验证粗糙度 0.1/0.4/0.5 与海平面基准 ±0.5 km。每组强制重算并比较高程和海陆哈希，统计海陆比例、高程范围与连通分量见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
3. 浏览器地形预览和查询通过，无明显孤立尖峰或海陆不一致。高程模型仍是程序生成基线，不代表全球 DEM 标定。
4. 下一步按 [M1 实施计划](M1_IMPLEMENTATION_PLAN.md)进入月气候 C0，再建立初步径流/冰雪，实施侵蚀后重算最终气候水文，随后生态与完整快照发布。

气候、水文/湖泊、生态、完整自然快照发布尚未实现；M2 初始文明、M3 Cartography、M4 浏览器存储/导入导出均未交付。

## 已知限制与待决事项

- 当前模型未按全球地球 DEM 标定。高程映射是视觉/程序生成模型，不保证固定全球比例或各 Seed 的空间连通形态。
- 水力侵蚀旧算法按汇水格数与角格距调参，未来接入前需统一面积、距离与时间尺度；气候/冰雪来源与质量守恒近似尚待设计。
- 同步长计算需硬取消兜底，Worker 重建会丢缓存；重新成功生成前禁用拾取。显示数组准备仍可能阻塞主线程。
- 部分区域诊断为兼容零/一数组，其含义不是世界事实。后续移除字段必须同步查询、Worker、校验与消费者。
- L8 单次 terrain artifact 约 31.25 MiB；全链路缓存实测约 399–430.5 MiB，StageCache 默认预算为 512 MiB。core 基准与真实 Chrome Worker 第二次请求均确认全链路缓存命中。峰值 RSS 仍未测，设备端长期内存压力需后续验证；预算试验见[验收基准](benchmarks/M1.1B-terrain-v20-acceptance.json)。
- CPU/GPU 峰值 RSS、长期浏览器资源压力和远端 CI 未核实；基准记录的缓存/数组字节不是进程峰值。

## 验证证据与历史基准

2026-11-04/05 的历史记录曾包含全仓检查通过、core 89/Web 28 项及 Chrome 4/4 回归、L8 规则/扰动生成拾取等。此后参考算法恢复、单位域、映射、粗糙度和侵蚀后移均有改动，**这些历史结果不代表当前 v20 通过**；当前检查结果单独记录于下文。

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

## 本次文档整理

保留 PRD、技术设计、世界数据契约、生成管线、当前进度和 M1 实施计划六份主文档。合并网格/调试器/地质地形接口和当前决策，删除小阶段流水、被取代 ADR、空测量基线及过期临时诊断文件。参考源码 docs/old-src 保持只读。有实测数据的历史基准保留；旧轮次未运行的检查没有被改写成通过。

本次仅整理文档与文档引用，不修改生成行为。已检查 57 个本地 Markdown 链接及其章节锚点，无失效项；`git diff --check` 通过。PRD 与参考源码未修改。本次未运行 build/lint/test/typecheck 或浏览器验证。
