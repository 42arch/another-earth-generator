# 01 · 系统架构与数据契约

[English](./01-system-architecture.md) | [简体中文](./01-system-architecture.zh-CN.md)

> 状态：人口、聚落、交通与市场、静态民族与语言、国家与一级行政、宗教与信仰阶段已实现；文化与历史仍为设计草案。

## 直观理解

人文系统读取同一颗星球已经生成的海陆、地形、气候、生态和河流，回答“哪里有人、怎样相连、谁在那里生活”。3D 地球与 2D 地图只读取同一份球面人文结果，不各自生成国家或聚落。

## 接入位置与输入

[Worker 流水线](../../../src/core/simulation/worker/simulation.worker.ts) 在 `SurfaceHydrologyStage` 后执行 `PopulationStage`，读取最终 `landMask`、`elevation`、`biome` 和 `hydrology`；自然输入见[自然系统架构](../nature/01-system-architecture.zh-CN.md)与[水文说明](../nature/08-rivers-and-drainage.zh-CN.md)。水文的 `drainageElevation` 只用于排水寻路，不能当作真实湖面或可用淡水面。宜居性与人口场在最终输出网格上计算。

当前已实现 `PopulationAndSettlements → TransportAndMarkets → EthnicityAndLanguages → PolitiesAndAdministration → ReligionsAndBeliefs`；后续建议顺序为 `CulturesAndRegions → SocietyProjection`。跨领域反馈可采用有界的第二遍更新，例如道路改善市场可达性后修正城镇等级。

## 数据的权威位置

[WorldSimulationState](../../../src/core/simulation/state.ts) 已有可选 `society?: SocietyData`，实现在 `src/core/society/`。当前保存宜居性、人口、聚落实体、路线、市场可达性、民族／语言、国家／行政及宗教／信仰数据；后续可扩展为三类信息：

| 类型 | 示例 | 规则 |
| --- | --- | --- |
| 逐区域数组 | 人口、宜居性、国家编号、主要民族编号 | 索引必须对应最终输出网格；海洋或无归属使用明确的哨兵值 |
| 稀疏实体 | 聚落、道路、国家、民族、语言、宗教、文化 | 稳定 ID；实体引用区域索引或其他实体 ID |
| 人口构成 | 地区、民族、宗教及对应人口 | 人口总量只有一个权威来源，地图主类标签从构成推导 |

如果需要准确查询“某民族中各宗教的人数”，必须保存民族与宗教的交叉构成或居民群组；仅保存两套独立百分比无法推出交叉人数。未来的文化或语言参与也应明确是互斥归属还是可重叠关系。

球面面积应换算为物理面积，再用于人口与聚落规模；显示用的 `core.planetRadius` 不应改变人口。人文传播距离、道路成本与河网尺度需要统一物理半径和单位。[球面距离工具](../../../src/core/math/distance-field.ts)返回球心角，调用方需显式换算。

## 随机性与验收

人文阶段从世界种子派生独立随机流，再按人口、交通、民族、国家、宗教、文化和命名分流。相同种子与配置应生成相同实体 ID、人口和边界；修改宗教参数不应重排已有山脉与城市。必须检查人口非负、海洋无定居人口、区域与居民群组汇总一致、所有实体引用有效，以及不同输出分辨率下宏观分布稳定。

当前 [影响力扩散实现](../../../src/core/math/influence-spread.ts) 返回胜出来源及影响差值，可作为原型参考；它的 `influence` 不能直接解释为人口比例。最终人文数据通过现有 Worker 的可转移数组交付主线程，切换图层或视图不应重新生成社会。
