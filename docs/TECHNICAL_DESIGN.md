# Another Earth — 技术设计

> 更新：2026-11-18。本文记录当前有效的架构边界与设计决策，不复述逐阶段实现日志。产品规则见 [PRD](PRD.md)，实现状态见 [PROGRESS](PROGRESS.md)，历史设计快照见 [TECHNICAL_DESIGN_REFERENCE.md](TECHNICAL_DESIGN_REFERENCE.md)。

## 架构边界

仓库使用 Bun Workspace，按数据、领域、制图和应用编排划分 Package：

| Package | 所有权与职责 | 依赖边界 |
| --- | --- | --- |
| `@another-earth/world-data` | 内容定义、内容包、命名风格、解析和校验 | 不依赖其他业务 Package、UI、Three.js 或 DOM。 |
| `@another-earth/world-core` | 生成算法、领域规则、`WorldSnapshot` 和只读世界查询 | 不依赖 `world-data`、`cartography`、UI、DOM 或 Worker 全局 API；内容通过调用方提供的视图与 `ContentPort` 注入。 |
| `@another-earth/cartography` | 地图数据源、样式、图层、2D/3D 渲染和拾取 | 只读消费 `world-core` 查询契约，不写回世界事实。 |
| `apps/web` | UI、Worker 生命周期、内容组装、浏览器存储及导入导出流程 | 通过 Package exports 编排其他包，不直接修改核心数组。 |

不为尚无实际消费者的 M2+ 能力建立空框架或额外 Package。跨包只使用公开 exports，避免循环依赖。

## 数据与生成边界

- `ContentDefinition` 是候选内容；`GenerationArtifact` 是阶段产物；`WorldSnapshot` 是通过完整领域校验后发布的权威事实；`MapStyle` / `ViewState` 是显示状态。
- `world-core` 的 Stage 显式声明依赖、算法版本及读取的配置/内容。相同 Seed、输入和版本应可复现；显示状态不进入生成签名。
- 完整自然世界先组装候选快照，再完整校验并原子发布。失败、取消或传输错误保留最后有效世界。
- 已发布 TypedArray 由核心所有者管理。消费者通过只读查询读取；变更生成新候选并整体替换，不原地改写已发布数组。
- Worker 转移独立 Buffer；阶段缓存保留自己的数组，不复用已转移的存储。

精确字段、单位、ID、内容哈希、快照校验和归档格式见 [世界数据契约](WORLD_DATA_CONTRACTS.md)；Stage DAG、签名、缓存与 Worker Buffer 规则见 [生成管线](GENERATION_PIPELINE.md)。

## 当前实现范围

当前工作区已实现自然世界生成与 Schema 3 发布、`WorldMapReader`、3D Globe、2D Atlas、多投影、地图样式与图层、Worker 编排和区域查询。当前具体能力、验证结论与延期事项以 [PROGRESS](PROGRESS.md) 为准。历史算法沿革、目标设计草图及过往逐轮决策仅供追溯，收录于 [技术设计参考快照](TECHNICAL_DESIGN_REFERENCE.md)；制图引擎细节见 [Cartography-System-Design.md](Cartography-System-Design.md)。

尚未实现的主要里程碑：

- **M2**：初始文明、资源空间分布及候选内容到世界实体的映射。
- **M4**：浏览器项目保存、恢复与完整世界档案导入导出。
- **M5+**：动态文明、完整编辑器、历史与分支；当前只保留必要的数据边界。

## 验收原则

生成结果变化须记录对应 Stage 版本、原因和可复现证据。性能结论必须来自明确配置与实测，不以规划规模、历史耗时或截图代替基准。历史验证只适用于其注明的代码版本和范围，不自动覆盖当前改动。

当架构或公开契约发生变化时更新本文及相应契约；普通实现细节和局部 UI 调整不更新本文。
