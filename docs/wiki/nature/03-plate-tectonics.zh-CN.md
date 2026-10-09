# 03 · 板块运动与构造

[English](./03-plate-tectonics.md) | [简体中文](./03-plate-tectonics.zh-CN.md)

## 直观理解

板块是移动的地壳片。相邻板块相向运动时可能形成山脉、火山弧与海沟；背向运动时可能产生洋中脊或裂谷；侧向错动留下走滑断裂。生成器用这种关系给地形提供大尺度“成因骨架”。

## 板块如何形成

[PlateStage](../../../src/core/simulation/pipeline/stages/plate-stage.ts) 在参考网格上固定生成 100 个构造细分，并先将它们组合成面积不等、连通的主要板块，再沿边界拆出少量独立运动的小板块。细分种子尽量分散，单元沿邻接区域生长；细分数量是内部生成常量，不作为用户参数。

[ContinentalCrustStage](../../../src/core/simulation/pipeline/stages/continental-crust-stage.ts) 随后参考已确定的主要板块布局，生成候选大陆和地壳属性。[SuperPlateStage](../../../src/core/simulation/pipeline/stages/super-plate-stage.ts) 再由 [PlatePhysicsProcessor](../../../src/core/geology/plate-physics.ts) 根据面积、地壳与边界关系修正运动。每块构造板块有欧拉旋转向量 `ω`；单位球位置 `p` 的切向速度为 `v = ω × p`。这描述局部运动方向，不表示真实地质年代或 cm/年速度。输出保留 `regionPlate` 与 `regionSuperPlate`：前者表示候选大陆布局所用细分，后者表示独立运动的构造板块。

## 边界如何影响地形

[边界分析器](../../../src/core/geology/plate-boundary-analyzer.ts) 比较共享边两侧速度，把相对运动拆成穿越边界的法向分量和沿边界的切向分量。法向相向、背离与切向错动分别支持汇聚、张裂和走滑分类；区域应力与俯冲侧再由边级结果汇总。海洋地壳遇到大陆地壳时，密度和地壳类型参与俯冲极性判断。

以相邻板块速度差 `Δv`、跨边法向 `n` 和沿边切向 `t` 表示，边界诊断使用：

```text
normalVelocity = Δv · n
shearVelocity  = |Δv · t|
edgeStress     = max(|normalVelocity|, shearVelocity)
```

代码用法向阈值 `0.003` 区分明显的汇聚与张裂；其余跨板块边界归入走滑类。这些是生成器中的**相对运动阈值**，并非地球实测板块速度。边级字段保留方向与强度，区域级字段汇总邻边作用。判断俯冲时使用边界两侧当地地壳属性，因此同一板块内同时存在候选大陆和海洋地壳也能参与判断。

边界作用还会向板内衰减，而不是只画在一条线上。构造高程读取碰撞带、洋脊、断层、应力方向与上覆/俯冲侧，建立山带、海沟、火山弧和裂谷。地幔长波场再调制构造响应。相关输出在 [地质数据类型](../../../src/core/geology/geology-data.ts) 与 [构造阶段](../../../src/core/simulation/pipeline/stages/tectonic-stage.ts)。

[ProjectionStage](../../../src/core/simulation/pipeline/stages/projection-stage.ts) 以独立运动的构造板块边界生成构造应力。内部细分继承所属板块的运动，不再因细分接缝产生独立的碰撞应力。

## 如何读图

界面中的“板块构造”按独立运动的板块编号着色。构造细分仅用于内部生成和检查器信息，不再作为单独图层。编号颜色只帮助分辨区域，不能直接表示运动方向、应力或地壳类型。
