# 球面湖泊系统设计与实现（L1–L2）

## 1. 阶段 L1：地形湖泊

阶段 L1 实现确定性的最大地形湖盆，不使用随机挖洞。L2 在其上求解水量平衡，
所以这里得到的是盆地达到溢流口时的最大湖面，而不一定是最终湖面。

生成顺序：

```text
基础陆地 → 原始高程 → Priority Flood → 封闭盆地 → 湖泊筛选
        → 平坦湖面 → Feature → Climate → Rivers
```

`SphericalLakeGenerator` 使用 Priority Flood 计算排水高程，并以
`filledElevation - baseElevation` 作为填洼深度。相邻的正填洼区域组成候选盆地，
然后按以下条件过滤：

- 最大填洼深度达到 `lakeMinDepth`；
- region 数量达到 `lakeMinRegionCount`；
- 与海岸的图距离达到 `lakeMinCoastDistance`；
- 按深度、面积和 region 数量形成的确定性评分排序；
- 总湖面面积不超过 `lakeMaxLandCoverage × baseLandArea`；
- `lakeDensity` 控制通过过滤的候选盆地保留比例。

选中湖泊的 region 从最终 `landMask` 中移除，但仍保留在 `baseLandMask` 中。
同理，`baseElevation` 保存湖底地形，最终 `elevation` 将同一湖泊的所有 region
设置为统一的溢流面高程。这样重新调节湖泊参数时可以恢复湖底，高度图和等高线
也会显示平坦湖面。

### 默认参数

| 参数 | 默认值 | 说明 |
| --- | ---: | --- |
| `lakeDensity` | `0.6` | 保留候选盆地的比例 |
| `lakeMinDepth` | `0.008` | 最小归一化填洼深度 |
| `lakeMinRegionCount` | `2` | 最少湖面 cell 数量 |
| `lakeMinCoastDistance` | `2` | 与海岸的最小图距离 |
| `lakeMaxLandCoverage` | `0.025` | 最大湖盆占基础陆地面积的上限 |

### 数据

`SphericalLakeData` 保存：

- `lakeMask` 和 `regionLakeId`；
- 每个湖泊的湖面高程、湖底高程、面积和潜在容积；
- 盆地出口和出口下游 region。

湖泊进入最终 `landMask` 后，现有系统会自动完成以下行为：

- `SphericalFeatureGenerator` 将其分类为 `Lake`；
- 海岸线提取器绘制湖岸线；
- Terrain 模式使用淡水湖颜色；
- 气候系统将湖面视作水域；
- 河流系统在 L2 中根据湖泊类型决定截流或继续排水；
- region 拾取显示湖泊编号、面积和深度。

## 2. 阶段 L2：水文湖泊（已实现）

L2 使用一次确定性的水文迭代，把最大地形湖盆转换为受气候控制的实际湖面：

```text
最大地形湖盆
  → 初步 Climate / Runoff
  → 初步 Drainage / Lake Inflow
  → 入流-蒸发平衡
  → 动态湖面、干涸和内外流分类
  → 最终 Climate / Rivers
```

采用这条两遍流水线是为了避免循环依赖：湖面影响气候和河流，而气候径流又决定
湖面。第一遍以最大湖盆为边界估计汇水量，第二遍在平衡后的湖面上生成最终气候与
河网。所有步骤都只依赖 seed、网格与参数，重生成结果保持确定。

### 2.1 水量平衡

每个最大湖盆的输入为所有直接流入湖岸 cell 的累计径流：

```text
inflow = Σ flowAccumulation[入湖上游 region]
evaporation = maximumLakeArea × oceanEvaporation
              × temperatureFactor × lakeEvaporationStrength
balanceRatio = inflow / evaporation
```

- `balanceRatio >= lakeOverflowThreshold`：湖面达到溢流口，形成外流湖；
- 未达到阈值：按照平衡比的非线性曲线降低水位，形成内流湖；
- `fillRatio < lakeMinFillRatio`：湖泊干涸，恢复原始陆地和湖底高程；
- 收缩湖面只保留与盆底连通、且低于当前水位的 cell，避免生成孤立水斑；
- 盐度是年度缺水程度的归一化代理值，不是化学模拟；季节湖由最终河网的
  四季入流与按季温度分配的开放水面蒸发共同判定，不再只看年度低水位。

最终湖泊数据增加：

- `inflow`、`evaporation` 和 `fillRatio`；
- `seasonalInflow`、`seasonalEvaporation` 和 `seasonalFillRatio`；
- `isEndorheic`、`isSeasonal`；
- `salinity`（0–1 的相对盐度代理）；
- 仅外流湖保留有效的 `outletRegion` 和 `outletTarget`。

### 2.2 河流穿湖路由

河流生成器使用两种掩码：

- 实际 `landMask` 决定哪里产生地表径流、哪里绘制河道；
- 水文路由掩码额外启用外流湖 cell，使累计流量能够穿过湖泊到达出口。

内流湖仍是汇流终点。外流湖内部不绘制河段，入湖河流在湖岸结束，累计流量穿过
湖面后在出口下游重新形成河流。出口河流不受普通源头最低高程限制，但仍受最小
流量和最小长度限制。

### 2.3 L2 参数

| 参数 | 默认值 | 说明 |
| --- | ---: | --- |
| `lakeEvaporationStrength` | `1.0` | 开阔湖面蒸发倍率 |
| `lakeOverflowThreshold` | `1.0` | 外流所需的入流/蒸发比 |
| `lakeMinFillRatio` | `0.18` | 低于该相对水位时湖泊干涸 |

主要湖泊参数与河流参数统一位于 3D 控制面板的 `Hydrology` 分组。最少 cell、
海岸距离、最大覆盖率、最低填充率和最短河长等细粒度约束使用内部默认值，不在
常用控制面板中展示。气候参数变化会重新执行 L2，因为温度、降水、入渗和蒸散
都会改变湖泊水量平衡。
