# 03 · 板块运动与构造

[English](./03-plate-tectonics.md) | [简体中文](./03-plate-tectonics.zh-CN.md)

## 直观理解

板块是移动的地壳片。相邻板块相向运动时可能形成山脉、火山弧与海沟；背向运动时可能产生洋中脊或裂谷；侧向错动留下走滑断裂。生成器用这种关系给地形提供大尺度“成因骨架”。

## 板块如何形成

[PlateStage](../../src/core/simulation/pipeline/stages/plate-stage.ts) 在参考网格上生成细板块，再根据板块图创建候选大陆与地壳属性。种子尽量分散，板块沿邻接区域轮流生长，随后处理边界和零散片段。每块板有欧拉旋转向量 `ω`；单位球位置 `p` 的切向速度为 `v = ω × p`。这描述局部运动方向，不表示真实地质年代或 cm/年速度。

[PlatePhysicsProcessor](../../src/core/geology/plate-physics.ts) 根据面积、地壳与边界关系修正初始运动。[SuperPlateStage](../../src/core/simulation/pipeline/stages/super-plate-stage.ts) 把细板块组合成较大的构造单元，让主山带和洋脊保持连续。输出保留 `regionPlate` 与 `regionSuperPlate`：前者便于看细分板块，后者主导大尺度边界。

## 边界如何影响地形

[边界分析器](../../src/core/geology/plate-boundary-analyzer.ts) 比较共享边两侧速度，把相对运动拆成穿越边界的法向分量和沿边界的切向分量。法向相向、背离与切向错动分别支持汇聚、张裂和走滑分类；区域应力与俯冲侧再由边级结果汇总。海洋地壳遇到大陆地壳时，密度和地壳类型参与俯冲极性判断。

以相邻板块速度差 `Δv`、跨边法向 `n` 和沿边切向 `t` 表示，边界诊断使用：

```text
normalVelocity = Δv · n
shearVelocity  = |Δv · t|
edgeStress     = max(|normalVelocity|, shearVelocity)
```

代码用法向阈值 `0.003` 区分明显的汇聚与张裂；其余跨板块边界归入走滑类。这些是生成器中的**相对运动阈值**，并非地球实测板块速度。边级字段保留方向与强度，区域级字段汇总邻边作用。判断俯冲时使用边界两侧当地地壳属性，因此同一板块内同时存在候选大陆和海洋地壳也能参与判断。

边界作用还会向板内衰减，而不是只画在一条线上。构造高程读取碰撞带、洋脊、断层、应力方向与上覆/俯冲侧，建立山带、海沟、火山弧和裂谷。地幔长波场再调制构造响应。相关输出在 [地质数据类型](../../src/core/geology/geology-data.ts) 与 [构造阶段](../../src/core/simulation/pipeline/stages/tectonic-stage.ts)。

[ProjectionStage](../../src/core/simulation/pipeline/stages/projection-stage.ts) 同时分析细板块与超级板块的边界。主构造类型以超级板块边界为骨架，细板块的应力与方向用于局部调制；代码分别给两层应力使用 `0.58` 和 `0.88` 的权重。这样内部细板块接缝不会都变成主山系，但细节仍会影响山带形态。

## 如何读图

界面中的“板块构造”按细板块编号着色。编号颜色只帮助分辨区域，不能直接表示运动方向、应力或地壳类型。内部还保存更细的构造诊断字段，但目前图层栏未开放所有诊断模式。
