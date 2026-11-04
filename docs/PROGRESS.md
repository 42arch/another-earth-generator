# Another Earth 重构进度

> 更新日期：2026-11-04（Asia/Shanghai）。依据当前工作区源码、`AGENTS.md`、PRD、技术设计及本次实际验证结果。以下工作区改动尚未提交；已通过的本地检查不等于远端 CI 已通过。

## 当前结论

**M0 最小范围已具备进入 M1 的前置条件。** pnpm Workspace、包边界、内容与世界契约、网格、阶段 Pipeline、Worker 网格链路和最小 JSON 档案往返均有实现；本次全仓单元测试、类型检查、lint、构建，以及两条真实 Chrome Worker 回归用例通过。M0 仍是工程基础，不代表 Genesis & Atlas 产品流程已完成。

当前生产 Pipeline 只有 Mesh Stage。`apps/web` 首页仍是占位工作区，`/mesh-debug` 是调试 Viewer；没有自然世界、初始文明、正式 3D/2D 地图或浏览器存档流程。`docs/old-src/` 仅作旧版算法参考，不属于新架构运行代码；迁移自然/文明算法时以 `42arch/another-earth-generator` 的 `feat-society` 分支为基线。

## 已实现范围

| 范围 | 当前工作区代码 |
| --- | --- |
| M0.1 Workspace | `apps/web`、`world-data`、`world-core`、`cartography` 的 pnpm Monorepo，公开 `exports`、TypeScript、ESLint 和脚本。CI 工作流文件已添加，尚未在远端运行。 |
| M0.2 世界与内容契约 | `WorldSnapshot` Schema 2、Dense Field/实体与校验；最小 `core`、`earthlike` 内容包、只读 Catalog、内容哈希/签名；Mesh 配置与 Stage 来源元数据；独立 `WorldViewState`。Schema 1 快照需要迁移后才能读取。 |
| M0.3 Mesh | L0–L7 规则及扰动 Icosphere、球面 Delaunay/Voronoi、CSR 邻接、面积/拓扑校验和空间查询；固定 Seed 测试、调试 Viewer 与本机基准记录。 |
| M0.4 Generation | DAG 注册与排序、阶段签名和内存缓存、确定性 PRNG、进度/取消/失败事件；唯一生产 Stage 是 Mesh，其他 Stage 仅在测试中使用 Mock。 |
| M0.5 Worker | requestId 协议、Controller、Worker Runtime、复制后 Transfer、缓存复用、硬取消/重建、网格拾取；真实浏览器回归覆盖生成、缓存、取消和失败恢复。 |
| M0 最小档案 | `encodeWorldArchive`/`decodeWorldArchive` 提供带校验和、TypedArray 恢复和完整快照验证的版本化 JSON 往返；尚非 M4 `.aearth` 二进制格式，也没有浏览器持久化或用户导入流程。 |

## 2026-11-04 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，四个工作区包均通过；Web 的 `svelte-check` 为 0 errors、0 warnings。 |
| `pnpm lint` | 通过，四个工作区包均通过。 |
| `pnpm test` | 通过：`world-data` 8 项、`world-core` 70 项、`apps/web` 22 项；`cartography` 当前没有测试文件。 |
| `pnpm build` | 通过；Web 的 Mesh Debug chunk 约 566 kB，Vite 给出超过 500 kB 的提示。 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm --filter @another-earth/web test:browser` | 通过，2/2 用例；使用本机 Chrome，因为本机未安装 Playwright 默认下载的 Chromium。CI 配置仍安装并使用 Chromium，远端执行结果待确认。 |

验证过程中修复了 `world-data` 使用 `structuredClone` 与现有 TypeScript lib 不兼容的问题，以及新增代码的 lint 问题。

## M1 起点与未完成事项

1. **先闭合首个自然垂直切片**：从 Mesh 接入板块/地形 Stage，定义输入、输出、失效签名和固定 Seed 质量基准，再组装并完整校验 `WorldSnapshot` 后原子发布。当前快照类型和档案测试中的样例不等于已有世界生成/发布流程。
2. **继续自然链**：迁移气候、Priority Flood/河网与生态；检查最终海陆掩码、跨分辨率统计、水文无环及面积/水量约束。算法迁移需记录版本和结果变化，不将旧版经验模型描述为高精度物理模拟。
3. **后续里程碑仍未完成**：M2 初始文明与内容库、M3 Cartography 正式 3D/2D 地图、M4 项目保存/导入导出和完整用户旅程。M5+ 动态模拟、编辑器与历史分支仍在当前交付范围之外。
4. **当前限制**：同步 Mesh 构建不能在单次计算中协作中断，硬取消会丢失 Worker 缓存；未测 Worker/渲染 CPU 与 GPU 峰值内存；CI 工作流尚未在远端验证。工作区修改尚未提交。
