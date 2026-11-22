# CIV-02 设计草案：城市特征与国家特征系统

> 状态：**CIV-02 已实现（原 Schema 8 / `polities-religions-v11`，后续变更见下方 CIV-03 说明；浏览器待验）** · 更新：2026-11-22
> 关联现状文档：[当前进度](PROGRESS.md) · [世界数据契约](WORLD_DATA_CONTRACTS.md) · [生成管线](GENERATION_PIPELINE.md) · [技术设计](TECHNICAL_DESIGN.md)

> CIV-03 更新（2026-11-23）：当前算法为 `polities-religions-v15`、Schema 11 / 分享 v15。确切国家数（1–200、默认 60）与面积差异、统一岛屿预算及独立领土前沿已替换本文原先的数量/领土分配规则，见 [CIV-03](benchmarks/CIV-03-polity-layout.md) 与 [技术设计](TECHNICAL_DESIGN.md)。下文 v8–v11 公式及相对面积预览为历史设计，不作为当前算法的面积保证；原三维特征词表与评分沿用，另增第 4 维领土特征 `small-area`（共 16 项，最多 4 项）；领土特征、政体硬引用及单聚落大国修正见 [CIV-04](benchmarks/CIV-04-polity-size.md)。


本草案聚焦于建立**“自然与社会能力 → 城市特征 → 国家特征 → 领土扩张与政体对齐”**的单向因果链路，呼应 [PRD](PRD.md) 中“解释为什么城市建在这里、为什么国家呈现此种规模与制度”的核心体验。

- **范围边界**：沿用现有 `CivilizationParameters`、四套预设与分享链接 `#w=13.`，**不改动**国家数量参数、领土差异滑块或命名词库；仅新增城市与国家特征数据、能力门控与演替规则、扩张权重调制与探针展示。
- **核心架构原则**：特征系统**绝不硬编码预设 ID 或线性时代分支**，全部由当前有效的 5 项社会能力与 `urbanConcentration` 连续门控与演替，确保预设与任意自定义参数组合都逻辑自洽。

---

## 一、社会背景联动机制（门控 + 同源演替 + 复合度收放）

如果低能力时代只做“关闭近代特征”，世界会变得单调；如果放任所有特征出现，又会破坏时代质感。系统通过三层机制协同解决：

### 1.1 连续能力门控与退场曲线

特征同时拥有**激活门槛（activation floor）**与**退场衰减（fade-out）**，全部基于有效数值平滑工作：

- **高能力激活类**：
  - `industrial` / `industrial-power`：要求 `industrialCapability >= 0.35`（农耕 `0`、城邦 `0.10`、王国 `0.20` 均关闭；近代 `1.0` 充分激活）；
  - `maritime-trade` / `mercantile`：要求 `seafaringCapability >= 0.30`（农耕 `0.05` 关闭；王国 `0.45` 局部出现；城邦 `0.70` / 近代 `1.0` 兴盛）；
  - `centralized`：要求 `administrativeCapacity >= 0.45`（农耕 `0.20` 与城邦 `0.40` 关闭；王国 `0.45` 仅核心大国出现；近代 `0.75` 普遍出现）；
  - `democratic`：要求 `urbanConcentration >= 0.35 && administrativeCapacity >= 0.35`（城邦商贸可涌现公民议会式城邦民主，近代可涌现代议民主，分散农耕不出现）；
  - `trade-hub`：陆运低于 `0.40` 时抬高门槛，只保留极少数大河汇流渡口核心。
- **低能力激活、高能力自然退场类**：
  - `tribal-kinship`（部族宗法）：`administrativeCapacity <= 0.35 && urbanConcentration <= 0.30` 时高权重激活，随行政整合提升至 `>= 0.50` 归零退场；
  - `ancestral-ritual`（礼法宗族）：`industrialCapability < 0.35 && urbanConcentration < 0.45` 时激活，随工业化与城市化平滑退场；
  - `craft`（手工工坊）与 `artisan-craft`（矿冶工艺）：在 `industrialCapability < 0.35` 时承接矿产/林木/河运优势，随工业能力超过 `0.35` 后平滑让位于 `industrial` 与 `industrial-power`；
  - `pastoral`（牧业聚落）：在低工业/中低城市化下突出，近代高工业化下权重自然减弱。

### 1.2 同源特征演替对

同一块地理优势在不同社会能力下呈现对应的历史面貌，而不是留白：

| 地理 / 社会底座 | 低能力情景（农耕 / 早期） | 中高能力情景（王国 / 城邦 / 近代） |
| --- | --- | --- |
| 矿产 + 林木/燃料 + 交通（城市） | **手工工坊** (`craft`) / **矿业城镇** (`mining`) | **工业中心** (`industrial`) |
| 草原 / 高原 / 半干旱边缘（城市） | **牧业聚落** (`pastoral`) | 随工业与城市化提升自然淡化 |
| 矿产与工艺富集国（国家经济轴） | **矿冶工艺** (`artisan-craft`) | **工业强权** (`industrial-power`) |
| 低行政分散社会（国家权力轴） | **部族宗法** (`tribal-kinship`) | 转为 **地方分权** (`decentralized`) / **中央集权** (`centralized`) |
| 农耕与先祖/自然信仰（国家治理轴） | **礼法宗族** (`ancestral-ritual`) | 转为 **贵族王朝** / **民主代议** |

### 1.3 特征复合度动态收放

随社会分工复杂度（由 `urbanConcentration` 与 `industrialCapability` 共同衡量）动态调节单城/单国的特征槽位上限与副特征门槛：

- **低分工社会**（如农耕聚落，`urban <= 0.25 && ind < 0.2`）：
  - 普通聚落最多保留 **1 个特征**（仅大型聚落、首都或圣地可保留 2 个）；
  - 国家常见 **1–2 个朴素特征**（维度 2 的门槛略高，减少强行挂标签）。
- **中高分工社会**（如城邦商贸、区域王国、近代工业商贸）：
  - 普通聚落保留 **1–2 个特征**，大城市/首都最多保留 **3 个复合特征**（如 `工业中心 · 商贸海港 · 文化名城`）；
  - 国家常见 **2–3 个复合特征**（如 `中央集权 · 尚武扩张 · 工业强权`）。

---

## 二、城市特征系统（`SettlementFeature`，共 12 种）

### 2.1 设计原则

- **100% 由现有客观数据驱动**：仅读取当前已生成的地形、水文、生态地表、资源潜力与矿点、宜居性、交通网络、文化起源与宗教产物；
- **单城克制**：虽然总词表有 12 种，但在任意单一背景下实际活跃的约 8–10 种，且单城严格控制在 1–3 个特征，保证每座命名聚落至少有 1 个可解释主导特征；
- **首都槽位留给底色**：首都已通过 `tier === 'capital'` 表达，不重复占用“行政首都”槽位。

### 2.2 完整城市特征清单与判断信号

> 符号约定：`avg1(field, r)` 为区域 `r` 与 1 跳陆地邻居均值；`maxDeposit(cat, r)` 为 `r` 与 1 跳陆地邻居内指定类别矿点最大 `richness`。

| 类别 | 特征 ID | 中文名 | 核心输入信号（均为现有字段） | 能力门控与演替关系 |
| --- | --- | --- | --- | --- |
| 生产 | `agrarian` | 农耕中心 | `avg1(agriculturalPotential)`、`riverIndex`、平缓度 `1 - slope` | 全时期可用 |
| 生产 | `pastoral` | 牧业聚落 | 草原/灌丛/高原地表（`ecology` `landCover`）、中高海拔、低林低农但有一定宜居度 | 低工业/低聚居权重高，高工业自然减弱 |
| 生产 | `industrial` | 工业中心 | `economicOpportunity`、`maxDeposit('mineral')`、`maxDeposit('energy')` | 要求 `industrialCapability >= 0.35`，承接 `craft` 演替 |
| 生产 | `craft` | 手工工坊 | `forestryPotential` + 邻近矿点或河流/商路节点 + 一定人口规模 | `industrialCapability < 0.35` 时活跃，超过 `0.55` 逐步退场 |
| 生产 | `mining` | 矿业城镇 | `maxDeposit('mineral')`、`maxDeposit('energy')` | 全时期可用（高工业且具燃料通达时部分转为 `industrial`） |
| 生产 | `forestry` | 林木工坊 | `avg1(forestryPotential)`、林地覆盖、陆路/河运连通 | 全时期可用 |
| 生产 | `fishery` | 渔业港镇 | `coastalMask`、`avg1(fisheryPotential)` | 全时期可用（强海贸大港优先呈现 `maritime-trade`） |
| 商贸 | `maritime-trade` | 商贸海港 | `isPort`、海路（`mode === 'sea'`）连接数与 `trafficScore`、`portPotential` | 要求 `seafaringCapability >= 0.30` 且至少有 1 条海路 |
| 商贸 | `trade-hub` | 商路枢纽 | `nodeCentrality`、陆路/河运路线数与流量分、支流汇流度 | 低陆运（`< 0.40`）时抬高触发门槛，仅保留大河汇流核心 |
| 社会 | `cultural` | 文化名城 | 是否文化起源地（`hearthRegions`）、多文化交汇度（`regionCultures[r].length`）、人口分位 | 全时期可用（低聚居时偏向古老起源地） |
| 社会 | `religious` | 宗教圣城 | 是否宗教起源圣地（`religionOrigins`）或其紧邻低传播代价核心、`hierarchical` 加成 | 全时期可用 |
| 战略 | `fortress` | 要塞军镇 | `elevationKm`、`slopeRadians`、陆路节点度数/地形咽喉度、较低农业潜力 | 要求 `administrativeCapacity >= 0.25` 或高交通咽喉，农耕期极少 |

### 2.3 评分与筛选策略（参考公式）

对每座命名聚落 $s$（所在格 $r$）计算各特征得分 $S_f(s) \in [0, 1]$：

- `agrarian` $= \text{clamp01}\big(0.70 \cdot \text{avg1}(\text{agri}) + 0.15 \cdot \mathbb{I}[\text{river}] + 0.15 \cdot \text{flatness}\big)$
- `pastoral` $= \text{clamp01}\big((0.55 \cdot \mathbb{I}[\text{grassland/shrub/steppe}] + 0.45 \cdot \text{clamp01}(\text{elev}/1.4)) \cdot (1 - 0.65 \cdot \text{avg1}(\text{agri})) \cdot (1 - 0.55 \cdot \text{avg1}(\text{forest}))\big) \cdot \text{fade}(\text{indCap}, 0.2, 1.0, 1.0, 0.45)$
- `industrial` $= \mathbb{I}[\text{indCap} \ge 0.35] \cdot \text{clamp01}\big(0.65 \cdot \text{economicOpportunity}[r] + 0.35 \cdot \sqrt{\text{maxDep}_{\text{mineral}} \cdot \max(\text{maxDep}_{\text{energy}}, 0.25 \cdot \text{forest})}\big) \cdot \min(1.2, \text{indCap})$
- `craft` $= \text{fade}(\text{indCap}, 0.25, 0.55, 1.0, 0) \cdot \text{clamp01}\big(0.35 \cdot \text{avg1}(\text{forest}) + 0.35 \cdot \text{maxDep}_{\text{mineral}} + 0.30 \cdot \text{nodeCentrality}[s]\big)$
- `mining` $= \text{clamp01}\big(\max(\text{maxDep}_{\text{mineral}}, \text{maxDep}_{\text{energy}}) \cdot (1.05 - 0.35 \cdot \text{clamp01}(S_{\text{industrial}}))\big)$
- `forestry` $= \text{clamp01}\big(\text{avg1}(\text{forest}) \cdot (1.1 - 0.5 \cdot \text{avg1}(\text{agri}))\big)$
- `fishery` $= \mathbb{I}[\text{coastal}] \cdot \text{clamp01}\big(\text{avg1}(\text{fishery}) \cdot (1.1 - 0.45 \cdot S_{\text{maritime-trade}})\big)$
- `maritime-trade` $= \mathbb{I}[\text{isPort} \land \text{seaCap} \ge 0.30 \land \text{seaRoutes} > 0] \cdot \text{clamp01}\big(0.35 \cdot \text{portPotential}[r] + 0.35 \cdot \min(1, \text{seaRoutes}/3) + 0.30 \cdot \text{normSeaTraffic}\big)$
- `trade-hub` $= \text{clamp01}\big(0.50 \cdot \text{nodeCentrality}[s] + 0.30 \cdot \min(1, \text{landRiverRoutes}/4) + 0.20 \cdot \mathbb{I}[\text{confluence}]\big) \cdot \text{ramp}(\text{landCap}, 0.20, 0.50, 0.55, 1.0)$
- `cultural` $= \text{clamp01}\big(0.55 \cdot \mathbb{I}[\text{isHearth}] + 0.25 \cdot \text{cultureMixScore} + 0.20 \cdot \text{popPercentile}\big)$
- `religious` $= \text{clamp01}\big(0.85 \cdot \mathbb{I}[\text{isReligionOrigin}] + 0.15 \cdot \mathbb{I}[\text{hierarchicalReligion}]\big)$（紧邻圣地或极低传播代价中心给衰减次级分）
- `fortress` $= \text{ramp}(\text{adminCap}, 0.15, 0.40, 0.35, 1.0) \cdot \text{clamp01}\big(0.40 \cdot \text{clamp01}(\text{elev}/1.6) + 0.30 \cdot \text{clamp01}(\text{slope}/0.22) + 0.30 \cdot \min(1, \text{landRoutes}/3)\big) \cdot (1 - 0.4 \cdot \text{avg1}(\text{agri}))$

> `fade(x, lo, hi, vLo, vHi)` / `ramp(x, lo, hi, vLo, vHi)` 为分段线性夹紧插值函数。

筛选策略：
- 主特征取最高分特征；
- 副特征上限由复合度决定（低分工普通聚落 1 项、圣地/首都 2 项；中高分工普通聚落 2 项、大城/首都 3 项），副特征需得分 $\ge 0.45$ 且不低于主特征得分的 `65%`；
- 按得分降序存储（平手按固定特征表顺序破平），保持 100% 确定性。

---

## 三、国家特征系统（`PolityTrait`，3 维共 15 种）

### 3.1 设计原则：三正交维度 + 与 `PolityArchetype` 职责分离

- **`PolityArchetype`（现有 20 种政体形式）**：负责外在制度名称、元首/政府首脑/立法机构头衔与继承方式（如「王国」「共和国」「神权国」「商人共和国」「汗国」「酋长领」）。
- **`PolityTrait`（3 维 15 种国家特征）**：负责内在权力结构、治理合法性与经济立国取向，在领土划分**之前**涌现，直接调制领土扩张规则，并在领土收口后引导 `PolityArchetype` 选型。
- 每个维度最多选 1 项，杜绝逻辑矛盾组合；每个国家最终持有 **1–3 个特征**（维度 1 与维度 3 必选，维度 2 达门槛触发）。

### 3.2 维度 1：权力与领土形态（必选 1 项，5 种）

| 特征 ID | 中文名 | 形成信号与能力门控 | 领土扩张调制 |
| --- | --- | --- | --- |
| `centralized` | 中央集权 | **要求 `admin >= 0.45`**；高行政 + 首都相对最强地方中心具有规模优势 + 农业/工业底座强 + 地理文化整合阻力低 | 基础扩张速率 `×1.30`；异文化惩罚 `×0.88` |
| `city-state-civic` | 城邦自治 | **要求 `urban >= 0.30`**；本地海贸/商路功能强，文化辅助，且城市核心人口较集中；临海、小首都或文化起源本身不构成自治依据 | 基础速率 `×0.48`（v12 用于扩张偏好和面积名次倾向，不保证小国）；海路/近海投送惩罚 `×0.80` |
| `decentralized` | 地方分权 | 本地多中心聚落、坡度/通行阻力或文化组成差异共同支持，默认高行政背景下仍可出现（全时期可用） | 基础扩张速率 `×0.90`；异文化惩罚 `×0.78` |
| `tribal-kinship` | 部族宗法 | **`admin <= 0.35 && urban <= 0.30` 强激活，`admin >= 0.50` 退场**；分散农林渔牧聚落 | 基础扩张速率 `×0.78`；跨文化与跨海惩罚 `×1.25` |
| `nomadic-pastoral` | 游牧部族 | 腹地以 `pastoral` / 高原草原干旱带为主 + 低 `urban` + 低 `ind`（`ind >= 0.70` 时大幅减弱） | 平缓草原/低阻力陆地 `×1.18`；海路与远洋投送惩罚 `×1.60` |

当前 v11 用首都与最强地方中心的相对规模表达本地集中程度：`largestRival = max(wi Pi)`，`capitalPrimacy = Pcap/(Pcap+largestRival)`，`distributedCenters = min(1, largestRival/Pcap)`（零人口输入的信号置零）。不再使用 v10 的首都占全部腹地人口比例；后者会将普通城镇网络误当分权。商业特化为 `max(0, civicFunction−productiveCore)`，不再用比值饱和并普遍扣减集权。文化组成按聚落人口与距离权重汇总，用 `1−Σshare²` 表达差异；地理整合阻力读取实际坡度/通行阻力。集权、分权、城邦等评分表达条件支持度，权力维度以稳定 Seed fork 加权抽取，零分候选禁用；治理与经济维度仍采用原评分选择。能力门控保留，游牧要求本地牧业领先其他主要生产评分，不设全世界类型比例。首都与腹地只是划界前采样，制度不能由经济地理唯一决定；未实现历史演化。实测及限制见 [CIV-02 分布对照](benchmarks/CIV-02-trait-distribution.md)。

### 3.3 维度 2：治理与合法性取向（条件触发 0–1 项，5 种）

| 特征 ID | 中文名 | 形成信号与能力门控 | 领土扩张调制 |
| --- | --- | --- | --- |
| `theocratic` | 政教合一 | 首都或局部腹地含 `religious` 圣城 + 主导宗教偏 `hierarchical` 或低 `tolerance`（全时期可用） | **同主导宗教区步进成本 `×0.72`**，异教区步进成本 `×1.32` |
| `democratic` | 民主代议 | **要求 `urban >= 0.35 && admin >= 0.35`**；腹地富集 `cultural`/`trade-hub`/`industrial`/`maritime-trade` | 基础扩张速率 `×0.92`；异文化惩罚 `×0.82` |
| `militaristic` | 尚武扩张 | 首都或腹地含 `fortress`/`mining` + 非纯城邦体制（`admin < 0.25` 时门槛略高） | 基础扩张速率 `×1.20`；高阻力山地/关隘通行折扣 `×0.85` |
| `dynastic-aristocratic` | 贵族王朝 | **要求 `admin >= 0.30`**；强 `agrarian` 单文化核心 + 中低工业化 | 基础扩张速率 `×1.08`；跨海惩罚 `×1.18` |
| `ancestral-ritual` | 礼法宗族 | **`ind < 0.35 && urban < 0.45` 激活，高工业/高城市化退场**；农耕与传统/宗祠/地方信仰核心 | 同文化区域步进成本 `×0.86`；跨文化与远洋扩张保守（`×1.15`） |

### 3.4 维度 3：经济立国导向（必选 1 项，5 种，由城镇特征聚合涌现）

| 特征 ID | 中文名 | 形成信号与能力门控 | 领土扩张调制 |
| --- | --- | --- | --- |
| `mercantile` | 重商海贸 | **要求 `seafaring >= 0.30`**；`maritime-trade` + `trade-hub`（含 `fishery` 辅助）权重领先 | 陆地速率 `×0.88`；**海路捷径与远洋港口投送成本 `×0.68`** |
| `agrarian-realm` | 农本立国 | `agrarian`（含 `pastoral`/`forestry` 辅助）权重领先（全时期可用） | 农业平原扩张稳定（速率 `×1.05`）；远洋投送成本 `×1.15` |
| `industrial-power` | 工业强权 | **要求 `industrialCapability >= 0.35`**；`industrial` + `mining` 权重领先 | **交通捷径（陆路/河运/海路）成本 `×0.78`**；远洋投送成本 `×0.82` |
| `artisan-craft` | 矿冶工艺 | **`industrialCapability < 0.35` 激活，`>= 0.55` 退场**；`craft` + `mining` + `forestry` 权重领先 | 陆路/河运商道捷径成本 `×0.86`；陆地速率 `×1.02` |
| `cultural-patron` | 文教兴邦 | `cultural` 权重领先 + 文化起源核心聚集（全时期可用） | **同文化区域扩张成本 `×0.80`**；强行跨文化惩罚 `×1.12` |

### 3.5 四套背景预设下的活跃生态预览

| 预设 | 活跃主力城市特征 | 活跃主力国家特征 |
| --- | --- | --- |
| **农耕聚落** | 农耕中心、牧业聚落、渔业港镇、林木工坊、矿业城镇、手工工坊、宗教圣城（单城多 1 项） | 部族宗法 / 游牧部族 / 地方分权 + 礼法宗族 / 政教合一 + 农本立国 / 矿冶工艺 |
| **城邦商贸** | 商贸海港、商路枢纽、手工工坊、文化名城、渔业港镇、宗教圣城 | 城邦自治 / 地方分权 + 民主代议 / 贵族王朝 / 政教合一 + 重商海贸 / 文教兴邦 / 矿冶工艺 |
| **区域王国** | 农耕中心、商路枢纽、要塞军镇、手工工坊、矿业城镇、宗教圣城、商贸海港 | 地方分权 / 中央集权（大核心）/ 游牧部族 + 贵族王朝 / 尚武扩张 / 政教合一 + 农本立国 / 矿冶工艺 / 重商海贸 |
| **近代工业商贸** | 工业中心、商贸海港、商路枢纽、文化名城、农耕中心、矿业城镇、要塞军镇（大城多 2–3 项） | 中央集权 / 地方分权 / 城邦自治 + 民主代议 / 尚武扩张 / 贵族王朝 / 政教合一 + 工业强权 / 重商海贸 / 农本立国 / 文教兴邦 |

### 3.6 国家特征到现有 `PolityArchetype` 的映射强化

领土划定后，选定最终政体原型时用国家特征大幅加权 `scorePolityArchetype`（仍结合 `sizeClass`、`coastal`、`highland`）：

- `city-state-civic` + `mercantile` → 优先 `merchant-republic`、`city-state`、`league`
- `city-state-civic`（非重商）→ 优先 `city-state`、`free-territory`、`commune`、`principality`
- `tribal-kinship` → 强加权 `chiefdom`、`tribal-confederation`、`commune`
- `nomadic-pastoral` → 强加权 `khanate`、`tribal-confederation`、`chiefdom`
- `theocratic` → 强加权 `theocracy`（次选 `sultanate`、`emirate`）
- `centralized` + `empire/kingdom` → 优先 `empire`、`dynastic-monarchy`、`kingdom`
- `democratic` → 优先 `republic`、`federation`、`merchant-republic`
- `decentralized` → 优先 `confederation`、`federation`、`league`、`free-territory`、`principality`
- `militaristic` → 加权 `empire`、`military-junta`、`khanate`、`kingdom`
- `ancestral-ritual` → 加权 `dynastic-monarchy`、`kingdom`、`chiefdom`、`principality`

---

## 四、无循环 6 步管线与领土扩张公式（`polities-religions-v11`）

### 4.1 破除“城镇归属 vs 国家特征”循环依赖

核心做法：**将宗教起源与传播前移到国家扩张之前**（它原本就不依赖国家领土），并在正式划界前通过**首都 + 首都周边局部腹地城镇**预聚合国家初始特征。整个过程在 `polities-religions` 内部单向完成，不新增 Stage。

```text
[Step 1] 宗教起源与传播（前移）
   输入：rankedSites、terrain、habitability、resources、transport.routes
   输出：religions[]、religionOrigins[]、dominantReligionIndex[N]

[Step 2] 全图城市特征评估（含能力门控与演替）
   输入：terrain、hydrology、ecology、resources、habitability、transport、
        peoplesCultures(含 hearthRegions)、Step 1 宗教结果、capabilities + urbanConcentration
   输出：每座命名聚落的 featureScores 与主导 Settlement.features[]

[Step 3] 首都选址（沿用现有规则）
   输出：capitals[]

[Step 4] 国家特征涌现（在领土划界前）
   采样：将每座命名聚落临时归入最近首都（限距内）构成局部腹地；
        首都自身评分占 50%，局部腹地评分按距离加权均值占 25%，各特征峰值占 25%（无腹地时只用首都）；
        叠加上游地理、宗教、文化与全局 capabilities + urbanConcentration，
        经确定性随机微调产出 Polity.traits[]（3 维）

[Step 5] 特征调制领土扩张 & 海洋投送
   5a. 主扩张多源 Dijkstra（叠加国家扩张速率 + 文化/宗教/地形/交通特征系数）
   5b. 近海海峡投送（Pass 1，无政体偏置，保证近岸归最近海岸）
   5c. 孤立有人大岛本土建国（Pass 2，同步由该大岛城镇特征涌现岛国 Polity.traits[]）
   5d. 远洋港口投送（Pass 3，叠加重商/工业/游牧等海权特征系数）

[Step 6] 领土统计、政体原型对齐、命名与人口分组收口
   输入：最终 territoryPolityIndex、Polity.traits[]、sizeClass
   输出：polities[]（含 traits）、settlements[]（含 features）、populationGroups[]（严格守恒）
```

### 4.2 特征对领土扩张的作用公式

设国家 $p$ 由三个维度特征相乘得到的基础扩张速率为：

$$\text{rate}_p = \text{clamp}\big(m_{\text{dim1}}(p) \times m_{\text{dim2}}(p) \times m_{\text{dim3}}(p),\ 0.38,\ 1.75\big)$$

在主扩张多源 Dijkstra 中，国家 $p$ 从区域 $u$ 扩张到邻格 $v$ 的步进代价为：

$$\Delta \text{cost}_{p}(u \to v) = \frac{\text{baseStepDays}(u, v)}{\text{rate}_p} \times F_{\text{culture}}(p, v) \times F_{\text{religion}}(p, v) \times F_{\text{terrain}}(p, v)$$

交通捷径（陆路/河运/海路）代价同理除以 $\text{rate}_p$，并乘以特征对应的捷径或海路系数。  
在远洋港口投送（Pass 3）中，`claimMaritimeTerritory` 接收每政体可选的远洋成本系数 $F_{\text{ocean}}(p)$（反映 `mercantile`、`industrial-power`、`city-state-civic`、`nomadic-pastoral`、`tribal-kinship`、`agrarian-realm` 等跨海倾向），而第一轮近海海峡投送（Pass 1）保持无偏置，确保本国近岸小岛仍归最近海岸。

### 4.3 典型国家组合的领土表现预览

| 国家特征组合 | 基础速率 $\text{rate}_p$ | 相对面积趋势（$\propto \text{rate}^2$） | 预期版图与政体形态 |
| --- | ---: | ---: | --- |
| 城邦自治 + 民主代议 + 重商海贸 | `0.39` | 紧凑小国（基准的 ~15%–25%） | 滨海/海峡小城邦 + 若干海岛据点（商人共和国/城邦） |
| 部族宗法 + 礼法宗族 + 农本立国 | `0.82` | 偏紧凑区域部族（基准的 ~65%） | 农耕期按流域与文化聚拢的酋长领/部族邦联 |
| 地方分权 + 农本立国 | `0.95` | 温和中等国（基准的 ~90%） | 跨文化边界圆滑的多元邦联/联邦 |
| 中央集权 + 政教合一 + 文教兴邦 | `1.30` | 中大型强国（基准的 ~170%） | 国界紧贴宗教与文化传播边界（神权国/帝国） |
| 中央集权 + 尚武扩张 + 工业强权 | `1.56` | 广袤大帝国（基准的 ~240%+） | 沿干线与港口迅速扩张的跨区域大帝国，海外岛屿广 |

---

## 五、契约、缓存、性能与 UI 展示影响

### 5.1 数据契约与版本

- `packages/world-core/src/generation/civilization/civilization-types.ts`：
  - 新增联合类型 `SettlementFeatureId`（12 项）与 `PolityTraitId`（15 项）；
  - `Settlement` 新增 `readonly features: readonly SettlementFeatureId[]`；
  - `Polity` 新增 `readonly traits: readonly PolityTraitId[]`。
- `PeoplesCulturesArtifact`（内部阶段产物）：新增 `readonly hearthRegions: readonly number[]` 供城市 `cultural` 特征判定（不影响快照结构）。
- `POLITIES_RELIGIONS_VERSION` 升至 `polities-religions-v11`；`WORLD_SCHEMA_VERSION` 升至 **Schema 8**（`world-validator.ts` 与 `world-archive.ts` 严格校验 `features` / `traits` 字段，拒绝旧 Schema 1–7 档案）。
- **无参数与分享变更**：`CivilizationParameters`、四套预设与分享链接 `#w=13.` 全部保持不变。

### 5.1.1 国家特征目录与政体引用

当前 `world-data/data/society/polity-traits.json` 定义 16 个短 ID、四维分类与中英文名称/说明，作为独立原生内容包 `builtin-polity-traits@1.1.0` 加载。领土维度按划界后的实际规模派生 `small-area`。中英文政体包当前为 1.4.0，小面积候选通过 `requiredTraits: ["small-area"]` 引用约束，声明依赖并通过 `requiredTraits` 和条件条目数组 `traitAffinities` 引用。匹配条目要求 `traits` 全部满足、`excludedTraits` 全部不满足，并可限定 `sizeClasses`；命中时将候选权重乘有限正数 `weight`，按数组顺序累计。组合偏好从原核心分支移入数据，神权国额外要求 `theocratic`；无匹配候选时阶段明确失败。目录/约束/偏好参与内容签名；发布校验对目录引用、四维互斥、实际面积及原型要求作检查。详细字段和兼容边界见 [世界数据契约](WORLD_DATA_CONTRACTS.md)。

`polities-religions-v11` 保留 v8 随机流，领域评分与扩张公式仍在核心；不增加城镇特征 JSON 或通用表达式引擎。Schema 8、分享 v13 不变；定向测试、四 Seed L6 分布与诊断重放已完成，浏览器尚未验证。

### 5.2 缓存边界与性能估算

- **缓存零退化**：`politiesReligionsStage` 新增声明读取 `ecology-e0`、`hydrology-h0` 与现有配置键（`industrialCapability`、`landTransportCapability`、`seafaringCapability`、`urbanConcentration`）。由于修改这些能力或聚居参数原本就会触发对应上游阶段（`habitability` / `population-settlements` / `transport-network`）及下游重算，因此：
  - 仅调 `administrativeCapacity` 或 `polityDensity` → 仍只重算 `polities-religions`；
  - 仅调 `seafaringCapability` → 仍从 `transport-network` 向下重算；
  - 仅调 `urbanConcentration` → 仍从 `population-settlements` 向下重算。
- **性能待实测**：当前特征计算、额外辅助数组及阶段依赖复制的耗时/内存增量尚未测量；历史 L8 峰值 3.84 GiB 属于 CIV-01，不能作为 CIV-02 的验证结论。

### 5.3 UI 展示（`apps/web`）

- `RegionInspector.svelte`：
  - 选中聚落或浏览区域内聚落时，在等级与港口后展示城市特征徽章（如 `商贸海港` · `文化名城`）；
  - 选中政体或浏览区域所属政体时，展示国家特征徽章（如 `中央集权` · `工业强权` · `尚武扩张`），让“为什么此城如此、为什么此国大/小”一目了然。
- 城市特征名称保留在 Web 的 `zh-CN.json` / `en.json`；国家特征名称与悬停说明统一读取 `world-data` 的双语目录。
- `packages/cartography`：本轮无需改动渲染层（后续按需可基于 `Settlement.features` / `Polity.traits` 增加专题图层或符号样式）。

---

## 六、待评审与可微调清单

审阅本文档时，可以重点核对以下 5 点：

1. **城市特征（12 项）与演替对**：`craft ↔ industrial`、`pastoral` 的补充是否贴合预期，还需要增删哪些城市特征？
2. **国家特征（3 维 15 项）与演替对**：`tribal-kinship ↔ centralized/decentralized`、`ancestral-ritual ↔ democratic/dynastic`、`artisan-craft ↔ industrial-power` 这三组演替是否自然，维度 2 是否保持单选？
3. **门槛阈值**：目前 `industrial >= 0.35`、`seafaring >= 0.30`、`centralized admin >= 0.45`、`democratic urban/admin >= 0.35` 是否契合你对四套预设的手感？
4. **特征对领土大小的影响幅度**：城邦速率 `0.39–0.48` vs 集权尚武 `1.56` 的差距是否合适？
5. **孤立大岛的宗教特征**：宗教起源前移后，无海路直达的孤立有人大岛默认可能暂无宗教；是否保持现状，还是允许大型孤立有人岛产生地方宗教起源？
