# Another Earth — 技术设计方案 v0.2

> **文档性质**：架构设计、关键数据契约、算法演进、工程任务与验收标准  
> **更新日期**：2026-11-04
> **产品依据**：仓库内 `docs/PRD.md`（Another Earth PRD v1.0）
> **代码审查基线**：[`42arch/another-earth-generator` / `feat-society`](https://github.com/42arch/another-earth-generator/tree/feat-society)，commit `881d95ed14edd9c99f56cbaab9db8e5c733676f4`  
> **当前实现与验证**：以工作区源码和 [`PROGRESS.md`](PROGRESS.md) 为准；本文的目标目录、示例接口与 V1 方案不自动代表已实现。
> **目标平台**：桌面浏览器优先、离线优先、单机创世与世界探索；为长期文明演化、编辑与历史分支预留明确边界  
> **本文优先级**：架构正确性 > 世界数据一致性 > 可复现性 > 可测试性 > 实测性能 > 算法复杂度

## 0. 总体决策

**Another Earth 采用 `pnpm workspace` Monorepo，初期由 `apps/web` 与三个核心 Package 构成：**

- **`@another-earth/world-data`**：内置内容、生成模板、候选名称、文化与宗教原型、政体、资源、创世预设及内容包版本；不保存某个世界的实际事实。
- **`@another-earth/world-core`**：球面拓扑、自然与文明生成、统一世界状态、领域约束、未来的时间模拟、编辑命令、事件和历史；不依赖 UI、Three.js 或 DOM。
- **`@another-earth/cartography`**：数据源、制图表达式、图层样式、2D/3D 视图、投影、Picking 与 GPU 资源管理；只读取已发布的世界状态。
- **`apps/web`**：Svelte 5 工作台、创世向导、世界图鉴、用户交互、Worker 管理、项目存储和数据导出。

采用 **Three.js + WebGL2** 作为初版渲染后端，**Web Workers** 运行创世计算；世界数据采用 **TypedArray + Graph + 稳定 ID 实体**。初版不采用微服务、后端权威模拟、全面 ECS、强制 WASM 或 WebGPU。

### 0.1 与 v0.1 的主要更新

1. 新增独立的 `world-data` 内容包设计，覆盖 Schema、Content Pack、确定性选择、版本、国际化和未来扩展包。
2. 将自然算法明确分为“**保留基础算法** / **优化处理边界** / **新增领域模型**”，不以改名或搬文件等同算法升级。
3. 增加地形海陆掩码、地形侵蚀、气候求解和投影、水文湖泊、生态连续字段的具体改进方案。
4. 强化 `WorldSnapshot`、Stage Artifact、Derived Data、View State 和用户编辑覆盖之间的所有权与失效规则。
5. 明确 Stage DAG、配置路径、依赖哈希、资源缓存与 Worker Buffer 转移的实际限制。
6. 对未来文明演化、历史存储、局部编辑提供可落实的模型，但不将这些完整功能塞入第一版。
7. 增加算法对照基准、性能门槛、阶段任务和 AI Agent 实施规约。

### 0.2 首版交付定义

首版对应产品 PRD **Genesis & Atlas**：用户完成创世参数配置，生成带有自然地理和静态文明的星球；切换 3D/2D 地图及专题图；选择城市、国家、民族、宗教并查看详情；保存、重开和导出世界。

**首版必须具备**：完整可复现的创世流程、可靠的世界数据、基础样式库、可访问的世界信息、存档往返、错误与取消处理、运行时性能记录。

**首版不要求具备**：完整市场价格与战争 AI、全球逐年历史、自主演化系统、全功能地图编辑、复杂湖泊水位模拟、通用大气数值模型、历史分支界面。预留架构和少量契约，但不开发空壳复杂框架。

### 0.3 当前实现基线与 M1 入口（2026-11-04）

当前工作区已具备 M0 的最小工程前置条件：四个 Workspace Package、内容包与世界快照契约、L0–L7 球面网格、Stage DAG/缓存、Worker 网格调试链路，以及带完整快照校验的版本化 JSON 档案往返。生产 Pipeline **仅有 Mesh Stage**；`WorldSnapshot` 目前只有类型、校验和测试样例，没有从自然 Stage 组装并原子发布真实世界的流程。`cartography` 仅有 Package 入口和 `WorldViewState` 类型；Mesh Debug Viewer 不属于正式地图系统。`core`/`earthlike` 是最小契约数据，不是 M2 内容库。

本地已通过 `pnpm typecheck`、`pnpm lint`、`pnpm test`（`world-data` 8 项、`world-core` 70 项、Web 22 项）和 `pnpm build`；使用本机 Chrome 的真实 Worker 浏览器测试 2/2 通过。`cartography` 暂无单元测试；CI 工作流已在工作区添加，远端尚未运行。Mesh Debug 构建块约 566 kB，Worker/渲染峰值内存尚未测量。这批修改尚未提交，不能把本地通过等同于远端发布验收。

**M1 首个交付**应从已有 Mesh Pipeline 接入板块与地形 Stage，建立固定 Seed 基准、字段单位/海陆不变量和缓存失效测试；随后经完整领域校验组装并原子发布 `WorldSnapshot`。继续接入气候、水文和生态时，沿用 §7 的算法继承与质量约束。M2–M4 的文明、正式地图和浏览器存档仍按各自里程碑实施。

---

## 1. 产品边界与设计原则

### 1.1 四种不同的“数据”

| 概念 | 定义 | 示例 | 是否为世界事实 |
| --- | --- | --- | --- |
| `ContentDefinition` | 生成世界时可以使用的候选内容 | `kingdom` 政体、祖先崇拜原型、地名音节 | 否 |
| `GenerationArtifact` | 某阶段输出的可复用计算结果 | 板块拓扑、构造高程、逐月气候 | 中间产物；部分可以发布 |
| `WorldSnapshot` | 世界当前已被确认的权威事实 | 海拔、河流、城市、国家、居民组成 | 是 |
| `MapStyle` / `ViewState` | 世界事实的展示方式和当前 UI | Political Atlas、气候月份、选中城市 | 否 |

**禁止**：编辑 GeoJSON 就认为改变了国家边界；切换颜色导致世界重新生成；将候选内容中的“王国”模板当作已存在的王国实体。

### 1.2 五项强约束

1. **单向依赖**：内置内容 → 生成/模拟 → 权威世界 → 派生地理源 → 样式/渲染 → UI。
2. **领域化所有权**：每个物理量与实体只有一个权威拥有者；中间结果和显示缓存允许重复，但必须标明来源。
3. **可复现**：相同 `seed + config + generatorVersion + contentManifest` 在规定精度内复现相同世界。
4. **多尺度**：全球稠密网格、聚合人口和稀疏实体并存；禁止用每个居民的独立对象模拟全球人口。
5. **可演进**：保留已经通过验证的算法，但允许升级模型；任何可能改变生成结果的升级都必须记录版本与测试证据。

---

## 2. 技术栈与取舍

| 层级 | V1 选型 | 边界/决策 |
| --- | --- | --- |
| 仓库 | `pnpm-workspace.yaml`、TypeScript 严格模式 | 保持少量高内聚 Package |
| UI | Svelte 5、Vite、Bits UI、Tailwind CSS | 客户端工作台；深度响应式状态不包裹巨型 TypedArray |
| 图形 | Three.js `WebGLRenderer`（WebGL2） | 一个 Canvas，3D 球面 + 2D 地图两种 View |
| 网格与数学 | TypeScript + TypedArray、球面图算法 | 与 Three.js 完全解耦 |
| 创世与模拟 | Web Workers | Worker 内执行 CPU 密集任务，主线程只负责交互/渲染/查询 |
| 数据解析和校验 | TS 契约 + 运行时 Schema 校验 | 外部内容包/存档验证；计算热循环不逐元素重复校验 |
| 项目索引 | IndexedDB | 项目列表、配置与快照索引 |
| 大型存档 | OPFS / 导出的二进制档案 | 需处理配额、失败回滚、导入导出 |
| 测试 | Vitest、Playwright、确定性基准 | 算法不变量 + 全流程 E2E |
| 部署 | 静态站点为主，PWA 可选 | 不强制远端账号；未来同步服务另设边界 |

**暂不引入**：ECS 全面重写、Server-First 模拟、GPU Compute、Rust/WASM 全量移植、多 Worker 无差别并行。新增技术必须有基准测试支持。

已有项目使用 Svelte 5、Vite 8、Three.js 0.185、TypeScript 6、Vitest 4，迁移时优先保留实际可用的依赖组合；本文不承诺所有后续依赖版本在任意浏览器中保持兼容，应以锁文件与 CI 验证。

---

## 3. Monorepo 目录及依赖

下方是按 M0–M4 能力逐步形成的**目标目录结构**，不是当前工作区的文件清单；标注“后续”的目录属于更晚里程碑。只在对应功能落地且有实际代码时创建或细分目录。

```text
another-earth/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/                     # 生命周期、工作区 Shell、错误边界
│       │   ├── features/
│       │   │   ├── genesis/             # 创世向导、参数、阶段进度
│       │   │   ├── atlas/               # 地图、图层、图例、查询和选中状态
│       │   │   ├── project/             # 存档、恢复、导入导出
│       │   │   ├── editor/              # 后续：世界编辑
│       │   │   └── chronicle/           # 后续：历史时间轴
│       │   ├── runtime/
│       │   │   ├── generation-client.ts
│       │   │   ├── project-repository.ts
│       │   │   └── world-session.ts
│       │   ├── workers/
│       │   │   ├── generation.worker.ts
│       │   │   └── simulation.worker.ts # 后续
│       │   └── components/
│       └── package.json
├── packages/
│   ├── world-data/
│   │   ├── src/
│   │   │   ├── schemas/                 # 统一内容类型、校验
│   │   │   ├── names/                   # 地名、人名、语言命名规则
│   │   │   ├── cultures/                # 文化原型与特征
│   │   │   ├── religions/               # 宗教原型与特征
│   │   │   ├── governments/             # 政体类型
│   │   │   ├── species/                 # 智慧物种原型（先定义基础）
│   │   │   ├── resources/               # 资源目录和生成标签
│   │   │   ├── economy/                 # 后续：商品/产业定义
│   │   │   ├── technology/              # 后续：科技定义
│   │   │   ├── events/                  # 后续：事件模板
│   │   │   ├── presets/                 # 创世参数预设
│   │   │   ├── packs/                   # core/earthlike/fantasy（按需）
│   │   │   ├── registry.ts
│   │   │   ├── manifest.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── world-core/
│   │   └── src/
│   │       ├── mesh/                    # 球面、Voronoi、邻接/距离、投影映射
│   │       ├── math/                    # PRNG、Noise、优先队列、空间工具
│   │       ├── model/                   # World、单位、身份、状态所有权
│   │       ├── generation/
│   │       │   ├── pipeline/            # Stage DAG、依赖、Artifact 缓存
│   │       │   ├── nature/
│   │       │   │   ├── geology/
│   │       │   │   ├── terrain/
│   │       │   │   ├── climate/
│   │       │   │   ├── hydrology/
│   │       │   │   ├── ecology/
│   │       │   │   └── resources/
│   │       │   └── civilization/
│   │       │       ├── population/      # 宜居性、承载力与人口分布
│   │       │       ├── settlements/     # 聚落与城市
│   │       │       ├── transport/       # 道路、航线与可达性
│   │       │       ├── cultures/        # 民族与语言分布
│   │       │       ├── polities/        # 国家与行政归属
│   │       │       └── religions/       # 宗教与圣地
│   │       ├── simulation/              # 后续：时间 Tick、领域系统
│   │       ├── editing/                 # 后续：Command、Patch、Locks
│   │       ├── history/                 # 后续：事件、检查点、分支
│   │       ├── serialization/
│   │       ├── validation/
│   │       └── index.ts
│   └── cartography/
│       └── src/
│           ├── sources/                # 栅格、派生矢量、导入覆盖层
│           ├── styles/                 # StyleDocument、表达式、16 套预设
│           ├── projections/
│           ├── geometry/
│           ├── rendering/              # Globe、Map、图层、材质与资源管理
│           ├── picking/
│           ├── interactions/
│           └── index.ts
├── docs/
│   ├── PRD.md
│   ├── TECHNICAL_DESIGN.md
│   ├── WORLD_DATA_SPEC.md             # 按需拆分
│   ├── GENERATION_SPEC.md             # 按需拆分
│   ├── RENDERING_SPEC.md              # 按需拆分
│   └── ADR/
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**当前实现（2026-11-04）**：四个 Workspace Package 已存在，但目录尚未按上图展开。`world-core/src/generation/` 目前只有 Mesh Stage、Pipeline 及错误类型；`world-core/src/nature/` 和 `civilization/` 目前存放世界状态类型，`world/` 存放快照、字段、校验与档案代码。未来的生成算法可分别进入 `generation/nature/` 和 `generation/civilization/`，并在实现增长后按领域细分；现有事实类型不需要为匹配目标树而搬迁。`apps/web/src` 目前以 Mesh Debug Viewer、`lib/generation/` 和 Worker 链路为主；`world-data/src` 目前有内容 Schema、Catalog、内置包和校验；`cartography/src` 目前仅有入口和视图状态类型。实际文件和进度以工作区源码及 [`PROGRESS.md`](PROGRESS.md) 为准。

### 3.1 Package 依赖规则

```text
world-data  ──不依赖其他业务 Package──► 纯数据/类型/校验
     │
     ▼
world-core  ──依赖 world-data 的公开内容契约；不依赖渲染与 UI
     │
     ▼
cartography ──消费 world-core 发布的只读数据接口
     ▲
     │
apps/web ─────编排 world-data、world-core 和 cartography；负责浏览器适配
```

- `world-data` 允许依赖通用的 Schema/校验工具，但**不得导入 `world-core`、`cartography` 或 `apps/web`**。
- `world-core` 不允许导入 Three.js、Svelte、DOM；Worker 只是运行容器，不是算法自身的依赖。
- `cartography` 应依赖 `world-core` 的只读查询模型，**禁止修改权威世界字段**；内置地图样式属于 `cartography/styles`，不是 `world-data`。
- `apps/web` 不应绕过公开 API 修改底层网格或文明数据。
- 暂不为每个算法子目录创建一个 Package；未来出现独立复用或发布需求时再拆。

### 3.2 基础工程要求

- 全仓使用统一 TypeScript 严格配置、ESLint、格式化和 import 边界校验。
- 各 Package 具备明确 `exports`；避免业务层通过 `../../packages/.../internal` 访问实现细节。
- 支持 `pnpm -r build`、`pnpm -r test`、`pnpm -r typecheck`、`pnpm -r lint` 的明确脚本。
- 依赖版本由仓库锁文件管理；核心包可独立在 Node 测试环境中运行。

---

## 4. `world-data`：内置世界内容库

### 4.1 内容类型与范围

| 领域 | 建议初版内容 | 不应放入的内容 |
| --- | --- | --- |
| `names` | 地形/河流/城市/民族/国家/宗教名称词库、音节、组合规则 | 已生成城市名称与唯一命名结果 |
| `cultures` | 语言风格、价值倾向、文化特征 | 已生成民族分布和居民构成 |
| `religions` | 宗教原型、教义标签、传播偏向、组织结构 | 世界中实际宗教与信徒人数 |
| `governments` | 王国、城邦、共和、联盟等政体定义 | 某国实际制度、领土与首都 |
| `species` | 环境适应、生理特征原型（初版简化） | 具体世界物种种群快照 |
| `resources` | 矿物/农林/能源类型、地质关联标签 | 地图区块资源储量实例 |
| `presets` | 标准类地球、超级大陆、群岛、干旱、冰封等创世配置 | 某次生成的最终世界状态 |
| `events` | 事件模板和文本引用（后续） | 已发生的历史事件和年份 |
| `economy` | 商品、产业、生产类别（后续） | 实际市场价格、库存和生产量 |

数值参数应分为两类：

- **内容可配置参数**（例如宗教传播偏向、政体候选权重、地名结构）放在 `world-data`。
- **算法固有常量、数值求解器参数**（例如球面几何、Priority Flood 的数值阈值、温度计算公式）放在 `world-core`。若这些参数需要成为玩家可配置的生成规则，再通过正式 `WorldGenerationConfig` 暴露。

### 4.2 统一定义接口

```ts
export type ContentId = string;

export interface ContentDefinition {
  id: ContentId;                // 命名空间限定，如 core:government/kingdom
  version?: number;             // 单个定义的结构版本（可选）
  displayNameKey: string;       // 与 ID 分离，支持 i18n
  tags: readonly string[];
}

export interface GovernmentArchetype extends ContentDefinition {
  governance: 'centralized' | 'distributed' | 'federated';
  succession: 'hereditary' | 'elective' | 'appointed' | 'mixed';
  weights: { base: number; urban?: number; trade?: number };
}

export interface ReligionArchetype extends ContentDefinition {
  organization: 'decentralized' | 'hierarchical';
  traits: readonly string[];
  spreadBias: number;            // 有明确范围和默认值的无量纲倾向
  tolerance: number;
  weight: number;
}

export interface NamingProfile extends ContentDefinition {
  phonemes: readonly string[];
  syllableTemplates: readonly string[];
  wordParts?: readonly string[];
  patterns: Readonly<Record<string, readonly string[]>>;
}
```

这些定义是**可选内容**，并不是生成后的事实。比如 `core:government/kingdom` 只描述“可以产生一种王国政体”，不包含世界里的任何国家。

### 4.3 Content Pack / Manifest

以下是扩展内容包的目标接口草图；当前公开契约以 `packages/world-data/src/schemas/content.ts`、`catalog.ts` 为准。

```ts
export interface ContentPackManifest {
  id: string;                   // 例如 core:earthlike
  version: string;              // 语义化版本
  schemaVersion: number;
  nameKey: string;
  dependencies: readonly { id: string; versionRange: string }[];
  contentHash: string;          // 规范化后内容摘要
}

export interface ResolvedContentCatalog {
  manifest: readonly ContentPackManifest[];
  contentSignature: string;     // 被本次生成使用的内容集合摘要
  getGovernment(id: string): GovernmentArchetype;
  getReligion(id: string): ReligionArchetype;
  getNamingProfile(id: string): NamingProfile;
}
```

**装载流程**：发现 Pack → 校验 Manifest → 解析依赖 → 校验定义 → 检查 ID 冲突/外键 → 规范排序 → 计算内容签名 → 发布只读 Catalog。

当前 M0 实现提供 `loadBuiltinCatalog()` 和 `createContentCatalog()`；内置包 ID 为 `core`、`earthlike`，定义 ID 使用 `namespace:domain/name`。Manifest 依赖目前使用精确 `version`，不是上方示例的 `versionRange`；`ContentCatalog` 暴露 `packs`、`contentSignature` 与按 Pack ID 查询的 `get()`，尚无 `getGovernment()` 等领域专用方法。内容哈希为确定性的 `fnv1a32`，用于版本身份与意外变更检测，不是抗恶意碰撞的安全摘要。命名生成和外部扩展包加载尚未实现。

初版仅需内置 `core` 和 `earthlike`，后续 `fantasy` / `sci-fi` 是内容扩展，不应要求修改模拟核心的每个 Generator。**不在首版开放运行任意用户 JavaScript 脚本的 Mod 接口**，只接受经 Schema 验证的数据包。

### 4.4 命名系统确定性

- 稳定源：`worldSeed + generatorStage + entityStableId + namingProfileId + relevantPackVersion`；某个实体重命名不应影响其余所有实体。
- 词库/模板排序在参与选择之前规范化；禁止依赖导入顺序和对象遍历的偶然结果。
- 自带区域内名称去重、冲突时稳定后缀；为地形、城镇、国家、宗教分别设置命名策略。
- 用户手动指定名称属于 `WorldSnapshot` 的作者覆盖，不因词库更新自动被改写。
- `displayNameKey` / `localizedText` / 生成结果中的实际名称必须区分；内容包的本地化不等于改变世界事实。
- 新增内容条目可能改变候选池，**即使 seed 相同也可能改变结果**；因此存档必须记录 `contentSignature` 与算法版本。

### 4.5 数据加载与打包策略

- `core` 常用定义静态加载；大型语言素材、事件词库、扩展包按需加载。
- 不把几 MB 的词库强行包含到首页 UI Bundle。
- 内容校验在构建时和装载时运行；生成热循环使用已验证的内存视图，不反复解析 JSON。
- 测试覆盖 ID 唯一、引用有效、权重非负、数值上下限、翻译键齐全、确定性命名和内容签名稳定。

---

## 5. 权威世界模型（World Model）

### 5.1 核心对象

当前公开的 `WorldSnapshot` 是 Schema 2；`WorldProject` 仍是 M4 规划对象。下面仅列当前快照的顶层结构，字段细节以 `packages/world-core/src/world/` 源码为准。

```ts
export interface WorldSnapshot {
  readonly schemaVersion: 2;
  readonly snapshotId: string;
  readonly revision: number;
  readonly time: { readonly year: number };
  readonly metadata: WorldMetadata;
  readonly planet: PlanetParameters;
  readonly mesh: MeshTopology;
  readonly nature: NatureState;
  readonly civilization: CivilizationState;
}

export interface WorldMetadata {
  readonly worldId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly seed: string;
  readonly generatorVersion: string;
  readonly contentSignature: string;
  readonly contentPacks: readonly { readonly id: string; readonly version: string; readonly contentHash: string }[];
  readonly generationConfig: { readonly planet: PlanetParameters; readonly mesh: MeshConfig; readonly regionCount: number; readonly civilizationEnabled: boolean };
  readonly provenance: { readonly stageVersions: Readonly<Record<string, string>>; readonly artifactSignatures: Readonly<Record<string, string>>; readonly configSignature: string };
}
```

其中 `MeshConfig` 是此处对当前 Mesh 细分等级、扰动和可选 Seed 覆盖的简写，不是已导出的类型。`WorldViewState` 已在 `cartography` 中独立定义，包含模式、样式/图层、月份、选中实体和具体相机字段，不进入生成签名。当前 `generationConfig` 和 `provenance` 只覆盖 M0/Mesh；M1 新 Stage 必须记录实际使用的配置与来源。Schema 1 尚无迁移器，不能直接由 Schema 2 解码器读取。

### 5.2 自然状态建议

```ts
export interface NatureSnapshot {
  geology: GeologySnapshot;        // 板块、地壳、应力与构造诊断
  geography: GeographySnapshot;    // 高程、地貌、海陆、海底地形
  climate: ClimateSnapshot;        // 月温、月降水、风场、洋流、Köppen
  hydrology: HydrologySnapshot;    // 流域、河流、湖泊与水量
  ecology: EcologySnapshot;        // 生物群系、土壤、植被、土地覆盖
  resources?: ResourceSnapshot;    // 初版可先有分布/适宜性
}
```

区分**权威状态**（如海拔）、**模型诊断**（如构造贡献）、**可派生字段**（如坡度）和**展示缓存**（如用于当前配色的 RGB 顶点颜色）。这些字段的储存和更新策略不同。

### 5.3 世界中的四种数据形态

| 类型 | 表示 | 示例 | 关键约束 |
| --- | --- | --- | --- |
| Dense Field | `Float32Array` / `Uint8Array` / `Int32Array` | 高程、人口密度、气候、国家归属 | `meshId`、长度、dtype、单位、缺测值 |
| Graph | CSR 邻接和稀疏边集合 | 区域拓扑、河网、交通 | 稳定节点归属和可验证连接 |
| Entity | 稳定 ID 对象及索引 | 城市、国家、民族、宗教、河流、湖泊 | 不以数组位置作为跨时间实体 ID |
| Derived Feature | 用于制图与查询的矢量对象 | 国界线、道路中心线、地名标签 | 可重建；不得作为唯一事实源 |

**区域索引只在同一 Mesh 内有效**。改变输出网格分辨率会导致区域映射变化。城市、国家、河流等应持有跨快照稳定身份；每个快照根据位置/拓扑建立到当前区域的映射。

### 5.4 单位体系

| 字段 | 建议单位 | 说明 |
| --- | --- | --- |
| `planet.physicalRadiusKm` | km | 控制球面面积、距离、重力或物理公式 |
| `view.renderRadius` | arbitrary scene units | 仅影响 Three.js 场景尺度 |
| 地形高程 | km / 相对海平面 | 内部地形塑形坐标另设类型，不混用 |
| 温度 | °C | 明确是月平均、年平均或瞬时 |
| 降水 | mm/month | 年总量为按月求和 |
| 径流 | mm/year 或 mm/month | 明确时间基准 |
| 河流流量 | m³/s | 明确年平均或月份 |
| 人口密度 | persons/km² | 使用物理区域面积 |
| 路径距离/成本 | km / equivalent-km | 距离不等于旅行时间或货运量 |

当前自然领域已有归一化高程到 km 的显式转换；新设计应让“用于塑形的无量纲高程”与“公开的物理高程”之间的转换更清晰，并统一记录每个中间字段的单位。

### 5.5 状态发布与所有权

- Stage 在私有工作区可以高效地原地修改 TypedArray；发布的 `WorldSnapshot` 由数据所有者统一管理。
- 显示层得到只读 Query/FieldView；避免把原始可写 Buffer 随意暴露到 Svelte 组件。
- 修改世界事实必须通过受控 Patch/Command；修改 Style 和摄像机只影响 `WorldViewState`。
- 不使用 `Object.freeze()` 作为 TypedArray 的强不可变保证；采用独占 Buffer、只读 API、版本号和受控替换。
- 发布新快照时先通过关键领域校验，再原子切换为当前世界；生成失败保留最后成功世界。

---

## 6. Generation：Stage DAG、产物与增量生成

### 6.1 目标模型

当前 `feat-society` 的 `PipelineScheduler` 串行执行 18 个 Stage，这对批量生成有效。新架构需要显式声明依赖，但第一版**仍允许串行执行**，不因为 DAG 就立即上多个 Worker。

```text
Mesh
 └── Plate Topology
       ├── Candidate Land / Crust
       └── Plate Dynamics
                ↓
         Tectonic Fields
                ↓
           Terrain Base
                ↓
         Terrain Finalization
                ↓
        Climate Circulation
                ↓
          Monthly Climate
                ↓
       Climate Output Projection
         ├── Köppen / Climate Classification
         ├── Hydrology (Drainage + Rivers + Basic Lakes)
         └── Ecology / Potential Biome
                  ↓
           Resources / Habitability
                  ↓
          Population + Settlements
                  ↓
               Transport
                  ↓
              Ethnicity
                  ↓
               Polities
                  ↓
              Religions
```

上图为逻辑依赖，**并非强制完全顺序**：Köppen、流域、生态的真实依赖应由 Stage 的声明和测试决定。已确认的部分如水文需要最终地形和月度气候，并不必等待所有生物群系分类完成。

### 6.2 Stage / Artifact 协议

以下展示目标 Artifact 契约，不是当前 `GenerationStage` 的逐字声明。M0 已实现的 Stage 使用 `dependencies` 指向上游 Stage ID、`configKeys`/`contentKeys` 声明签名输入，通过 `StageExecutionContext.getDependency()` 读取只读输出；`PipelineResult.getOutput()` 返回借用产物。独立的 `StageArtifact<T>` 包装及跨 Stage 字段来源元数据仍待 M1 按实际消费者引入。

```ts
export type StageId = string;
export type ArtifactId = string;

export interface GenerationStage<TOutput> {
  readonly id: StageId;
  readonly version: string;
  readonly inputs: readonly ArtifactId[];
  readonly configKeys: readonly string[];        // 仅列与输出相关的生成参数
  readonly contentKeys?: readonly string[];      // 使用了哪些内容域/包
  execute(ctx: StageExecutionContext): TOutput | Promise<TOutput>;
  validate?(output: TOutput, ctx: StageExecutionContext): void;
}

export interface StageArtifact<T> {
  id: ArtifactId;
  producer: StageId;
  version: string;
  signature: string;
  payload: T;
  metadata: {
    meshId?: string;
    fieldUnits?: Record<string, string>;
    createdFrom: readonly string[];
  };
}

export interface StageExecutionContext {
  config: Readonly<WorldGenerationConfig>;
  content: ResolvedContentCatalog;
  inputs: ReadonlyMap<ArtifactId, StageArtifact<unknown>>;
  rng: DeterministicRandom;
  cancellation: { throwIfCancelled(): void };
  progress: (fraction: number, message?: string) => void;
}
```

关键点：**输出产物具有独立身份**，跨 Stage 读取产物而不是在一个全部可选属性的共享黑板上推断状态。允许内部写入，但跨产物副作用必须成为显式的数据依赖。

初版可以分阶段引入该契约：先包装现有 Stage，再将内部领域生成器逐步转换，避免一次性重写成熟算法。

### 6.3 缓存签名与失效传播

建议定义：

```text
artifactSignature = hash(
  stageId,
  stageVersion,
  relevantConfigSubset,
  relevantContentSignature,
  dependencyArtifactSignatures,
  gridOrMeshIdentity
)
```

- `Style`、`Camera`、可视化月份不影响生成缓存键。
- Stage 读取哪些配置和内容需要声明；不能“声明只依赖人口倍数”，代码却偷偷读取地形粗糙度。
- 依赖变化后按 DAG 传播失效，尚无局部算法时**先整 Stage 重算**。
- 矩阵、拓扑、网格等静态数据优先缓存；高成本中间结果按预算 LRU 保留。
- 对同一 Stage、相同输入，缓存命中结果必须与全量生成结果等价。

| 用户操作 | 初版应当重算 | 理论可复用 |
| --- | --- | --- |
| 更换地图样式 | 仅制图资源 | 所有世界事实 |
| `populationScale` | 人口及其下游文明 | 全部自然系统 |
| `roadConnectivity` | 交通及依赖交通的人文分布 | 自然、人口与聚落 |
| `temperatureOffsetC` | 月度气候及其下游 | 网格、地质、地形、部分环流 |
| `hydraulicErosion` | 地形终处理及下游 | 网格、板块和初始构造场 |
| `core.detail` | 输出网格及下游产物 | 与输出网格无关的参考级产物 |
| 更换 `names` 内容包 | 使用该命名域的相关实体与派生文本 | 无关自然字段；具体由内容依赖决定 |

### 6.4 确定性和 PRNG

- 每 Stage 派生独立 RNG：`deriveSeed(seed, stageId, stageVersion)`。
- 对实体相关的随机选择使用 `deriveSeed(seed, stageId, entityStableId, contentSignature)`，避免“多生成一座城市导致所有后续名称改变”。
- 对排序并列、随机抽样、CSR 组装、地图边界必须定义稳定 Tie-break。
- 各浏览器浮点实现与并行顺序可能使结果不具备逐位相等的保证；明确数值容差与可复现范围。
- 如果必须精确回看历史，不能只依赖 Seed 重新执行可能升级的旧算法；应保存检查点和已计算差量。

### 6.5 取消与错误边界

- 每次任务有 `requestId`；只接收最新有效任务结果。
- CPU 大循环中定期检查取消标志；同步计算不一定能实时处理同一 Worker 收到的取消消息，首版使用终止 Worker 兜底。
- 发布世界应为原子操作，失败不能安装半成品 `WorldSnapshot`。
- 错误记录 `stageId`、配置摘要、内容签名、输入形状和运行版本；UI 提供重试及错误摘要。

---

## 7. 自然世界生成：算法继承与升级方案

> 本节用于确定“保留哪些自然算法、改进什么、何时改”，不是承诺首版实施完整物理模拟。

### 7.1 球面网格与参考尺度

**沿用**：Icosphere/Voronoi、邻接 CSR、区域面积与球面距离、固定参考网格及输出网格映射。

当前源实现的参考网格采用细分等级 6，约 **40,962** 个 Region；默认输出网格 **163,842** 个 Region。可持续使用两级结构进行宏观地质和气候计算。

**优化**：

- `meshId`、`referenceMeshId` 与投影映射独立缓存；并区分地质扰动映射与地理气候映射，禁止混淆。
- 几何拓扑、边长、面积、区域法向等稳定计算只构建一次；换配色不重建网格。
- 对 `Icosphere` 的合法区域数建立明确枚举/转换；当前配置字段 `core.detail` 的注释与实际“目标区域数”语义需统一。
- 检查网格闭合、Euler 特征、面积总和、邻接对称与映射合法性。

**暂不实施**：任意分辨率持续可变网格重拓扑或动态局部细分；首先解决多精度引用与事实身份保持。

### 7.2 板块、地壳、大陆与构造

**沿用**：板块种子/方向性区域生长、主/微板块拓扑、Euler 角速度、构造边界、候选大陆控制、地壳密度/厚度、火山岛弧与热点。

**优化**：

1. 区分 `candidateLandCoverage`、`actualLandCoverage`、`targetLandCoverage`。当前陆地占比配置主要控制候选分布，地形与侵蚀会影响最终比例；报告偏差而非静默假装精确满足目标。
2. 对最终可见大陆数量、岛屿数量、面积分布、板块边界山脉关联度建立世界质量指标。
3. 宏观构造参数与微观噪声参数分别分组；山脉的地质成因应可以被解释面板追溯。
4. 将“板块拓扑”和“候选大陆归属”分开缓存；参数变动只重算必要下游。
5. 将地质贡献（褶皱、拉张、岛弧、热点、地幔抬升等）留作可查询的诊断字段。

**暂不实施**：跨数亿年的真实板块动力学积分；世界文明年与地质年代是不同时间尺度。

### 7.3 构造高程与地形后处理

**沿用**：TectonicElevationGenerator 的构造高程与分类、Phasor 山脊、Edifice 贡献；TerrainPostProcessor 的 Warp、细节 Noise、海岸稳定、平滑、冰川/水力侵蚀等思路。

**改进重点**：现有单个 TerrainPostProcessor 同时在一份可变高程数组上运行大量处理，难以隔离中间状态和实现局部再生成。建议拆成可独立产出的概念步骤：

```text
Tectonic Skeleton
  → Relief Texture
  → Terrain Warp
  → Coastline / Sea-Level Policy
  → Smoothing / Local Detail
  → Erosion & Deposition
  → Final Elevation (km)
  → Slope / Aspect / LandMask / Terrain Classification
```

**具体规则**：

- 明确 `terrainWorkingElevation`（用于塑形的无量纲量）与 `elevationKm`（公开物理高程）的转换边界；不要把数值类型相同的字段当作单位相同。
- 海陆掩码由明确的阶段权威生成。当前流程会在侵蚀前固定 `oceanMask`，最后又从更新后的高程构建 `landMask`；需验证海岸线跨零后的差异，并选择“冻结海岸”或“允许海岸更新”策略。
- 冰川侵蚀目前主要根据纬度/高度近似；V1 保留。**V2 高级模式**可采用“初始地形 → 初步气候 → 气候驱动侵蚀 → 最终气候”的有限迭代，不建议首版加入无限反馈循环。
- 将侵蚀与最终排水分开：侵蚀可使用代理排水，最后由统一 `DrainageNetwork` 生成真正的河网，避免两个消费者对水流方向的解释不一致。
- 地形编辑需要支持 `elevationPatch` 与 `invalidatedDomain`；首次支持整 Stage 重算，之后才增加局部侵蚀/流域重算。

**V1 验收**：无 NaN、海陆掩码一致、地形范围可控、形态有解释、同 Seed 在版本内稳定；且不同地形参数的效果可测。

### 7.4 季节环流与月度气候

**沿用**：四个季节锚点、ITCZ 迁移、季风/纬度气压带、风/洋流代理场、12 个月温度与降水、海陆性、雨影/地形抬升、降水总量约束。

**必须明确模型定位**：这是一套可解释、可调校的 **EarthlikeClimateModel**，不是通用行星大气数值求解器。当前存在针对类地球的温度基线、海陆经验系数、季风增益和降水上限。若扩展星球自转周期、大气密度或不同恒星辐射，应建立独立 Planetary Forcing 层，而不是仅叠加 `temperatureOffsetC`。

**优化**：

- 将 `planetary forcing`（倾角、辐射/季节）与 `surface response`（海陆、地形、风和降水）逻辑隔离。
- 月度模型当前每月约调用温度求解三轮、降水求解两轮；先分析每轮的质量收益，缓存重复的风、空间梯度和传播权重，禁止未经对照测试直接删迭代。
- 高分辨率气候继续在参考网格计算、向输出网格插值，并以物理面积加权和降水守恒系数验证总量。
- 当前气候投影使用 3 个邻近气候网格点，源索引为 `Uint16Array`（因此源区数上限为 65,535）；未来若改参考网格精度，必须同步修改索引类型与序列化格式。
- 当前输出网格超过 250,000 Region 时不常驻物化全部输出月份字段，应保留这种内存策略，并支持按月采样/缓存。
- 建立纬度-温度曲线、季风、干旱带、雨影、海岸湿润度、南北半球季节反转的统计与视觉回归。

**V1 验收**：12 个月温度/降水有限且合法；聚合年值一致；降水不会因分辨率变化出现显著无因变化；高精度模式不强制常驻全年巨型数组。

### 7.5 水文：Priority Flood → River/Basin/Lake

**沿用**：Priority Flood、单调排水树、无环下游、汇流累积、流量单位、河流级序与水量守恒验证。

**升级为三种对象**：

| 对象 | 最小字段 | V1 范围 |
| --- | --- | --- |
| `Basin` | 稳定 ID、汇水区域、出口/内流类型、汇总面积与水量 | 基础流域划分 |
| `River` | 稳定 ID、上游/下游、河道区域路径、年平均流量、级序 | 可选中、可查询的河流 |
| `Lake` | 稳定 ID、盆地、面积、最大/当前水位、出入口 | 基础静态湖泊，不做完整动态水库 |

**关键问题**：当前对于完全无海洋出口的陆地分量可以建立内部汇点，但未把它表达为可见湖泊；“优先队列填洼生成可排水表面”与“真实盆地蓄水/蒸发”应区分。**计算路由辅助面不等于改变最终地表高程。**

未来如加入人工改道、水坝和灌溉，必须把河网从简单 `riverMask` 扩展为稳定实体和图连接。水文更新可利用下游依赖传播，而非只依赖笔刷覆盖区。

### 7.6 生态：Potential Biome 与实际 Land Cover

**沿用**：Köppen、月温/月降水、潜在蒸散和生长季的生物群系分类。

**升级**：保留离散 `biomeClass` 供专题图和生态规则使用，同时增设连续生态状态（均为明确单位或无量纲范围）：

```ts
interface EcologyFields {
  potentialBiome: Uint8Array;       // 未经人类改变的潜在生态类型
  landCover: Uint8Array;            // 当前森林、草地、农田、城市等覆盖类型
  soilFertility: Float32Array;      // 约定的相对肥力指数
  soilMoisture: Float32Array;       // 相对可利用水分
  vegetationCover: Float32Array;    // 植被覆盖比例
  biomass?: Float32Array;          // 后续可加入物理单位
  agriculturalPotential: Float32Array;
}
```

潜在生物群系属于自然适应性，实际土地覆盖可以由文明开垦、砍伐、火灾和生态恢复改变；二者不应互相覆盖。首版可只提供自然覆盖和基础土壤/农业适宜性，不做全球物种食物网。

### 7.7 自然资源：连接自然与文明

**V1 只建初始资源基础**，不实施完整商品经济。资源定义（种类、地质标签、稀缺度）在 `world-data`，空间分布和数量估计在 `world-core`：

- 矿产由地质、造山、火山和地壳条件决定概率。
- 农业潜力来自温度、降水、土壤、坡度与水源。
- 林业和渔业潜力由植被覆盖、海洋条件与沿岸环境决定。
- 对每个生成资源记录依据的主要自然因素，便于文明的因果解释。
- 资源的“潜在分布”“已发现”“已开发”“剩余储量”是不同状态，后续经济模拟可逐步补齐。

### 7.8 自然系统验收矩阵

| 类别 | 统计不变量 | 对照场景 |
| --- | --- | --- |
| Mesh | 面积总和近似球面面积、邻接对称、投影索引有效 | 低/高精度网格 |
| Plates | 每个区域板块归属合法、构造边界可追溯 | 低板块数/高板块数 |
| Terrain | 有限值、高程单位、海陆掩码一致 | 超大陆、群岛、低海拔 |
| Climate | 合法气温/降水、全年/月度一致、区域插值稳定 | 高倾角、干旱、冰封 |
| Hydrology | 无环下游、出流及内流可解释、流量收支 | 大内陆盆地、多岛屿 |
| Ecology | 陆地分类合法、潜在生物群系与实际覆盖区分 | 温带森林、极地、沙漠 |
| Resources | 与形成条件相关、不出现非法储量 | 火山岛、山地矿带、河谷平原 |

---

## 8. 文明初始生成

### 8.1 生成顺序

```text
Nature + Resource Potential
  → Habitability / Carrying Capacity
  → Population + Settlements
  → Transport / Sea Links / Market Access
  → Ethnic Groups / Languages
  → Polities / Administration
  → Religions / Sacred Sites
  → CivilizationSnapshot Validation
```

当前 `feat-society` 已具备人口与聚落、交通、民族/语言、国家/行政、宗教/圣地的静态生成逻辑，这些应优先迁移并保存基准结果。

### 8.2 数据一致性

- `Civilization.population[region]` 是该区域人口权威值，聚落人口是包含在其中的集中居民，不能重复累计。
- 民族与宗教使用按区域 CSR 稀疏构成，合计应与区域人口一致（允许明确浮点容差）。
- `dominantGroup`、`dominantReligion` 只是展示/查询缓存，不替代完整居民组成。
- 国家人口、未划归人口和世界总人口的账本必须可核对。
- 国家/城市/文化/宗教具有**稳定实体 ID**；“名称发生变化”不代表删除并重建同一实体。
- 道路与航线具有实际连接关系；相邻海岛间文化传播不应跳过交通条件。
- 内容包中的类型（例如政体原型、宗教特征）记录为生成实体所采用的 `archetypeId`，但并不强行决定某个世界实体的全部行为。

### 8.3 资源与文明结合的初版边界

资源影响宜居性、城市选址和潜在产能，但首版不做跨城商品价格求解。长期可扩展为：资源→生产部门→产出与库存→市场→税收与国家决策。

**重要**：资源分布在 `world-core` 中属于世界事实；资源定义和权重来自 `world-data`；资源专题图来自 `cartography`。

---

## 9. Cartography：Data Source、Style、Rendering

### 9.1 数据流和所有权

```text
WorldSnapshot (authoritative)
  └─ WorldQuery / ChangeSet
      └─ Instance SourceRegistry
          ├─ Dense Raster Sources
          ├─ Derived Vector / GeoJSON Sources
          └─ User Overlay Sources (non-authoritative unless transformed to Command)
              └─ StyleDocument + Style Compiler
                  └─ Render Layers + Pick Index
                      └─ GlobeView / AtlasView
```

- SourceRegistry 必须**按世界实例**创建，杜绝全局单例导致多个世界交叉污染。
- 源 Schema 与真实字段同步；每个字段记录 dtype、单位、meshId、revision、缺测值；内容版本与样式版本分别管理。
- 派生矢量源有明确依赖签名，不能依赖 WeakMap 对象 identity 自动推断数据是否发生原地修改。
- 改变某个 Source 只失效实际消费它的 Layer；区分几何变化、Paint 变化、Visibility 与 Viewport 变化。
- 不允许地图层直接修改 `WorldSnapshot`、把修改过的 GeoJSON 当作真实国界。

### 9.2 Style Spec 与内置风格

三层制图模型：**Base Map / Thematic / Overlay**。样式由可序列化 DSL、Tokens、图层定义和 Zoom 规则组成，不储存任意函数。

**16 套内置风格**（来自 PRD，放在 `cartography/styles/presets`）：

| 类别 | 预设 |
| --- | --- |
| 常规制图 | Standard Atlas、Physical Relief、Political Atlas |
| 卫星/测绘 | Satellite、Topographic、Bathymetric |
| 极简 | Minimal Light、Minimal Dark、Monochrome Print |
| 科学专题 | Climate Scientific、Biome & Ecology、Population & Economy |
| 历史/奇幻 | Historical Parchment、Fantasy Cartography、Imperial Chronicle |
| 文明视觉 | Night Lights |

首版优先完成 Standard Atlas、Satellite、Physical Relief、Political Atlas、Minimal Dark、Historical Parchment，其余复用相同 Style Spec 逐步添加，不得每套预设单独编写一份渲染器。

**关键规范**：

- 所有内置样式必须通过统一的 Source/Layer Schema 校验；所使用的 Symbol 属性在 Renderer Registry 中必须合法。
- `StyleCompiler` 缓存表达式，避免每帧对每个区域递归解释完整 AST。
- 表达式允许根据 Zoom 与 Feature 属性求值；Raster 的 Zoom 不能永久固定为 `0`，除非 Spec 明确禁用缩放相关表达式。
- Layer 变化时使图例、标注、Picking 索引与渲染状态保持一致。

### 9.3 Renderer 架构

- 单个 `WebGLRenderer` / Canvas；`GlobeView` 使用球面透视相机，`AtlasView` 使用投影平面及正交相机。
- 仅当前活跃视图必要的 GPU 资源立即初始化；未激活视图采用懒加载，切换时可复用最近的 GPU 缓存。
- 将形状（Geometry）、属性（Paint）、布局（Label Layout）和 View（Camera/Viewport）分离更新。
- 避免在密集 Cell 表面使用不必要的非索引三角形重复顶点，保留必要的 Cell→Geometry 映射。
- 经常切换的连续专题色优先评估基于 Cell ID 的 Buffer/DataTexture + Shader Lookup；不要为了单次颜色变化重建整个球面几何。
- 文字标签单独处理碰撞与视口变化。**只平移、不缩放**的操作也必须更新标签裁剪和碰撞布局，不能仅按 Zoom 缓存。
- 地图投影处理跨日期变更线接缝、极区变形与线段裁切。
- 维护 `dispose()` 生命周期清单：图层、订阅、控制器、材质、Geometry、Texture、拾取索引。

### 9.4 Picking / Interactions

统一交互结果：

```ts
export interface PickResult {
  viewId: 'globe' | 'atlas';
  layerId: string;
  sourceId: string;
  featureId?: string;
  regionId?: number;
  entityId?: string;
  screenDistancePx?: number;
}
```

拾取优先级由交互模式控制；未来编辑器应直接复用 PickResult，而不是在页面点击处理器中分别硬编码城市、河流、国界的选择流程。

---

## 10. 编辑器：Command、Patch 与影响分析（未来功能，基础契约先定）

### 10.1 世界事实与地图装饰分离

- **Fact Editing**：高程、河流、资源、聚落、国界、文化等，改变世界事实并触发依赖更新。
- **Cartographic Annotation**：标签、纹章、注释、出版符号，只改变视图，不触发模拟。

### 10.2 最小命令协议

```ts
export interface WorldCommand {
  id: string;
  kind: string;
  expectedRevision: number;
  preview(world: WorldReadModel): ChangeImpact;
  apply(world: MutableWorldDraft): WorldPatch;
}

export interface ChangeImpact {
  changedDomains: readonly string[];
  affectedRegionIds?: Uint32Array;
  invalidatedStages: readonly string[];
  affectedEntityIds?: readonly string[];
  requiresConfirmation: boolean;
}
```

- 先 Preview（直接影响与潜在间接影响明确区分）→ 用户确认 → 执行 Command → 校验 → 原子发布 Snapshot → Source 失效。
- Undo/Redo 保存反向 Patch，不依赖重新跑随机生成器来“撤销”。
- 编辑与算法自动生成共存：每个可编辑事实存在 `generated`、`user-override`、`locked` 等来源信息。
- 自动重算必须尊重锁定规则；产生不可解决的约束冲突时必须报告，而不能静默删除锁定的城市或改名。

### 10.3 空间影响范围

| 修改行为 | 初版失效策略 | 未来局部优化 |
| --- | --- | --- |
| 高程画笔 | 地形相关派生及下游整阶段重算 | 局部坡度，按流域延展水文范围 |
| 河道改线 | 水文及下游生态/人口依赖 | 上游/下游水系子图失效 |
| 更改城市名称 | 指定实体及搜索/标注缓存 | 局部文本更新 |
| 国界重划 | 国家统计/专题图/相关模拟 | 局部国家实体和区域更新 |
| 更改地图样式 | Style/Render 层 | GPU Paint 参数更新 |

气候传播、河流下游、交通连通和人口迁移都可能跨越笔刷半径；**不能以被画笔覆盖的 Cell 数直接推断全部因果影响域。**

---

## 11. Civilization Simulation 与历史（架构预留）

### 11.1 静态生成 ≠ 动态模拟

`Generation` 负责创世时生成合理的初始世界；`Simulation` 负责在已存在世界上推进时间。两者共享领域模型、验证器、内容定义，但不能将“每年重新生成整个国家/宗教”作为历史演化。

### 11.2 时间步与执行顺序

- 采用固定的模拟时间 Tick，权威时间不等于 UI 的 `requestAnimationFrame`。
- V2 首先做年度 Tick；农业生产/市场后续可增加季度或月度子步。
- 建议执行顺序：自然事件 → 资源/粮食 → 人口 → 城市/交通 → 文化/技术 → 政治/外交 → 事件和校验。
- 对每个模拟系统声明读取、写入、频率和依赖；反馈可跨 Tick 或在显式的局部迭代中解决，不让顺序意外决定结果。
- 战争采用军队、战线、战役层级；人口按聚合 Pop 管理，不模拟全球每个人。

### 11.3 可解释事件

```ts
export interface WorldEvent {
  id: string;
  year: number;
  kind: string;
  actorIds: readonly string[];
  location?: { regionId?: number; entityId?: string };
  causeIds: readonly string[];
  effectIds: readonly string[];
  metadata: Record<string, unknown>;
}
```

事件记录因果叙事索引，但不是所有数值变化的唯一存储形式；历史准确回放需要状态检查点与差量。

### 11.4 历史存档

- **Checkpoint**：周期性的完整可恢复世界状态。
- **Delta**：年度或阶段变更集；需要版本、校验和顺序保证。
- **Event Log**：重要事件、实体沿革、因果与叙事检索。
- **Branch**：共享分支点以前的不可变历史，之后独立推进。

历史回放不能简单通过旧 Seed 调用当前版本生成算法来替代存档，否则升级算法可能使历史失真。

---

## 12. Worker 与浏览器运行时

### 12.1 职责拆分

| 执行环境 | 职责 |
| --- | --- |
| 主线程 | Svelte、Three.js、地图控制、详情面板、轻量查询 |
| Generation Worker | Stage DAG、自然/文明创世、阶段耗时和可取消任务 |
| Simulation Worker（后续） | 时间 Tick、事件和动态更新 |
| Storage Worker（可选） | 大型快照压缩/解压及数据校验；按需要加入 |

### 12.2 消息协议

以下消息联合类型是完整创世的目标草图。当前 `apps/web/src/lib/generation/protocol.ts` 仅传递 Mesh 生成、取消、清缓存与拾取请求，以及相应进度和结果；`COMPLETED` 携带 Mesh DTO，不携带 `WorldSnapshot`。M1 扩展协议时应沿用 `requestId`、旧请求结果丢弃、失败保留最后有效结果及 Buffer 所有权约束。

```ts
export type GenerationRequest =
  | { type: 'GENERATE'; requestId: string; config: WorldGenerationConfig; contentSignature: string }
  | { type: 'CANCEL'; requestId: string };

export type GenerationResponse =
  | { type: 'STAGE_STARTED'; requestId: string; stageId: string }
  | { type: 'STAGE_PROGRESS'; requestId: string; stageId: string; fraction: number }
  | { type: 'STAGE_COMPLETED'; requestId: string; stageId: string; durationMs: number }
  | { type: 'GENERATION_COMPLETED'; requestId: string; snapshot: WorldSnapshot }
  | { type: 'GENERATION_FAILED'; requestId: string; stageId?: string; error: string }
  | { type: 'GENERATION_CANCELLED'; requestId: string };
```

消息只携带可结构化克隆对象与 TypedArray；类实例恢复必须显式处理。`contentSignature` 必须能在 Worker 内解析成同一已校验内容集合，不能只发送摘要却不保证加载内容一致。

### 12.3 Buffer 所有权与缓存

当前 M0 网格链路由 Worker 缓存持有原始 Mesh Buffer，发送前制作传输副本并 Transfer 给主线程；主线程显式恢复 Mesh。Buffer 一经转移，源 Worker 中的同一 ArrayBuffer 就不能继续用于缓存。硬取消使用 `terminate()` 并重建 Worker，因此会丢失其内存缓存。

V1 可采用：

1. 持久化不需要复用的最终 Buffer 直接 Transfer 给主线程。
2. 有价值的中间产物由 Worker 持有，不转移其原 Buffer；必要时复制用于发布，明确内存成本。
3. 按任务结束时释放不可复用临时数组；缓存设置最大字节预算和 LRU。
4. `SharedArrayBuffer`、多 Worker 与共享缓存仅在实际性能需要、部署隔离策略允许时引入。

在 Worker 内运行同步大循环时，单独发送 `CANCEL` 消息可能直到当前计算结束才被处理；必须设计阶段/循环内取消或主线程 `terminate()` 强制回收机制，避免虚假“即时取消”。

---

## 13. 世界存档、版本与内容一致性

当前 M0 仅实现 `encodeWorldArchive` / `decodeWorldArchive` 的版本化 JSON 往返：保存 TypedArray 类型，校验快照、内容包版本/签名和校验和。它不是 `.aearth`，也没有 IndexedDB、OPFS、浏览器保存/导入流程。以下 §13.1–13.3 是 M4 的目标设计，不应将逻辑目录图视为当前文件格式。

### 13.1 本地存储层

| 位置 | 内容 |
| --- | --- |
| IndexedDB | 项目列表、元数据、世界索引、设置、内容引用 |
| OPFS | 大型二进制字段、快照、计算缓存、未来检查点 |
| 导出档案 `.aearth` | 可携带的世界事实 + 内容与算法版本 + 必要视图信息 |

支持完整导入/导出；OPFS 存储空间可能被浏览器清理或遇到配额限制，不能作为用户唯一备份。写入采用“写临时文件 → 校验 → 更新索引/提交”的恢复策略，防止部分文件完成却索引已经指向损坏快照。

### 13.2 逻辑档案结构

```text
world.aearth
├── manifest.json
│   ├── schemaVersion
│   ├── generatorVersion / stageVersions
│   ├── contentPacks / contentSignature
│   ├── generationConfig
│   ├── meshId / checkpointId / checksums
│   └── savedAt
├── mesh/
│   ├── topology.bin
│   └── geometry.bin
├── nature/
│   ├── geology.bin
│   ├── geography.bin
│   ├── climate.bin
│   ├── hydrology.bin
│   └── ecology.bin
├── civilization/
│   ├── fields.bin
│   └── entities.json
├── author-overrides.json
├── view.json
└── history/                  # V2+
```

上述为**逻辑结构**，具体文件归档与压缩格式在实现时固定为版本化规范。每个二进制字段记录 dtype、元素数量/shape、单位、grid ID、字节序、压缩算法和校验和。

### 13.3 兼容性边界

- **Snapshot SchemaVersion**：存档结构是否可读取。
- **Generator/StageVersion**：是否能对旧 Seed 重新生成相同世界。
- **ContentPackVersion + ContentSignature**：名称、文化、资源、政体等候选内容是否相同。
- **StyleVersion**：仅影响地图外观；不能影响自然或文明事实。
- **SimulationRulesVersion**：未来同一历史检查点继续演化时所采用的动态规则。

存档加载时必须提示缺失内容包、未知字段和无法迁移版本；优先恢复已有世界事实，避免“用新模板重新生成一遍”覆盖用户的世界。

---

## 14. 性能策略、预算和监测

### 14.1 世界规模档位（设计目标，非实测性能）

| 档位 | 目标区域规模 | 主要用途 |
| --- | --- | --- |
| Lite | 约 1 万–4 万 | 快速预览与低性能设备 |
| Standard | 约 4 万–16 万 | 主要桌面体验 |
| High | 约 16 万–65 万 | 高精度静态世界与地图研究 |

真正 Icosphere 区域数只能取合法的离散等级；参数应映射为可用规模。地理精度变高**不等于**文明模拟实体数和更新频率同比例提高。

### 14.2 必须独立统计的成本

- **Generation**：每 Stage CPU 时间、整体耗时、峰值 JS/Worker 内存、临时数组。
- **Rendering**：FPS、Frame Time、Draw Calls、Triangles、GPU Buffer/Texture、视图切换。
- **Query/UI**：Picking 延时、标签布局、数据源派生缓存命中、地图换色延时。
- **Storage**：Snapshot 文件体积、压缩/反序列化时间、失败恢复。
- **Simulation（后续）**：每个世界年推进耗时、历史 Delta 大小、回看跳转成本。

目标交互 60 FPS，复杂地图 30 FPS 下限；具体生成时间和模拟年速率需在真实硬件测试后确定，**不能在未测量时承诺具体秒数**。

### 14.3 优先级顺序

1. 结构性优化：Stage 依赖与缓存、内容按需加载、避免全量重新生成。
2. CPU 算法优化：月度气候公共计算缓存、网格距离/图邻接重用、避免多次重复分配。
3. 内存优化：TypedArray 生命周期、仅物化当前月份、简化中间诊断常驻、Transferable 与缓存协调。
4. 渲染优化：单 Canvas、非活动视图懒 GPU 初始化、源依赖粒度更新、Label Viewport 更新、颜色纹理。
5. 先进后端：WASM、SAB、多 Worker、WebGPU 仅按瓶颈数据决定。

### 14.4 可复现基准数据集

建立固定的 Seed × 配置 × 分辨率矩阵，至少包括：

- 标准类地球：陆地比例、温度分布、国家/城市。
- 超级大陆：内陆干旱与大陆边缘。
- 群岛：海峡、港口与海路。
- 冰封/高倾角：季节温度与冰川。
- 低海平面/极端陆地覆盖：海岸与内流盆地。
- 高精度：气候投影、内存峰值、地图流畅度。

记录每例 `generatorVersion`、`contentSignature`、配置摘要、CPU/Browser、统计指标、缩略图和允许漂移范围。

---

## 15. 测试矩阵与质量门禁

| 级别 | 必测内容 |
| --- | --- |
| Package boundary | 无 UI/Three.js 反向依赖，所有包可独立 Build/Typecheck/Test |
| World-data | ID、权重、外键、Schema、内容签名、名称确定性、按需加载 |
| Mesh/Geology | 闭合、面积、邻接、板块归属、陆地覆盖误差、构造边界 |
| Terrain | 海陆掩码/高程一致、无 NaN、诊断值、侵蚀范围、分辨率对比 |
| Climate | 月/年一致、极值、雨影、季风、半球季节、输出投影守恒 |
| Hydrology | 排水无环、流量守恒、流域面积、内流汇点、湖泊稳定性 |
| Ecology/Resources | 生物群系分类、土壤/植被范围、资源和地质关联 |
| Civilization | 人口守恒、民族/宗教 CSR、国家统计、稳定实体引用、海路连通 |
| Generation DAG | 拓扑排序、显式依赖、版本缓存、取消/失败、增量=全量 |
| Snapshot/Storage | 字段单位、二进制往返、缺失内容包、旧版本迁移、失败恢复 |
| Cartography | 内置风格验证、Source 失效、2D/3D Picking 一致、标签平移重排 |
| E2E | 创建→生成→选中→换图→保存→重开→导出 |
| 性能 | 40K/160K、6 套初始风格、双视图和峰值内存，持续基准 |

**黄金样例策略**：保留 `feat-society` 的主要 Seed 输出摘要和代表性截图；算法升级时更新 StageVersion、回归指标和变更说明，不允许不经解释的结果漂移。

---

## 16. 实施里程碑（面向 AI Agent 分任务）

### M0 — Monorepo 与世界契约

**目标**：工程可运行，包边界正确，世界事实模型/序列化骨架可验证。

**当前状态（2026-11-04）**：本地最小前置条件已验证，可启动 M1；当前实现与命令结果见 §0.3 和 [`PROGRESS.md`](PROGRESS.md)。CI 尚未远端验证，工作区改动尚未提交。M0 档案是经完整校验的 JSON 测试往返，不是已生成世界的产品级保存流程。

**交付**：

- `apps/web`、`packages/world-data`、`packages/world-core`、`packages/cartography`。
- 包导出、TS 类型、脚本、CI、依赖边界检查。
- WorldGenerationConfig、WorldSnapshot、WorldViewState、字段单位和实体 ID 规范。
- `world-data` 的 ContentPack Manifest、名称/政体/宗教原型及基础校验。
- Worker 请求协议与任务取消；最小存档往返。

**验收**：各包独立测试；`world-core` 不依赖 DOM/Three；内容加载确定；空世界/最小世界档案可往返。

### M1 — 自然世界 Genesis

**目标**：稳定生成拥有真实地理因果的行星。

**当前状态**：尚未开始生产自然 Stage；第一步接入 Mesh 之后的板块/地形并完成真实快照发布，随后按依赖进入气候、水文与生态。旧版 `feat-society` 是算法参考，不是当前包内已实现能力。

**交付**：

- Mesh + 板块 + 大陆 + 地形；现有核心算法迁移并建立黄金样例。
- 归一化高程与物理单位/海陆掩码统一。
- 季节环流、12 月气候、Köppen、生物群系。
- Priority Flood、水文基本流域与河流；基础静态湖泊可分子里程碑。
- Stage DAG 及部分 ConfigKey 缓存；进度、取消和错误。

**验收**：固定 Seed 在至少 3 个分辨率/原型组合稳定通过；基础自然专题字段合法；地形和水文关键不变量成立。

### M2 — 初始文明与内置内容库

**目标**：自然环境约束人口和文明分布，并能解释生成结果。

**交付**：

- 资源初始目录与基础空间分布。
- 人口、聚落、道路/航线、民族/语言、国家/行政、宗教/圣地。
- `world-data` 命名规则、文化/宗教/政体模板接入。
- 世界统计、实体查询、人口/引用一致性检查。

**验收**：同版本同 Seed/ContentCatalog 确定；人口与各群体账本一致；没有无效外键或无故跨海传播。

### M3 — Cartography / Atlas

**目标**：具备用户可直接探索的 3D/2D 世界地图工作台。

**交付**：

- GlobeView + AtlasView、投影、地图交互与统一 Picking。
- SourceRegistry/StyleDocument/LayerFactory，局部失效机制。
- 六套首发风格、自然/人文主要专题图、图层开关和图例。
- 城市、国家、区域、河流详情查询；图片导出。

**验收**：2D/3D 选择同一事实对象；修改样式不触发重新生成；图层资源释放与平移后标签布局正确。

### M4 — Snapshot、项目管理、V1 验收

**目标**：能持续保存、载入、导出并验证完整世界。

**交付**：

- IndexedDB 项目索引、OPFS 二进制存档、独立导入导出。
- 配置/算法/内容包版本与校验和。
- 错误恢复、性能面板/基准、Playwright 端到端用例。

**验收**：创建世界→生成→查询→换图→保存→关闭→重开，世界事实与内容版本一致；失败不会破坏最后一份有效世界。

### M5 — Living World（第二产品阶段）

**目标**：固定年度推进、人口/城市/国家演化、事件与基础历史。

**交付**：Simulation Worker、Tick Scheduler、聚合人口、基础资源/粮食、政治事件、历史检查点和回看。

**验收**：固定条件下多样本推进 300–500 年；人口/身份/边界等关键不变量稳定；地图可独立浏览和暂停模拟。

### M6 — Creator / Chronicle（后续）

**目标**：用户可编辑世界事实、锁定设定，并从不同历史点探索分支。

**交付**：Command/Patch、编辑影响预览、局部重算、对象锁定、Undo/Redo、历史分支和对比。

**验收**：编辑后数据一致、可撤销、可保存，重新打开仍保留用户设定；历史分支可各自推进且不会相互污染。

---

## 17. 任务拆分规范与实现约束

每个 AI Agent 任务包含：`Goal`、`Package`、`Inputs`、`Outputs`、`Invariants`、`Allowed Changes`、`Tests`、`Acceptance`、`Non-goals`。

硬性规则：

1. 不允许把世界事实嵌入地图 Style、GeoJSON 或 Svelte Store 中维护。
2. 不允许 `world-core` 依赖 Three.js/Svelte/DOM；所有算法必须在无 UI 的环境测试。
3. 不允许 `world-data` 依赖 `world-core`；内容定义必须具有稳定 ID、Schema 与版本。
4. 不允许更换词库后默默覆盖旧世界名称；内容签名及作者覆盖必须保留。
5. 不允许新 Stage 偷读未声明的 Config/Artifact/Content 字段。
6. 不允许在没有版本更新与测试的情况下改变已发布的算法行为。
7. 每个新增的 Dense Field 都要定义 `dtype`、`meshId`、单位、缺省值、序列化和失效条件。
8. 导出或重建前必须验证实体引用、统计守恒和关键物理量边界。
9. 地图层只消费只读世界数据；样式切换不触发自然或文明生成。
10. 引入“局部重算”之前，必须证明其与全量重算的相关输出等价，尤其是水文下游、气候传播和交通连通域。
11. 优化必须同时报告运行时间、内存、质量指标；不是单看 FPS 或单个 Seed。
12. 每个里程碑必须交付可交互、可测试的纵向功能切片，避免只创建大量空接口和目录。

---

## 18. 风险、待决策与 ADR

| 风险 | 默认决策 | 触发重新评估的条件 |
| --- | --- | --- |
| 自然算法结果变化 | 版本化保留旧黄金样例，逐域替换 | 新算法显著提升质量或修复错误 |
| 大量经验气候系数 | 初版定位 EarthlikeClimateModel | 开发非类地球物理世界 |
| 湖泊系统复杂度 | V1 基础静态盆地/湖泊，后续逐月水量 | 进入可编辑水系/长期干旱模拟 |
| 内容包膨胀 | 内置 core + earthlike，按需加载 | 用户 Mod/社区内容上线 |
| Stage 过细导致维护重负 | 优先少量强契约 Stage | 存在明确缓存收益与独立重用 |
| TypedArray 缓存与转移冲突 | 明确独占所有权、必要时复制 | 多个世界并行或高精度大规模生成 |
| 样式层与自然字段耦合 | Source Schema + 查询边界 | 扩展专业制图和自定义图层 |
| 历史存储过大 | Checkpoint + Delta + Event Index | 多分支千年存档规模过大 |
| 浏览器兼容与离线存储 | IndexedDB + OPFS 兼容层与导出 | Safari/移动端存储配额限制 |
| 更换 GPU/计算技术 | 先实测 WebGL2 与 TS | GPU/CPU 热点证明必要 |

建议维护的 ADR：

- `ADR-001-monorepo-and-package-boundaries.md`
- `ADR-002-world-snapshot-and-field-ownership.md`
- `ADR-003-content-packs-and-deterministic-naming.md`
- `ADR-004-generation-stage-dag-and-caching.md`
- `ADR-005-earthlike-climate-model.md`
- `ADR-006-hydrology-and-lake-model.md`
- `ADR-007-cartography-rendering-backend.md`
- `ADR-008-snapshot-storage-and-history.md`

---

## 19. 核心决策清单（开工前冻结）

| 决策 | 结果 |
| --- | --- |
| 包边界 | `web / world-data / world-core / cartography` |
| 世界权威来源 | `WorldSnapshot`，不可由 UI/地图直接修改 |
| 初版物理模型 | Earthlike，单位与渲染尺度分离 |
| 网格 | Icosphere/Voronoi + 固定参考网格 + 输出网格 |
| 自然算法 | 保留成熟机制；优化地形后处理、气候复用和水文对象 |
| 文明初始生成 | 静态人口/城市/交通/民族/国家/宗教 + 内置内容模板 |
| 创世调度 | 显式 DAG，先串行，按依赖缓存 |
| 渲染 | Three.js WebGL2，共享 Renderer、懒视图资源 |
| 地图样式 | `cartography` 负责内置 16 套风格与 Style DSL |
| 编辑 | Command/Patch/Locks；首版仅预留 |
| 历史 | 固定 Tick + Checkpoint/Delta/Event；第二阶段以后开发 |
| 本地存档 | IndexedDB 索引 + OPFS 大文件 + 可导出世界档案 |
| 验收 | 多 Seed、多分辨率、领域守恒、性能基准和 E2E |

**实施建议**：M0 最小工程前置条件已在本地验证；从现有 Mesh Stage 按 `Geology → Terrain → Climate → Hydrology → Ecology` 的实际依赖逐步推进 M1，并尽早闭合“生成 → 校验 → 原子发布快照”的垂直切片。不要把经济、战争、编辑和历史与首版自然创世并行铺开；但必须让基础模型可容纳它们后续发生的变化。

---

## 附录 A. 源码与文档参考

- 产品总纲：`Another_Earth_PRD_v1.0.md`（2026-11-02）
- 既有技术设计：`Another_Earth_Technical_Design_v0.1.md`（2026-11-02）
- 项目分支：<https://github.com/42arch/another-earth-generator/tree/feat-society>
- 生成流水线：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/worker/simulation.worker.ts>
- Pipeline Scheduler：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/pipeline/scheduler.ts>
- 地形后处理：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/geography/terrain-post-processor.ts>
- 地形侵蚀：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/geography/terrain-erosion-processor.ts>
- 月度气候：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/climate/monthly-climate-generator.ts>
- 气候输出投影：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/climate/climate-output-projector.ts>
- 水文：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/hydrology/surface-hydrology-generator.ts>
- 生物群系：<https://github.com/42arch/another-earth-generator/blob/feat-society/src/core/simulation/ecology/biome-classifier.ts>

## 附录 B. 需求与里程碑对应

| PRD 域 | 技术章节 | 首个目标阶段 |
| --- | --- | --- |
| NAT-01～NAT-04 行星、地质、地形、气候 | §5–7 | M1 |
| NAT-05～NAT-09 水文、生态、资源、灾害 | §7 | M1–M2；动态灾害后续 |
| SOC-01～SOC-09 初始文明 | §4、§8 | M2 |
| SOC-10～SOC-15 外交、战争、科技、政治与自主演化 | §11 | M5 及后续 |
| MAP-01～MAP-09 视图、专题、样式 | §9 | M3；高级样式后续 |
| EDT-01～EDT-09 编辑器与局部生成 | §10 | M6 |
| HIS-01～HIS-09 历史、事件、分支 | §11、§13 | M5–M6 |
| ATL 世界百科与信息查询 | §8–9 | M2–M3 |
| PRD 存储、导出、内容版本 | §4、§13 | M0、M4 |
