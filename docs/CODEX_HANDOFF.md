# Another Earth — ChatGPT → Codex 项目交接上下文

> 目的：将 ChatGPT 中关于 Another Earth 重构的**已确认决策、阶段计划与注意事项**传递给 Codex。本文是项目背景而非源码事实；具体实现以当前工作区为准。
>
> 使用：放入仓库 `docs/CODEX_HANDOFF.md`，在 Codex 新会话中要求先阅读本文件、`AGENTS.md` 和现有技术设计，再检查源码。

## 1. 项目定位

**Another Earth**：浏览器端程序化行星、世界地图及文明模拟器，逐步发展成可以生成、观察、演化、编辑和记录历史的世界创作工具。

当前优先事项是**在不浪费旧版成熟自然生成算法的前提下，重构工程与数据架构**，而不是一次性完成所有产品功能。

主要技术栈：TypeScript、pnpm Workspace、Svelte 5、Vite、Bits UI、Tailwind CSS、Three.js、Vitest。

本轮讨论对应的技术设计版本：**Another Earth 技术设计 v0.2**。如仓库中存在 `docs/TECHNICAL_DESIGN.md`，应首先阅读；产品需求参考 `docs/PRD.md`（文件是否存在需实际检查）。

## 2. 已明确的工程结构

```text
repo/
├── AGENTS.md
├── docs/
│   ├── old-src/                 # 用户已将原 src 目录迁移至此；只读旧实现
│   ├── PRD.md                   # 若已放入仓库
│   ├── TECHNICAL_DESIGN.md      # 若已放入仓库
│   └── CODEX_HANDOFF.md         # 本文件
├── apps/
│   └── web/                     # Web UI + Worker + orchestration
├── packages/
│   ├── world-data/              # 静态内容模板与 Content Packs
│   ├── world-core/              # 权威世界模型、Mesh、Generation、Simulation
│   └── cartography/             # 地图数据源、样式、2D/3D 渲染
├── package.json
└── pnpm-workspace.yaml
```

包依赖方向：`world-data` → `world-core` → `cartography` → `apps/web`（箭头表示后者可消费前者；不是强制每层导入）。Web 可使用各包。禁止循环依赖。

**重要：** `docs/old-src/` 保留旧版代码，只做**只读参考**。新工程不得直接导入；不得无授权修改或删除。旧版代码不应进入新工程的 TS / lint / tests / build 扫描范围。

## 3. 关键架构决策

### 3.1 世界数据与领域边界

- `world-data` 负责 Culture、Religion、Government、Resource、Name Pool、Preset 等**模板定义**，而不是某个世界实际生成出的国家/城市/宗教。
- `world-core` 的 `WorldSnapshot` 是某个世界在某个时间的**权威事实**。密集逐区域数据优先 TypedArray / CSR，城市、国家、文化等实体使用稳定 ID。
- 物理半径与 Three.js 展示半径分离；区域数组注明所属网格、单位和时间布局。
- `WorldViewState`（相机、样式、显示月份等）、GPU 资源、GeoJSON 派生缓存均**不是**世界权威事实。
- 初始静态世界 **Generation** 与逐年演化 **Simulation** 分离；本轮不要提前实施经济、战争、完整历史模拟。

### 3.2 M0.3 球面 Mesh 方案（已确定）

**Icosphere + 按需 Delaunator + 自实现 Spherical Voronoi Dual。**

- `irregularity = 0`：保留 Icosphere 三角拓扑，不需要重新做三角剖分。
- `irregularity > 0`：Seeded Vertex Jitter；通过球极投影 + `delaunator` 重建三角拓扑；正确处理投影极点和球面三角绕序。
- 使用三角网格对偶关系构建 Spherical Voronoi Cell、Corner、Edge、Area、邻接。
- TypedArray、CSR、高分辨率 L0–L7。Icosphere 区域数量 `N = 10 * 4^L + 2`，其中 L6=40,962、L7=163,842。
- **不引入 `d3-geo-voronoi` 替代现有方案。** 不要重写现有 Delaunay / Voronoi 数学算法，除非测试证明现有实现有缺陷。
- 旧版 Mesh 实现此前位于 `src/core/mesh/icosphere-builder.ts`、`src/core/mesh/voronoi.ts`，现可能在 `docs/old-src/core/mesh/`，请以实际文件为准。
- 必须验证 Euler 特征、双向邻接、面积总和趋近 `4π`、非退化面、极点/接缝、种子确定性。
- Web 端保留简单 **Mesh Debug Viewer**；只做调试用途，非正式地图系统。

### 3.3 M0.4 Generation Pipeline（已确定）

- `GenerationStage` 显式声明 ID、Version、依赖、相关配置字段、必要内容包依赖、输入与输出契约。
- Pipeline 使用 **DAG 拓扑排序**，检测重复、缺失依赖与环，先采用串行执行。
- 真实 `MeshStage` 必须接入 M0.3 Mesh Builder，不应只有 Mock Stage。
- **Stage 级增量生成**：通过 Stage Version、Seed、相关 Config Keys、Content Keys 与上游 Stage 签名构建缓存 Key；修改无关参数不能重算 Mesh。
- 阶段缓存首先使用受内存预算约束的进程内缓存，注意 TypedArray 数据所有权。
- 生命周期包括 STARTED / PROGRESS / CACHE_HIT / COMPLETED / FAILED / CANCELLED；协作取消支持 AbortSignal 或等价机制。
- 不实现区域级重算、复杂任务并行或持久化缓存。

### 3.4 统一随机源（M0.4 补充决策）

- 通用 RandomSource 放在 `packages/world-core/src/random/`，**而不是仅放在 pipeline 下面**。
- 统一 `nextFloat`、`nextInt`、`fork(namespace)` 语义。
- `fork()` 通过稳定 Seed 派生，不消耗父随机流状态；各 Stage 与实体拥有独立、命名的随机流。
- Mesh Jitter 通过 RandomSource 注入，不应在内部自行构建不统一的 PRNG。
- 旧版 Mesh Jitter 使用 `alea(seed)`；优先保持算法兼容，避免仅因随机算法替换就改变 Mesh 结果。如决定改变，需更新生成规则/Stage 版本和固定 Seed 回归测试。
- **相同 World Seed 并不足以保证相同输出**：还需相同 RNG 算法/派生规则、配置、Stage 版本及内容版本。

## 4. M0.1–M0.5 阶段与状态说明

以下是**本轮对话中的计划**，不是完成报告；Codex 应以当前代码、Git 状态与测试结果确认实际进度。

| 阶段 | 范围 | 最小验收 |
|---|---|---|
| M0.1 | pnpm Monorepo、Svelte App、包骨架 | dev/build/typecheck/lint/test 正常 |
| M0.2 | `WorldSnapshot`、单位、ID、模板 Schema、校验 | 最小自然/文明快照契约与校验测试 |
| M0.3 | Icosphere、Delaunator（不规则模式）、Spherical Voronoi、空间查询、Viewer | 几何/拓扑/确定性测试，Viewer 能展示 |
| M0.4 | DAG、RandomSource、Stage Cache、MeshStage、增量重算 | 真实 MeshStage 与缓存、随机性测试通过 |
| **M0.5** | **Worker Runtime、Controller、Protocol、Transferable、取消、Viewer 集成** | **Web UI 能在 Worker 中真实生成 Mesh，缓存有效、可取消、可重复生成** |

用户最近已请求过完整 **M0.5 开发指令**，但本对话并**没有证明 M0.5 已完成**；Codex 接手时首先检查工作区状态，不得假定任何阶段完成。

## 5. M0.5 当前最需要关注的技术细节

预期执行链：

```text
Mesh Debug Viewer
  → Generation Controller (apps/web)
  → module Web Worker (apps/web)
  → Generation Pipeline (world-core)
  → MeshStage
  → Icosphere / Jitter+Delaunator / Spherical Voronoi
  → Mesh DTO + Transferable
  → Main Thread hydration
  → Existing Mesh Renderer
```

**职责划分**：

- `world-core` 不能依赖 Worker 全局、DOM、Svelte、Three.js。
- Worker 专属协议、Controller、Runtime 优先放在 `apps/web`。共享的纯数据 DTO 可放在中立模块。
- 原生 Vite module Worker；先用**单个可复用 Worker**，不要一开始使用 Worker Pool、Comlink 或复杂 RPC。
- 消息必须具备 `requestId`，至少含 GENERATE / CANCEL / CLEAR_CACHE 和 READY / STARTED / PROGRESS / COMPLETED / CANCELLED / FAILED。
- Controller 管理 Idle/Starting/Running/Completed/Failed/Cancelled，处理旧请求覆盖新结果、错误和 dispose。偏向 **latest request wins**。
- Cooperative Cancel 无法保证打断正在同步执行的 Mesh Builder，因为 Worker 事件循环被 CPU 任务占用；需要支持 `worker.terminate()` **硬取消**并正确重建 Worker，接受此时缓存丢失。
- **Transferable 与 Stage Cache 冲突**：若直接 transfer 缓存原始 ArrayBuffer，Worker 内 buffer 会 detached。初版采用 `Worker Cache Owns Original → Create Transfer Snapshot → Transfer Snapshot to Main Thread`。检查共享 buffer 去重和峰值内存。
- Structured Clone 不会保留自定义 Class Prototype；需要 DTO / Hydration，恢复的 Mesh 可被现有拓扑查询和 Viewer 使用，不能重新计算 Voronoi。
- 区分 generation、snapshot copy、transfer、hydration、GPU upload/render 耗时。
- 测试必须包括真实 Worker 浏览器集成，不可只靠 Mock Worker 测试宣称完成。

## 6. 后续版本路线（避免提前越界）

- M1：依次迁移和改善旧版自然生成（板块、地壳、大陆、地形、四季/12 月气候、水文、生态），每一步保留固定 Seed 对照。
- M2：自然资源、人口、聚落、交通、文化、国家、宗教的**初始静态生成**。
- M3：Cartography 的正式 3D Globe 与 2D Atlas、Data Source/Style/Layer/Picking。
- M4：存档、导入导出、IndexedDB + OPFS、性能和 V1 验收。
- M5/M6：未来逐年模拟、世界编辑器、历史和分支。

自然算法遵循：**优先迁移已验证实现，再明确、测试驱动地优化**。不要在结构性迁移时顺便全量改写地质、气候或水文。

## 7. Codex 协作约定

1. 新任务先检查 `git status`、实际文件树、package scripts、关键类型接口和测试。
2. 读取 `AGENTS.md`、本文件及相关 PRD/技术设计；缺失则说明，**不得推断文件存在**。
3. `docs/old-src/` 只读，禁止直接 import 旧代码。
4. 同一任务只改当前里程碑必要范围；保留用户修改；不自动 commit。
5. 先复用已验证模块，不做重复实现；必要接口变更须说明原因和兼容影响。
6. 修改后实际运行项目已有 typecheck、lint、test、build，报告真实结果。浏览器集成需要真实浏览器验证。
7. 记录限制、性能与内存测量；不可将目标性能写成已达成的实测数据。
8. 结束时更新当前工作进度：实际完成内容、测试结果、待处理问题、下一任务。建议在 `docs/` 中维护简短的阶段交接记录，避免下个 Codex 会话依赖聊天历史。

## 8. 给 Codex 的首条接手消息（可直接复制）

> 这是 Another Earth 项目的持续重构工作。先阅读仓库根目录 `AGENTS.md`、`docs/CODEX_HANDOFF.md`，以及存在的 `docs/PRD.md`、`docs/TECHNICAL_DESIGN.md`。然后检查 `git status`、Monorepo 实际结构和 M0.1–M0.4 代码/测试。`docs/old-src/` 是只读旧版参考代码。**先不要改代码**：请报告当前已完成阶段、与交接文档的差异、是否具备实施 M0.5 的前置条件，以及 M0.5 的最小实施计划和验收点。不要把规划当作已完成。待我给出具体实施任务后再动手。

---

*这份交接记录浓缩了讨论结论，并不包含完整逐字聊天记录。具体源码行为始终以当前仓库为准。*
