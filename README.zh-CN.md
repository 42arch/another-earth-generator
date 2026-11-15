# Another Earth

[English](README.md) | [简体中文](README.zh-CN.md)

浏览器中的过程化星球生成与地图探索项目，采用 TypeScript、Svelte 5、Vite 和 pnpm Workspace。

## 当前能力

- 生成 L0–L8 规则或扰动球面网格、参考地质、板块、候选大陆、地壳及基础地形。
- 在 `/mesh-debug` 选择网格、地质或地形任务，查看专题、区域属性、生成进度与缓存。
- 提供世界/内容契约、阶段 Pipeline、Worker 副本传输和最小 JSON 档案编解码。

当前 M1.1 输出为阶段产物，最新版本为 `terrain-v20`，不执行冰川/水力侵蚀。月度气候、水文、生态、完整世界发布、文明、正式 3D/2D 地图和浏览器项目保存尚未实现。最新验收状态见[当前进度](docs/PROGRESS.md)。

## 本地运行

```sh
pnpm install
pnpm dev
```

打开终端给出的地址并进入 `/mesh-debug`。UI 提供 L4–L8，L8 需要较多内存；它是调试入口，尚非完整产品工作台。

## 文档

| 文档 | 内容 |
| --- | --- |
| [PRD](docs/PRD.md) | 产品目标、用户旅程和交付范围 |
| [技术设计](docs/TECHNICAL_DESIGN.md) | 包边界、算法、制图/存档目标和当前决策 |
| [世界数据契约](docs/WORLD_DATA_CONTRACTS.md) | 字段、单位、身份、快照与产物所有权 |
| [生成管线](docs/GENERATION_PIPELINE.md) | Stage、签名、随机流、缓存和 Worker |
| [当前进度](docs/PROGRESS.md) | 已实现、待办、验证状态与历史实测索引 |
| [M1 实施计划](docs/M1_IMPLEMENTATION_PLAN.md) | 气候、水文、侵蚀、生态与世界发布任务 |

`packages/world-core` 拥有生成与领域规则，`packages/world-data` 拥有内容，`packages/cartography` 负责制图边界，`apps/web` 负责 UI 和 Worker。`docs/old-src` 是 feat-society 参考源码，不参与新项目运行。
