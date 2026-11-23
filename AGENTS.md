# Another Earth — AI Agent 开发规范

适用范围：仓库根目录及所有子目录。默认用中文沟通；代码、类型、文件名和公开 API 使用英文并遵循现有约定。

- TailwindCSS 类优先使用框架标准 utility 和推荐简写；间距、尺寸、字号、颜色等值优先使用内置 scale 与标准修饰符，只有标准类无法表达需求时才使用方括号 arbitrary values。

## 资料与范围

- 产品目标以 [PRD](docs/PRD.md) 为准，长期架构以 [技术设计](docs/TECHNICAL_DESIGN.md) 为准；当前行为、接口和依赖以工作区源码及测试为准。发现冲突时指出差异，提出最小决策，不自行改写产品规则。
- 开始任务前查看 [当前进度](docs/PROGRESS.md)，之后只读与改动范围相关的契约或设计文档；历史参考快照按需查阅，不作为当前状态来源。文档若缺失，应明确指出，不凭文件名推断内容。
- 默认交付范围为 M0–M4（Genesis & Atlas）。M5+ 的动态文明、完整编辑器和历史分支仅保留当前任务确需的数据契约；未明确要求时不提前实现框架或空接口。

## 每次任务

1. 先检查工作区状态、未提交改动和相关代码与文档；不覆盖、撤销或格式化无关的用户修改。
2. 确认受影响的 Package、公开接口、数据所有权和下游消费者；复杂任务先给出简短实施计划。
3. 聚焦一个可验收目标，复用已有代码，不顺手重构无关模块。超出范围的架构变更先提出备选方案；不靠任意常数掩盖不确定的领域规则。
4. 为新增行为编写或调整有针对性的测试，考虑不变量、失败场景与性能影响。
5. **除非用户明确要求，不主动运行** `build`、`lint`、`test`、`typecheck` 或类似命令。获授权后先运行受影响范围的检查，再按需运行全仓检查；未运行的检查不得写成通过。本仓库使用 Bun，不混用其他包管理器生成锁文件。
6. **仅在事实变化时更新文档**：只有用户可见能力、生成结果、待办/限制、验证结论、公开契约、数据所有权、算法版本或架构边界变化时，更新 `docs/PROGRESS.md` 及直接相关的契约/设计文档。局部实现、内部重构、样式或文案调整不要求更新。一次改动只更新受影响文档，不复制逐轮日志；历史验证和本次验证分开记录，未运行的检查明确标注。
7. 交付时简明说明完成内容与主要文件、公开契约或兼容性变化、已运行及未运行的验证、遗留风险和下一步。重要设计偏离记录到 `docs/TECHNICAL_DESIGN.md` 的“已定决策与仍有限制”或明确告知。

## 包边界与数据所有权

- `@another-earth/world-data` 拥有内容定义、内容包与名称词库；不依赖其他业务 Package、UI、Three.js 或 DOM。
- `@another-earth/world-core` 拥有生成、领域规则及权威世界；通过调用方注入的结构化内容视图和 `ContentPort` 消费内容，不依赖 `world-data`、Svelte、Three.js、DOM、浏览器存储或 Worker 全局 API。核心算法须可在 Node 环境测试。
- `@another-earth/cartography` 拥有数据源、样式、图层及 2D/3D 渲染；只读取 `world-core` 的世界查询契约，不修改世界事实。地图内置样式属于此包。
- `apps/web` 负责 UI、Worker 编排、浏览器存储和导入导出；不绕过核心公开 API 修改世界数组。
- 跨包只使用 Package `exports`，不深度导入其他包的 `internal` 文件，不引入循环依赖；无实际需求时不增设独立算法 Package、插件引擎或抽象层。


## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five default roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root and ADRs in `docs/adr/`, created lazily when terms or decisions are resolved. See `docs/agents/domain.md`.
