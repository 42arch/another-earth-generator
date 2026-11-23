# 文明生成与特征系统 — 产品设计评审与问题记录

> 记录日期：2026-11-23  
> 基准范围：Schema 11、`habitability-v4`、`population-settlements-v5`、`transport-network-v4`、`peoples-cultures-v4`、`polities-religions-v15`、内容包 `polity-traits@1.1.0` / `polities@1.4.0`。  
> 文档性质：面向后续规则整理的问题清单与设计备忘，不代表已定稿的产品决策；未对当前源码或规则作任何修改。

---

## 一、现状与已有合理设计（应保留的骨架）

在调整规则之前，以下几项已经成型的设计边界和机制值得保留：

1. **无循环单向因果链**：`polities-religions-v15` 将宗教传播前移到划界之前，用首都及局部腹地在领土扩张前涌现 `PolityTrait`，再调制扩张成本与航海投送，避免“国界依赖特征、特征又依赖国界”的循环。
2. **内在特征与外在政体名号分离**：`PolityTrait`（权力、治理、经济正交维度）决定国家行为倾向；`PolityArchetype`（20 种政体内容包）通过 `requiredTraits` 和 `traitAffinities` 决定政体名号、头衔与继承方式，支持内容驱动扩展。
3. **连续能力门控与同源演替**：`civilization-traits.ts` 不硬编码预设 ID，而是通过 5 项能力值与 `urbanConcentration` 控制特征激活、平滑退场和槽位复合度（低分工 1 项、高分工最多 3 项）。
4. **物理尺度独立于网格与人口守恒**：`civilization-scale.ts` 锚定物理支持面积与行进速度；聚落人口从邻近地区守恒募集（供体保留至少 44%），`PopulationGroup` 严格加总匹配区域人口。
5. **预设与独立试验轴正交**：`civilization-presets.ts` 切换社会情景时保留 `enabled`、`populationScale` 与 `culturalDiversity`，支持单变量对比实验。

---

## 二、待解决的产品设计问题清单

### 1. 领土配额机制削弱了特征因果力，且消灭了“无主荒野”

* **对应源码**：`packages/world-core/src/generation/civilization/polity-layout.ts`（`createPolityAreaTargets`、`growPolityTerritories`）、`polities-religions.ts:477-515`
* **现状表现**：
  * `createPolityAreaTargets` 在每个连通陆块内先按 `rng.nextFloat() * baseRate` 排序，直接用幂律 `(rank + 1)^(-2 * variation)` 分配目标面积 `targetAreasKm2`。
  * `growPolityTerritories` 优先调度 `claimedArea / targetAreasKm2` 最小的国家向外扩张，直到同一个连通分量内的**所有可及陆地全部分完**（包括 `population[r] === 0` 的高海拔冰峰、无人沙漠）。
* **核心问题**：
  1. **特征对疆域规模的控制力退化**：`city-state-civic` 的 `baseRate = 0.48` 被降格为面积排名的随机乘数，而不是真正的“紧凑扩张上限”；若 `politySizeVariation` 较小或周边空旷，系统仍会把大块领土喂给城邦自治国家。
  2. **缺乏无主边疆与无人荒野**：只要在同一陆块且无海阻隔，哪怕选“农耕聚落”或 `polityCount = 1`，国家边界也会铺满荒漠、冻土和雪山，与“文明围绕宜居走廊与核心区分布、边缘保留无主地带”的历史地理直觉冲突，也违背 PRD 2.3 的范围与约束原则。

### 2. 社会背景预设的“时代情景感”不足，整体仍偏近代均质结构

* **对应源码**：`apps/web/src/ui/hud/civilization-presets.ts`、`packages/world-core/src/generation/civilization/habitability.ts`、`peoples-cultures.ts:195`、`polities-religions.ts:299`
* **现状表现**：
  * `habitability-v4` 以约 1900 年全球 ~17 亿人口为承载密度基准，但切换“农耕聚落”时 `populationScale` 维持 `1`，仅农业倍率降至 `0.25`。
  * `polityCount` 在“农耕聚落”和“近代工业商贸”默认均为 `60`。
  * 文化数量受限于 `Math.round(12 * culturalDiversity)`（默认上限 12），宗教数量受限于 `Math.min(6, Math.round(cultures.length * 0.75))`（上限 6），且都会跨山越水覆盖全图。
* **核心问题**：
  1. 切换预设后，全球仍呈现“60 个贴满大陆的国家 + 少数几个大一统宗教/文化 + 接近近代的总人口量级”，缺乏前工业时代应有的人口稀疏感、碎片化地方信仰与大量小邦/部族/无主空间。
  2. 在“农耕聚落”中 `settlementDensity` 降到 `0.45`，但 `polityCount` 仍固定为 `60`，导致大量小村落被直接选为“首都”。

### 3. 特征系统内部的维度语义混杂与抽样分布失衡

* **对应源码**：`packages/world-data/data/society/polity-traits.json`、`packages/world-core/src/generation/civilization/civilization-traits.ts:546-680`、`apps/web/src/ui/hud/RegionInspector.svelte:218-227`
* **现状表现与问题**：
  1. **`small-area`（第 4 维 `territory`）与现有概念同义重复**：
     * 为禁止大国匹配城邦/酋长领/自由领地/自治公社，将 `small-area`（≤ 37,356 km²）放进 `Polity.traits` 并在探针直接显示徽章。
     * 导致探针同时显示“城邦”（`sizeClass`）+“小面积”（`small-area`）+“城邦自治”（`city-state-civic`），语义重复，且把“后验物理面积结果”与“先验制度/经济特征”混在同一个徽章列表里。
  2. **维度 1 概率抽样 vs 维度 2/3 硬取最大值导致分布偏斜**：
     * 维度 1 已改为加权抽取（`civilization-traits.ts:588`），缓解了全部分权的问题；但维度 2（治理）与维度 3（经济）仍按 `±10%` 抖动后取最高分。
     * 如 `docs/benchmarks/CIV-02-trait-distribution.md` 所记录：默认背景下治理维度过度集中于 `democratic`（阈值 `0.48` 易触发，商业/工业/文化任意一项高即达标），经济维度过度集中于 `mercantile`；`theocratic` 高度依赖恰好建在 ≤ 6 个宗教起源的 12 步成本圈内，极度偶发。
     * `militaristic` 主要由 `fortress`（高海拔/陡坡）与 `mining` 驱动，隐含“山地矿区 = 尚武扩张”，因果依据单薄。
  3. **建国前腹地特征与建国后实际版图可能严重倒挂**：
     * `Polity.traits` 在划界前仅凭首都及附近临时腹地一次定型，后续永不修正。当单个国家面积跨度很大时，可能出现“靠港小城起家涌现 `city-state-civic`，最终吞并半块农业大陆达到 `empire` 规模，但特征仍显示城邦自治”的反直觉组合。

### 4. “生成算得深、前端看不到”——因果可解释性与制图消费断层

* **对应源码**：`packages/cartography/src/sources/adapters/civilization-sources.ts`、`apps/web/src/ui/hud/RegionInspector.svelte`、`apps/web/src/ui/hud/OverviewPanel.svelte`、`packages/world-core/src/generation/civilization/polities-religions.ts:78-93`
* **核心问题**：
  1. **地图完全未体现特征系统**：`civilization-sources.ts` 中聚落图层只按 `tier` 区分大小，12 种城市特征（圣城、要塞、工业中心、商贸海港等）和 15 种制度/经济国家特征均无地图符号、筛选或专题图层支持，无法在宏观地图上看出文明内部格局。
  2. **探针只给结果标签，不给“为什么”**：核心其实已计算 `PolityPowerDiagnostic` 与城市特征分项（矿点、河口汇流、海路流量、宗教圣地等），但未把成因摘要传递到只读查询或前端探针。探针只展示写死的通用定义文本，无法回答 PRD 1.2 / 3.3 强调的“为什么这座城市/这个国家会变成这样”。
  3. **宏观概览缺失结构分布**：`OverviewPanel.svelte` 只显示人口、聚落、国家等总数，没有主要国家/城市排行、政体类型或特征占比、城市化比例等世界观察指标。
  4. **国名后缀在生成期写死单一语言**：`appendPoliticalForm` 在 `polities-religions.ts:88-93` 中把排在第一位的译文政体名（如“共和国”）永久拼入 `polity.name`，探针下方又单独展示 `政体类型：共和国`，不仅信息重复，也不利于未来切换 UI 语言浏览同一份世界快照。

### 5. 模型扩展性与边界细节隐患

* **硬编码内容包名称与中文关键字**：`packages/world-core/src/generation/civilization/peoples-cultures.ts:84-107` 中 `scorePeopleArchetype` 直接匹配 `'novari'`、`'taren'`、`'lomiri'`、`'avilan'`、`'海上'`、`'高地'`、`'林地'`、`'贸易'` 等字符串，绕过了结构化 `tags`/`traits` 契约，不利于未来支持第三方或自定义文明内容包。
* **聚落层级（`tier`）与绝对人口强耦合**：`packages/world-core/src/generation/civilization/population-settlements.ts:219-223` 写死 `>= 1200` 为 `city`、`>= 400` 为 `town`。调整 `populationScale`（如调至 `0.2×` 或 `3×`）时，城市符号层会整体塌缩为村落或全图变成大城，缺少结合相对人口分位数的判定。

---

## 三、后续整理文明规则时的重点讨论方向

建议整理新版文明规则时，优先明确以下五个问题：

1. **领土覆盖模型**：是否要从“连通陆地 100% 强制分完”改为“受行政能力、行进/补给成本上限与宜居度约束的自然边界（允许无人荒野与边疆留白）”？若是，如何与用户指定的 `polityCount` 及 `politySizeVariation` 协调？
2. **特征与规模的因果方向**：维持“特征在先、扩张在后”，还是允许划界后根据实际领土构成（农业/港口/多文化占比、真实版图规模）做二次修正或触发特征校验？`small-area` 是回归内部约束条件，还是保留为显式特征？
3. **预设与时代尺度边界**：四套预设应该继续只作为“部分能力滑杆组合”，还是应当同时定义符合该历史背景的默认国家数量、宗教碎片化程度与基础人口参考系数？
4. **可解释性与地图消费目标**：下一阶段需要把哪些诊断信号（城市诱因、国家成因、特征分布）正式纳入 `WorldSnapshot` 或只读查询契约，以及哪些特征需要直接上地图图层/符号？
5. **命名与内容包解耦**：清理 `peoples-cultures.ts` 的内容关键字硬编码；确认政体显示名后缀是否在显示层拼接而非写死在快照的 `polity.name` 中。
