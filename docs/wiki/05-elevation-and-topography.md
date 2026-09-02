# 第 5 章 · 高程建模与双尺度地貌生成

地形高程（Elevation）是星球表面的三维形态特征。本章剖析奇幻地图生成器如何融合板块构造力、海岸距离场、洋中脊/海沟动力学剖面与 3D Simplex 分形噪声，建立兼顾视觉立体感与严谨物理气象模拟的 **双尺度高程体系**。

---

## 1. 地貌演化模型与多力融合

真实星球的高程由内部构造力（板块推挤、俯冲与张裂）与外部地质营力（侵蚀、沉积、大陆地壳均衡）共同塑造。

地形高程通过多层物理力场线性与非线性叠加构建：

```text
                                高程合成公式 Architecture
┌────────────────────────────────────────────────────────────────────────────────┐
│ 陆地高程 = 内陆隆起 + 大陆壳均衡抬升 + 上盘造山 + 岛屿起伏 - 岛龄沉降 + 噪声 │
│ 海洋水深 = 基础盆地 + 洋壳年龄热沉降 + 下盘海沟 - 大洋中脊凸起 + 海底噪声     │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 海岸距离场与大陆内部隆起 (Coast Distance Field)

利用带球面边长权重的多源 Dijkstra，从海岸线向陆地腹地和深海大洋分别计算图测地角距离：

$$\text{CoastDistance}(r) = \min_{c \in \text{Coastline}} \sum_{(i,j)\in path(c,r)} \arccos(\mathbf{P}_i\cdot\mathbf{P}_j)$$

```mermaid
flowchart LR
    A[海岸线 Coastline D=0] --> B[近海大陆架 D=1..3]
    B --> C[内陆平原与丘陵 D=4..10]
    C --> D[大陆腹地/高原 D>15]
    A --> E[大陆坡/近海海沟 D=1..4]
    E --> F[深海大洋盆地 D>12]
```

### 2.1 陆地内部隆起曲线
所有原先以 subdivision-6 网格步数调校的宽度均换算为球面角宽度。参考单元角尺度为 $\theta_6=\sqrt{4\pi/40962}$，因此归一化内陆距离为 $\text{inland}=\min(1,\text{CoastDistance}/(18\theta_6))$。改变 subdivision 不再改变大陆坡和内陆尺度。

大陆腹地整体抬升公式为幂函数：

$$\text{BaseInlandRise} = \text{inland}^{0.68} \times 0.43$$

- 次线性指数 $0.68$ 保证沿海平原具有开阔平坦的缓坡，而内陆深处逐渐抬升为广阔的高原腹地。

### 2.2 深海大洋盆地沉降
归一化深海距离：$\text{deepness} = \min(1.0, \frac{\text{CoastDistance}(r)}{22\theta_6})$。

海岸距离只提供近岸大陆坡与盆地形态，深海主控项改为洋壳年龄热沉降：

$$\text{ThermalSubsidence}=3500\sqrt{\operatorname{OceanAge}}\ \text{m}$$

因此洋中脊附近的年轻洋壳较浅，远离扩张中心的老洋壳较深；海岸距离不再单独制造一个固定 $5000\text{m}$ 的深海盆地。

大陆边缘使用平滑阶跃函数 $s=\operatorname{smoothstep}(0.08,0.62,\text{deepness})$ 调制盆地深度、热沉降和海底噪声。海岸附近 $s\approx0$，形成浅缓大陆架；跨过陆架坡折后 $s$ 快速增大，连续过渡至深海盆地，避免老洋壳热沉降直接贴到海岸造成水深突跳。

---

## 3. 板块边界动力学响应剖面

板块边界根据其应力类型产生特定的局部地貌特征：

```text
 1. 聚合造山带 (Mountains)         2. 大洋中脊 (Mid-Ocean Ridges)     3. 俯冲海沟 (Deep Trenches)
            ▲                                    ▲                                │
           / \                                  / \                               │
          /   \                                /   \                      ────────┴────────
    ─────┘     └─────                    ─────┘     └─────               \                 /
                                                                          \               /
                                                                           \             /
                                                                            \___________/
```

### 3.1 最大影响传播剖面
每条共享边的真实应力作为多源传播初值。以优先队列保留所有来源中最大的衰减影响，消除普通 BFS 的“第一个来源获胜”顺序偏差：

$$\operatorname{Influence}(d,S,R)=S\exp\left(-3.5\frac{d}{R}\right)$$

| 构造类型 | 适用区域 | 衰减影响半径 $R$ | 振幅系数 | 形成的地貌特征 |
| :--- | :--- | :---: | :---: | :--- |
| **聚合碰撞/俯冲（Convergent）** | 陆陆碰撞两侧或俯冲上盘陆地 | $18\theta_6$ | $0.30 \times \text{mountainStrength}$ | 雄伟的褶皱山脉与火山弧高地 |
| **分离张裂（Divergent）** | 大洋内部 | $12\theta_6$ | 洋底抬升 | 隆起的大洋中脊裂谷 |
| **聚合俯冲（Convergent）** | 仅俯冲下盘洋壳 | $8\theta_6$ | 洋底下沉 | 陡峭深邃的大洋海沟（如马里亚纳海沟） |
| **大陆裂谷（Divergent）** | 陆上分离边界 | $10\theta_6$ | $620\sim900\text{m}$ 下沉 | 狭长裂谷与潜在内海通道 |
| **转换断层（Transform）** | 陆上走滑边界 | $6\theta_6$ | 噪声调制的正负起伏 | 断层谷、错断山脊与线性破碎带 |

大陆壳还根据 `regionCrustThicknessKm` 获得简化的地壳均衡抬升：相对 $27\text{km}$ 基准厚度，每增加 $1\text{km}$ 地壳厚度约增加 $24\text{m}$ 的区域性基底高程。该项用于表达克拉通与微陆块的宽缓高地，不替代边界应力造成的狭长造山带。

---

## 4. 3D 连续分形噪声 (FBM)

二维平面地图若直接采样 2D 噪声，会在两极和经度切口产生剧烈畸变与断裂。

系统在三维单位球面坐标 $\mathbf{P} = (x, y, z)$ 上采样 **3D Simplex 连续噪声**，实现全局各向同性、无缝衔接的分形布朗运动（FBM）：

$$\operatorname{FBM}(x, y, z) = \sum_{k=0}^{O-1} \frac{1}{2^k} \operatorname{Noise3D}(2^k f x, \, 2^k f y, \, 2^k f z)$$

- **陆地噪声振幅**：受内陆距离调制 $\Delta h = \operatorname{FBM} \cdot \text{noiseStrength} \cdot (0.035 + 0.045 \cdot \text{inland})$，使得沿海海岸微波起伏，内陆山丘纵横交错；
- **海底噪声振幅**：模拟深海丘陵与海山链。

---

## 5. 岛屿地貌与演化侵蚀高程调制

与主体大陆不同，岛屿的高程起伏受其地质成因类型与地质年龄共同制约：

```python
# 岛屿微观地形起伏计算伪代码
function GetIslandRelief(islandType, islandAge, noise):
    positiveNoise = max(0, noise)
    if islandType == VolcanicArc:
        # 陡峭火山锥，侵蚀速率较缓
        return (0.055 + positiveNoise * 0.025) * (1.0 - islandAge * 0.38)
    elif islandType == HotspotChain:
        # 初生热点高耸，尾端老岛受海水强侵蚀与下沉 (衰减达 78%)
        return (0.070 + positiveNoise * 0.035) * (1.0 - islandAge * 0.78)
    elif islandType == ContinentalFragment:
        # 大陆碎片残丘，地形稳定
        return 0.018 + positiveNoise * 0.018
    elif islandType == Scattered:
        return 0.012 * (1.0 - islandAge * 0.55)
    return 0.0
```

热点岛链另有 $1250\cdot\text{Age}^{1.6}$ 米的年龄沉降项；火山岛弧与散落岛也施加较弱沉降。由于海陆仍由最终物理高程的面积分位海平面统一判定，衰老岛屿可以自然被淹没，而不是始终被候选 `landMask` 强制保留为陆地。

---

## 6. 面积守恒的侵蚀与沉积

构造高程和分形噪声合成后、海平面判定前，系统执行固定次数的地貌松弛。该阶段只移动物质，不改变球面面积加权的全球岩石体积：

$$
\sum_r A_r h_r^{\text{before}}=\sum_r A_r h_r^{\text{after}}
$$

### 6.1 坡面热侵蚀

对每条球面共享边比较两端高差。当高差超过由边角长度决定的休止坡阈值时，从高处移出有限厚度，并按两端真实球面单元面积换算后沉积到低处。同步 `delta` 数组避免遍历顺序影响结果；当前执行两轮，每条边每轮转移不超过 $55\text{m}$ 等效厚度。

### 6.2 径流代理侵蚀与沉积输运

在尚未生成完整气候之前，使用纬度雨带构造确定性的径流代理场，按最陡下降邻居建立无环临时流向。流量由高到低累积，河流功率随汇水面积和坡降增加：

$$
E\propto\log(1+Q)\sqrt{\frac{\nabla h}{30000}}
$$

侵蚀物沿临时流向继续输运：低坡、低输运能力区域沉积一部分，其余进入下游；到达海洋的剩余物全部沉积在近岸单元，形成冲积平原、三角洲基底与陆架沉积楔。该过程执行两轮，并将单单元侵蚀限制在每轮 $42\text{m}$ 内，避免高分辨率下数值失稳。

这一阶段使用代理径流而非最终气候径流，避免形成“高程 → 气候 → 侵蚀 → 高程”的昂贵闭环；正式河湖水文仍在最终高程确定后计算。

---

## 7. 单一物理高程源与双视图映射

在游戏与模拟系统中，“用于渲染的地形高度”与“用于物理气象模拟的真实海拔”往往存在矛盾：
- 若直接按真实地球比例渲染（地球半径 $6371\text{km}$，珠峰仅 $8.8\text{km}$，相对比例仅 $0.14\%$），在 3D 视图中大陆与山脉几乎完全平坦，缺乏视觉表现力；
- 若为了 3D 视觉而将陆地大幅隆起，气象计算若直接采用该高程，会导致全球大陆全部变成几千米高的极寒高原。

系统只合成一次以米为单位的权威物理地形，再从它派生渲染和气候视图：

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                  单一物理高程源 Single Physical Source                     │
 └──────────────────────┬───────────────────────────────┬──────────────────────┘
                        │ 面积加权海平面                │
                        ▼                               ▼
       ┌─────────────────────────────────┐ ┌──────────────────────────────────┐
       │ renderElevation（单调视觉映射） │ │ climateElevationMeters（截断视图）│
       │   - 范围: [0.0, 1.0]            │ │ - 范围: [0, 6000 米]             │
       │   - 海平面: 0.20                │ │ - 宽缓的大陆基底: 100~550米       │
       │   - 大陆显著隆起，山体夸张      │ │ - 构造山脉真实隆升: 0~4500米     │
       │   - 服务于: 3D 网格着色与等高线 │ │ - 服务于: 气温垂直递减与迎风降水 │
       └─────────────────────────────────┘ └──────────────────────────────────┘
```

### 物理高程与海平面伪代码

```python
rawPhysicalLand = continentalBase + crustalLift + terrainNoise + overridingUplift + islandRelief - islandSubsidence
rawPhysicalOcean = -(basinShape + thermalSubsidence + activity * subductingTrench - activity * ridgeUplift + seafloorNoise)
evolvedPhysical = ConservativeErosionAndDeposition(rawPhysical)
seaLevel = AreaWeightedQuantile(evolvedPhysical, 1 - landCoverage)
physicalElevationMeters = evolvedPhysical - seaLevel
landMask = physicalElevationMeters >= 0
climateElevationMeters = landMask ? clamp(physicalElevationMeters, 0, 6000) : 0
renderElevation = MonotonicVisualMap(physicalElevationMeters, SEA_LEVEL)
```

其中 `activity` 来自构造边界段的连续地貌表达包络。它作为海洋边界源的初始幅度进入对数距离传播，因此弱活动段会同时变矮、变窄，强活动段则保持清晰轴线；这一过程不会对最终高程场进行空间模糊。

- **广阔平原**：真实物理海拔维持在 $100 \sim 550\text{m}$，保证适宜的温带气温与充沛降水；
- **山岳地带**：通过造山应力映射为 $2000 \sim 5500\text{m}$ 的极高峰峦，精准触发雪线、高山苔原与雨影效应。
