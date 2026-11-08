# Another Earth — 技术设计

> 更新：2026-11-06。产品规则以 [PRD](PRD.md) 为准；实现与验收状态见 [PROGRESS](PROGRESS.md)。本文保留长期架构和当前算法决策，目标接口不等于已实现 API。精确字段和单位见 [世界数据契约](WORLD_DATA_CONTRACTS.md)，执行与缓存见 [生成管线](GENERATION_PIPELINE.md)，后续自然阶段见 [M1 实施计划](M1_IMPLEMENTATION_PLAN.md)。

## 0. 架构与当前边界

采用 pnpm Workspace：`world-data` 提供内容，`world-core` 拥有生成规则和世界事实，`cartography` 只读制图，`apps/web` 编排 UI、Worker 和浏览器存储。跨包只通过 exports，核心不依赖 DOM、Three.js、Svelte 或 Worker 全局对象。

当前具备已验收的 M0 工程基础、M1.1 地质/基础地形和 M1.2 C0 实现与链路；工作区按用户要求把基础水力/冰川侵蚀恢复到 T0（`terrain-v22`），水力强度现统一缩为一半，该版本尚未验收。降雨驱动追加侵蚀、水文、生态、完整自然快照或初始文明均未生成，正式 3D/2D 地图与项目存储也未交付。M0–M4 为默认范围；M5+ 的模拟、编辑器和历史只保留必要设计边界。

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
│   │       ├── mesh/                    # 球面、Voronoi、邻接/距离、空间索引与投影
│   │       ├── math/                    # 标量数学工具、PRNG、球面三角
│   │       ├── generation/              # 生成系统与领域生成算法
│   │       │   ├── pipeline/            # Stage DAG 调度器、执行引擎、错误处理与依赖拷贝
│   │       │   ├── stages/              # 具体生成阶段实现（mesh-stage、geology-stage、terrain-stage）
│   │       │   ├── nature/              # 自然领域算法与产物
│   │       │   │   ├── common/          # 自然层公共基建（算法网格适配、距离场、优先队列）
│   │       │   │   ├── geology/         # 地质与构造骨架（plates/、tectonics/、产物契约与校验）
│   │       │   │   ├── geography/       # 地形演化与地理（terrain/、高程单位、产物契约与校验）
│   │       │   │   └── nature-types.ts  # 自然跨域通用数据契约
│   │       │   └── civilization/        # 文明生成与实体契约（civilization-types）
│   │       ├── world/                   # 权威快照、Dense Field、档案编解码与校验
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
│   ├── WORLD_DATA_CONTRACTS.md
│   ├── GENERATION_PIPELINE.md
│   ├── PROGRESS.md
│   └── M1_IMPLEMENTATION_PLAN.md
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**当前实现（2026-11-06）**：网格、地质和基础地形 Pipeline 已接入；领域生成算法与管线调度统一组织在 `world-core/src/generation/`（包含 `pipeline/` 调度引擎、`stages/` 生成阶段、`nature/` 自然领域算法、`civilization/` 文明契约），Worker 与调试入口在 Web。文明生成、正式 Cartography、浏览器项目存储和完整自然快照发布尚未接入。目标目录不要求提前建立空模块；实际状态见 [PROGRESS.md](PROGRESS.md)。

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

## 6. 生成与世界发布

当前 `GenerationStage` 通过 dependencies/configKeys/contentKeys 声明输入；执行、随机流、缓存和 Buffer 所有权以 [生成管线](GENERATION_PIPELINE.md) 为准。Stage 的可写工作副本不与缓存共享；显示和月份变化不参与生成签名。

完整自然结果须先组装候选快照，经过完整领域校验后原子发布。当前 Pipeline 仅交付阶段产物，不得把缺失气候/水文/生态的数据补零后当作完整世界。失败、取消、校验或传输错误须保留上一个有效结果。

## 7. 自然世界：当前实现与演进

迁移基线为 `42arch/another-earth-generator` 的 `feat-society` 分支，本地 `docs/old-src` 只读参考，不属于新架构运行代码。新网格、随机流和后续曲线修订不保证旧项目同 Seed 逐字节一致。

### 7.1 球面网格与空间查询（已实现）

- Icosphere 支持 L0–L8：区域数 `10×4^L+2`、三角面 `20×4^L`、边 `30×4^L`；L8 为 655,362 区域。配置明确给细分等级，不从任意目标区域数暗中推断。
- `irregularity=0` 复用规则中点细分连接；大于零则固定原始 12 站点，其余按切平面方向扰动后归一化，用 Delaunator 重建球面 Delaunay。扰动是网格形态参数，不是地形噪声。
- 沿用参考站点顺序和 Alea 取数；扰动幅度尺度为 `sqrt(4π/N)×0.75×irregularity`。投影极点移出有限平面，用稳定分母 `|q-p|²/2` 做立体投影，平面凸包边与极点补面后校正朝向。
- Voronoi 对偶使用外向单位外心，边界在局部切平面排序；面积使用球面三角形立体角公式，乘物理半径平方。扰动网格的邻居度数可变，不能假设恒为六。
- 校验包括闭合、两面共边、Euler 特征、CSR 对称、有效索引、外向非退化面、外心等距、局部空球冠、正面积和全球面积和。精确 dtype/长度见数据契约。
- `MeshQueries` 与 `SphericalSpatialIndex` 借用稳定存储，查询不暴露数组或 Buffer。KD-tree 按单位球弦距查询，同距选较小索引。换 Mesh 后索引和跨网格映射必须重建。
- 右手坐标：北极 +Y、零经度 +Z、东经 90° 为 +X；数学 API 使用弧度。显示半径与物理半径独立。
- 距离场传播统一以 Float32 舍入后的代价比较、存储、入队，避免等长路径重复松弛。历史 L8 证据只代表相应版本，不是当前整条自然链的性能承诺。

### 7.2 地质、板块与地壳（已实现）

参考网格默认 L6，基础细分固定 100。板块种子生长、主/微板块拓扑、候选大陆与地壳分别生成；地质扰动映射和普通地理映射分开存储。运动板块 ID、基础细分索引和候选大陆 ID 含义不同。

候选覆盖率约束地壳生成，最终地形可以改变海岸；目标数、实际板块数、参考覆盖率、输出覆盖率必须分别报告。零候选陆地返回空大陆表；微板块目标可能受连通性限制。统计按物理面积加权，不静默修形凑比例。

地壳驱动板块运动、地幔和构造边界，继续生成山脊、岛弧和热点。速度、应力、地幔强度为相对模型量，不是绝对物理速率；不进行跨地质年代的板块积分。

**代码组织**：地质领域逻辑位于 `world-core/src/generation/nature/geology/`。
- `plates/`：板块种子、微/主板块拓扑（`plate-generator`、`super-plate-generator`）、板块物理动力学与边界分析（`plate-physics`、`plate-boundary-analyzer`、`plate-properties-generator`）。
- `tectonics/`：候选陆地（`candidate-land-generator`）、地幔对流（`mantle-dynamic-topography`）、构造空间场、山脊、火山与骨架高程（`tectonic-elevation-generator`）。
- 算法网格适配（`algorithm-mesh`）与球面距离场（`distance-field`）沉淀在 `generation/nature/common/`，由地质与地理共享消费，消除跨域反向依赖。

### 7.3 基础地形 T0（已实现，最终验收待完成）

当前骨架为 `terrain-skeleton-v9`，后处理为 `terrain-v22`，分别固定使用 skeleton-v5/terrain-v7 随机流以支持同坐标地形对照。实际配置与依赖见生成管线。

```text
地质与动力学 → 构造骨架、Phasor 山脊、火山体
→ 纹理与地幔贡献 → 峰值/均衡与全局高程排名整形、封闭低地修复
→ Warp、海岸稳定、可选平滑、两层后期噪声
→ 山脊锐化、土壤蠕动 → 输出边界转换为 km
→ 海平面基准、最终海陆、坡度、连通分量与统计
```

内部高程、噪声和成因诊断使用塑形坐标。最后一次性转换为物理 km，再减 `seaLevelDatumKm`；最终 landMask 必须由写入 Float32 的物理高程符号派生。海岸中间 mask 只约束后续塑形，不成为公开海陆事实。

低段 `x≤0.5` 使用 `6x²(3−2x)` km；中高段用单调三次 Hermite 锚点 `(0.5,3)/(0.72,4)/(0.82,5)/(1,6)`（坐标、km），连接梯度连续。海底为 `8x`，超过 1 从 6 km 按每坐标单位 6 km 延伸。高程重映射有意偏离参考曲线，不代表经地球统计校准的物理模型。

粗糙度范围 0–0.5、默认 0.4，可调纹理相对默认强度为 `(roughness/0.4)³`，后期细节和峰值尖峰也参与。两层后期噪声的基准坐标幅度为 `0.1/6`、`0.05/6`，沿用旧四次幂映射 `6x⁴(5−4x)` 导数的局部补偿（最多 4 倍）。这条补偿是固定的塑形幅度参考，不随当前输出曲线改动；粗糙度 0 时构造骨架和岛屿仍可有起伏。

**T0 基础侵蚀决策（2026-11-08）**：按用户要求，在 M1.2 基础上恢复 T0 塑形阶段的水力/冰川侵蚀，暂不实现气候/降雨驱动的追加侵蚀。`terrain-v22` 在 km 映射前调用迁移的参考 `TerrainErosionProcessor`；参数默认均为 0.5，水力输入在处理器前乘以 0.5，冰川输入不变。参数进入 terrain Stage 签名。侵蚀后继续执行山脊锐化、土壤蠕动和排水重建。后续气候与水文阶段读取已侵蚀 T0；若再加降雨驱动侵蚀，须定义与基础 T0 塑形的分工及单独产物身份。

既有侵蚀算法按汇水格数与角格距调参，重接时需处理面积、长度及时间尺度的一致性。当前不承诺严格侵蚀质量守恒或与地球高程直方图一致。

**代码组织**：地形塑形算法位于 `world-core/src/generation/nature/geography/`。
- `terrain/`：地形表面纹理（`terrain-texture-generator`）、T0 水力/冰川侵蚀处理器（`terrain-erosion-processor`）、表面后处理编排（`terrain-post-processor`）与拓扑修复/整形（`terrain-finalizer`）。
- 单位与契约：模型塑形坐标与物理高程换算收敛于 `generation/nature/geography/elevation-units.ts`；产物契约与校验由 `types.ts`、`validation.ts` 和 `queries.ts` 维护。

> 以下 §7.4–§9 为尚未落地的目标设计；算法现状描述特指 docs/old-src 参考实现。当前源码没有这些生成器或正式地图，迁移契约以世界数据契约及 M1 实施计划为准。

### 7.4 季节环流与月度气候

**沿用**：四个季节锚点、ITCZ 迁移、季风/纬度气压带、风/洋流代理场、12 个月温度与降水、海陆性、雨影/地形抬升、降水总量约束。

**必须明确模型定位**：这是一套可解释、可调校的 **EarthlikeClimateModel**，不是通用行星大气数值求解器。参考模型包含针对类地球的温度基线、海陆经验系数、季风增益和降水上限。若扩展星球自转周期、大气密度或不同恒星辐射，应建立独立 Planetary Forcing 层，而不是仅叠加 `temperatureOffsetC`。

**当前工作区迁移状态与限制（待验收）**：`climate-c0-v2` 已将 feat-society 四季风场、洋流代理、季风、多轮温湿耦合与 Köppen 亚型迁入 T0 → C0 链路；通过当前 Mesh 适配器使用实际物理半径和阶段随机流，将旧 365 天日历改为 12 个等时长箱。输出投影采用三源海陆感知插值及逐月面积降水修正。结果、形态、缓存、内存和真实 Worker 尚未验证；不提供最终 C1 或完整世界事实。

**优化**：

- 将 `planetary forcing`（倾角、辐射/季节）与 `surface response`（海陆、地形、风和降水）逻辑隔离。
- 参考月度模型每月约调用温度求解三轮、降水求解两轮；先分析每轮的质量收益，缓存重复的风、空间梯度和传播权重，禁止未经对照测试直接删迭代。
- 高分辨率气候继续在参考网格计算、向输出网格插值，并以物理面积加权和降水守恒系数验证总量。
- 参考气候投影使用 3 个邻近气候网格点，源索引为 `Uint16Array`（因此源区数上限为 65,535）；未来若改参考网格精度，必须同步修改索引类型与序列化格式。
- 参考实现在输出超过 250,000 Region 时使用按月采样/缓存；当前快照契约要求完整 12N 字段，迁移时须明确这种差异及内存边界，不静默省略必填月份，也不提前建立惰性快照框架。
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

**关键问题**：旧参考实现对于完全无海洋出口的陆地分量可以建立内部汇点，但未把它表达为可见湖泊；“优先队列填洼生成可排水表面”与“真实盆地蓄水/蒸发”应区分。**计算路由辅助面不等于改变最终地表高程。**

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

## 10. 编辑与局部更新（未来边界）

世界事实编辑与地图装饰分离。未来 Command/Patch 必须携带目标快照身份与影响域，产生新候选快照并校验，禁止 UI 原地改权威数组。首版按整 Stage 失效；局部流域/地形再生成只有在有实际需求和验收方法后实施。

## 11. 文明演化与历史（M5+）

静态初始文明不等于动态模拟。未来按固定时间步定义人口、经济、交通、政治与文化因果，事件须可解释。历史使用检查点和差量，不能仅靠 Seed 重新执行新版本算法来恢复旧世界。当前不建立模拟器、编辑器或分支空框架。

## 12. Worker、调试器与发布边界

当前 `/mesh-debug` 使用 Web 的 Controller/Runtime，支持 Mesh、Geology、Terrain 三种任务及 requestId。Worker 内三条 Pipeline 共用 512 MiB LRU，以容纳 L8 地形完整阶段链；只转移结构化克隆出的独立产物副本，缓存原件不 detach。主线程校验身份、dtype、长度和字段后准备显示。权威数组不直接交给渲染层修改。

latest request wins：陈旧完成和查询响应被忽略。硬取消终止并重建 Worker，丢失其缓存；旧显示仍可保留，成功重建前禁用区域查询。同步网格构建不能在一轮 CPU 计算中实时处理中断消息，不能把硬取消称为无损协作取消。

调试页等级为 L4–L8，核心为 L0–L8；支持 Voronoi/Icosphere、线框、旋转、五邻域中心标记、专题与区域查询。高程和坡度图例属于显示状态，切换不触发生成。坡度采用固定对数角度色阶，45°以上显示最高档。

当前用单位球和顶点颜色显示地形，没有参考项目的显示高度位移，也不是正式 Cartography。生成内容失败、取消或传输错误时保留最后有效显示；安装新几何前释放旧 GPU 对象。L6+ 限制像素比、关闭默认线框和旋转以控制显示负载。高等级显示数组仍在主线程准备，峰值内存和长期 GPU 压力未测。

未来完整世界发布需在核心定义快照所有者与原子替换，Worker 协议区分中间产物、完整世界和显示副本，不能用当前调试产物替代正式发布。

## 13. 世界存档、版本与内容一致性

> 下列为 M4 目标设计。当前只有经校验的 M0 JSON 编解码，尚无浏览器项目持久化、完整自然世界保存或 .aearth 二进制档案。

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
| Terrain | 海陆掩码/高程一致、无 NaN、诊断值、分辨率对比；侵蚀范围在后续接入时验证 |
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

## 16. 里程碑与验收入口

| 阶段 | 当前边界 |
| --- | --- |
| M0 | Workspace、内容/世界契约、Mesh、Pipeline、Worker、最小 JSON 档案已有实现与历史验证 |
| M1 | M1.1 地质和 T0 terrain-v20 历史验收；T0 基础侵蚀 terrain-v22 已接入待验证；C0 实现/链路已验收；降雨追加侵蚀、水文、生态、发布尚未完成 |
| M2 | 初始文明、资源与内容库，尚未实现 |
| M3 | 正式 Cartography、3D/2D Atlas 与样式，尚未实现 |
| M4 | 浏览器项目保存、导入导出和完整 Genesis & Atlas 旅程，尚未实现 |
| M5+ | 动态文明、完整编辑器、历史与分支，仅保留设计边界 |

M1 后续任务和完成标准见 [实施计划](M1_IMPLEMENTATION_PLAN.md)，真实验证与历史基准索引见 [进度](PROGRESS.md)。不以历史通过记录证明当前改动通过；不以几张截图替代确定性、海陆一致性、缓存、所有权和失败恢复验收。

## 17. 已定决策与仍有限制

- 2026-11-06：恢复 feat-society 的主要构造/纹理逻辑，停止额外区域隆起、区域起伏和平缓区保护。兼容诊断字段保留零/一值，含义见数据契约。
- 2026-11-06：地形处理统一塑形坐标，公开边界转物理 km；输出曲线与粗糙度响应按视觉反馈调整，均由版本标识，不声称与旧版或地球逐值一致。
- 2026-11-06：冰川/水力侵蚀移到气候与水文接入之后，当前 T0 不生成侵蚀和排水事实。
- 快照 Schema、阶段算法版本、内容包版本与档案格式版本分别管理；算法变更不自动意味着修改快照 Schema。
- 所有后续实现遵循根目录 AGENTS.md；默认不运行检查命令，授权后执行并报告实际结果。

早期各轮地形方案和已失效 ADR 已合并成以上当前决策，试验常数与逐轮调参流水不再作为独立文档维护。
