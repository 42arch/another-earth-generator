# Another Earth

[English](README.md) | [简体中文](README.zh-CN.md)

浏览器中的过程化星球生成与地图探索项目，采用 TypeScript、Svelte 5、Vite 和 Bun Workspace。

## 当前能力

- 在 L0–L8 规则或扰动球面网格上生成自然世界，包含气候、水文、生态、Schema 3 快照校验发布和只读查询。
- 使用 3D 星球或 2D 地图集探索世界，查看专题图层、六套地图风格和区域信息；生成由 Worker 执行。
- 提供内置内容与命名档案；双语社会包目前是供未来文明生成选择的候选内容。

初始文明生成、浏览器项目保存及世界档案导入导出尚未实现。当前范围与验证状态见[当前进度](docs/PROGRESS.md)。

## 本地运行

```sh
bun install
bun dev
```

打开终端给出的地址即可进入 `/` 工作台。L8 需要较多内存。

## 文档

| 文档 | 内容 |
| --- | --- |
| [PRD](docs/PRD.md) | 产品目标、用户旅程和交付范围 |
| [技术设计](docs/TECHNICAL_DESIGN.md) | 当前包边界与长期有效的设计决策 |
| [世界数据契约](docs/WORLD_DATA_CONTRACTS.md) | 当前快照、内容、所有权与档案契约 |
| [生成管线](docs/GENERATION_PIPELINE.md) | Stage、签名、随机流、缓存和 Worker |
| [当前进度](docs/PROGRESS.md) | 当前能力、待办与验证状态 |
| [M1 实施计划](docs/M1_IMPLEMENTATION_PLAN.md) | 气候、水文、侵蚀、生态与世界发布任务 |

`packages/world-core` 拥有生成与领域规则，`packages/world-data` 拥有内容，`packages/cartography` 负责制图，`apps/web` 负责 UI 和 Worker。`docs/old-src` 是 feat-society 参考源码，不参与新项目运行。历史文档快照由当前进度页链接，不作为当前规范。
