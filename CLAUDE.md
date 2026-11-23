# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

仓库级行为规范以 [AGENTS.md](AGENTS.md) 为准（中文沟通、包边界、文档更新条件、默认不跑检查）。本文件只补充命令和跨包数据流。

产品目标见 [docs/PRD.md](docs/PRD.md)，长期架构见 [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)，当前能力与限制见 [docs/PROGRESS.md](docs/PROGRESS.md)。字段与快照契约见 [docs/WORLD_DATA_CONTRACTS.md](docs/WORLD_DATA_CONTRACTS.md)，生成管线见 [docs/GENERATION_PIPELINE.md](docs/GENERATION_PIPELINE.md)。源码与测试与文档冲突时以源码为准并指出差异。

## 命令

Bun workspace（`packageManager`: `bun@1.4.3`）。只用 Bun，不要用 npm/pnpm/yarn 改锁文件。根脚本会跑所有 workspace。

```sh
bun install
bun dev                                          # apps/web，Vite
bun run typecheck                                # 各包 tsc --noEmit；web 为 svelte-check
bun run lint
bun run test                                     # 各包 vitest run，匹配 src/**/*.test.ts
bun run build                                    # 库包是 tsc --noEmit；web 是 vite build
```

单测进入对应包，路径相对该包：

```sh
bun run --cwd packages/world-core test src/generation/pipeline/pipeline.test.ts
bun run --cwd packages/world-data test src/catalog.test.ts
bun run --cwd packages/cartography test src/sources/sources.test.ts
bun run --cwd apps/web test src/workers/runtime.test.ts
bun run --cwd apps/web test:browser              # Playwright，e2e/
bun run --cwd apps/web test:browser e2e/civilization-parameters.spec.ts
```

文明生成基准在 `apps/web`：`bench:civilization:layout`、`bench:civilization:traits`、`bench:civilization:calibration`、`bench:civilization:performance`。自然链基准在 `packages/world-core`（`bench:mesh`、`bench:generation`、`bench:geology`、`bench:terrain`、`bench:climate`、`bench:hydrology`），走 `vitest.bench.config.ts`。CI（`.github/workflows/check.yml`）依次跑 `typecheck`、`lint`、`test`、`build`。

## 架构

浏览器里生成一颗可复现的类地行星，并在 3D 球体或 2D 地图上查看自然与初始文明。Svelte 5 + Vite + Three.js。默认范围是 M0–M4；动态文明、完整编辑器和历史分支不在当前交付内。

四个包，依赖只能沿公开 `exports`（各包根入口 `src/index.ts`）：

| 包 | 职责 |
| --- | --- |
| `@another-earth/world-data` | 内容定义、社会候选、命名词库。不依赖其他业务包、UI 或 Three.js。 |
| `@another-earth/world-core` | 生成、领域规则、权威世界。通过调用方注入的 `ContentPort` 消费内容，不依赖 `world-data`。包内私有导入用 `#*`（见该包 `imports`）。核心算法必须能在 Node 里测。 |
| `@another-earth/cartography` | 数据源、样式、图层、2D/3D 渲染。只读 `world-core` 的查询契约，不改世界事实。 |
| `apps/web` | UI、Worker 编排、分享链接。不绕过公开 API 改世界数组。`src/ui` 是界面，`src/world-view` 是地图工作台，`src/workers` 跑生成。 |

一次完整生成的数据流：

1. `apps/web` 把内置内容打成 `ContentPort`（`src/lib/generation/builtin-content.ts`），经 `GenerationController` 发给 Worker。
2. `GenerationWorkerRuntime`（`apps/web/src/workers/runtime.ts`）共享一份 `StageCache`，依次接 `createMeshPipeline` → geology → terrain → climate → hydrology → ecology → `createWorldPipeline`。同一 seed、配置、算法版本和内容签名必须可复现；缓存按 stage 的依赖、版本和实际读取的 config/content 失效。
3. 发布级 stage 顺序：`mesh` → `geology` → `terrain`（含 `geographic-regions` / `geographic-names`）→ `climate-c0` → `cryosphere-i0` → `hydrology-h0` → `static-lakes-l1`，以及只依赖 mesh/terrain/climate 的 `ecology-e0` → `resource-potential` → `habitability` → `population-settlements` → `transport-network` → `peoples-cultures` → `polities-religions`。地质与地形内部还有 reference mesh、板块和构造高程等中间 stage。
4. `assembleWorld` 把阶段产物装成候选 `WorldSnapshot`，`validateWorldSnapshot` 通过后才由 `WorldStore` 原子发布。失败或取消保留上一个有效世界。已发布的 TypedArray 不向视图交出可写引用；Worker 用显式 buffer 转移（`src/lib/generation/transfer.ts`），转移后的数组不能再用。
5. 地图只读 `createWorldMapReader` 的查询结果。样式、月份、相机和图层开关属于显示状态，不写入快照，也不触发重新生成。

`ContentDefinition` 是内容候选，`GenerationArtifact` 是阶段产物，`WorldSnapshot` 是已确认事实，`MapStyle` / `ViewState` 是显示交互。GeoJSON、GPU buffer 和图层颜色不是世界事实来源。
