# 05 · 高程与地貌

[English](./05-elevation-and-topography.md) | [简体中文](./05-elevation-and-topography.zh-CN.md)

## 直观理解

板块边界只给出山脉、海沟和裂谷的“位置与方向”；高程阶段还要决定它们有多宽、多高，以及稳定大陆和深海盆地如何衔接。地貌后处理再加入山脊纹理、海岸弯曲、冰川和侵蚀，形成可渲染的连续地表。

## 构造骨架

[TectonicElevationGenerator](../../src/core/geology/tectonic-elevation-generator.ts) 结合候选海陆、板块应力和多个球面距离场，构造大陆基底、陆架、陆坡、洋盆、造山带、洋中脊和海沟。俯冲侧使边界两侧地形不对称；岛弧、热点等局部地貌在同一高程场上叠加。[TerrainClassifier](../../src/core/geology/terrain-classifier.ts) 用可重叠权重描述克拉通、盆地、褶皱带和高原，不把每块地硬分成唯一类型。

方向性 Phasor 山脊使细长山脊沿汇聚带延伸；地幔动态地形提供更宽的上涌与下沉背景。它们都是生成高程的贡献项，不是独立的地表高度。[Phasor 源码](../../src/core/geology/phasor-ridge-generator.ts) 与 [地幔源码](../../src/core/geology/mantle-dynamic-topography.ts) 保存具体权重。

## 后处理顺序

[TerrainPostProcessor](../../src/core/geography/terrain-post-processor.ts) 当前依次进行：

1. 叠加地形纹理与地幔动态地形，执行高程曲线整形。
2. 在球面上扭曲采样位置，弯曲海岸与山带；此时以零高程建立海洋掩码。
3. 做保边平滑和两层较小尺度细节。
4. 运行冰川、地形驱动的水力及热力侵蚀，再增强山脊、执行土壤蠕移。
5. 转换为以平均海平面为 `0 km` 的物理高程，并输出最终 `landMask`。

这里的水力侵蚀由[地貌侵蚀处理器](../../src/core/geography/terrain-erosion-processor.ts)在**气候阶段之前**运行，使用地形和简化汇流。它不是月降水驱动的泥沙守恒模拟；当前代码也没有侵蚀后重新计算气候的反馈回路。地貌侵蚀诊断 `terrainErosion` 与最终气候驱动的 `hydrology` 河网应分别理解。

地貌处理器在侵蚀阶段会使用 Priority-Flood 找排水路径并进行沟谷整形，因此这里的部分操作确实会改动地形。第 08 章的**最终水文填洼**则只改排水副本。这两次用途相近，但作用时点和是否修改真实高程不同。

| 诊断字段 | 含义 |
| --- | --- |
| `terrainTexture` | Phasor 山脊、构造带纹理、海岸细节等高程贡献 |
| `terrainFinalization` | 高程曲线整形和后处理带来的增量 |
| `terrainErosion.glacialIndex` | 地貌阶段的冰川影响指标 |
| `terrainErosion.erosionDelta` / `depositionDelta` | 地貌侵蚀与沉积的高程变化 |
| `terrainErosion.flowAccumulation` | 地形驱动的上游单元汇流诊断 |

## 高程、海陆与显示

地貌计算内部使用已校准的形态坐标，对外的 `geography.elevation`、`baseElevation` 与地形增量使用 **km**。[单位转换](../../src/core/geography/elevation-units.ts) 集中处理这些换算。3D 地球可对高程做视觉夸张；那只影响几何显示，不会回写物理高程。

例如内部非负形态坐标 `t ≤ 1` 的陆地高程转换为 `h = 6t⁴(5 − 4t)` km；水下形态坐标按每单位 8 km 换算。公式是本项目的高程映射，不是山脉形成的物理定律。出流水文阶段读取转换后的 km 高程，而不是内部 `t`。

`roughness` 控制纹理强度，`terrainWarp` 控制空间扭曲，`smoothing` 控制平滑，`glacialErosion`、`hydraulicErosion` 与 `ridgeSharpening` 分别调节对应后处理。参数相互作用，因此单独调节一个参数不一定只改变一种景观。
