# 第 7 章 · 三圈环流、水汽输送与季节性气候

气候系统是连接地形、水文与生态的纽带。本章深入剖析奇幻地图生成器中的气象动力学模型：包括大气三圈环流盛行风带、纬度太阳辐射与地形垂直递减率温度场、12 个月季节循环动态、水汽蒸发与平流图输送、地形抬升雨、雨影效应以及地表径流平衡。

实现中温度采样 12 个月，水汽和径流采样 4 个代表季节。地形雨使用米制高程差与物理距离；不等面积单元的水汽输送按面积比转换密度。模型近似和可配置降水校准见[实现记录](../generation-optimization.md)。

---

## 1. 行星风系与三圈环流模型 (Atmospheric Circulation)

由于赤道与两极受热不均，加上自转地转偏向力，地球大气形成了经典的三圈环流系统：

```text
 极点 90°N ─────────── 极地高气压带 (Polar High) ─────► 寒冷下沉
               极地东风带 (Polar Easterlies) ◄──── 偏东风
      60°N ─────────── 副极地低气压带 (Subpolar Low) ──► 气旋上升 / 锋面雨
               盛行西风带 (Westerlies) ───────► 强劲偏西风
      30°N ─────────── 副热带高气压带 (Subtropical High) ► 干燥下沉 / 荒漠带
               东北信风带 (Trade Winds) ◄───── 偏东风
  赤道 0°  ─────────── 赤道低气压带 (ITCZ) ──────────► 强对流上升 / 热带雨林
               东南信风带 (Trade Winds) ◄───── 偏东风
      30°S ─────────── 副热带高气压带 (Subtropical High) ► 干燥下沉 / 荒漠带
               盛行西风带 (Westerlies) ───────► 强劲偏西风
      60°S ─────────── 副极地低气压带 (Subpolar Low) ──► 气旋上升
               极地东风带 (Polar Easterlies) ◄──── 偏东风
 极点 90°S ─────────── 极地高气压带 (Polar High) ─────► 寒冷下沉
```

### 1.1 切向风矢量计算
风矢量由纬向分量（Zonal Wind, 东西风）与经向分量（Meridional Wind, 南北风）在球面切空间正交合成：

$$\mathbf{v}_{\text{wind}}(\mathbf{P}) = u_{\text{zonal}} \mathbf{e}_{\text{east}} + v_{\text{meridional}} \mathbf{e}_{\text{north}}$$

```python
# 纬向风与经向风分量计算伪代码 (依据纬度带平滑阶梯过渡)
function ComputeWindComponents(latitude):
    absLat = abs(latitude)
    if absLat < 30°:
        # 信风带：强偏东风 (负 zonal) + 向赤道辐合
        zonal = -0.75 * cos(absLat * PI / 30°)
        meridional = -sign(latitude) * 0.28
    elif absLat < 60°:
        # 西风带：强偏西风 (正 zonal) + 向极地吹送
        zonal = 1.0 * sin((absLat - 30°) * PI / 30°)
        meridional = sign(latitude) * 0.35
    else:
        # 极地东风带：偏东风 (负 zonal)
        zonal = -0.55 * cos((absLat - 60°) * PI / 30°)
        meridional = -sign(latitude) * 0.15
        
    return (zonal, meridional)
```

---

## 2. 气温场与热力学模型

### 2.1 纬度辐射基准温（Latitude Baseline）
纯辐射平衡下的地表温度随纬度余弦变化：

$$T_{\text{lat}}(\phi) = 30.0 \cdot \cos^{0.95}(\phi) - 15.0$$

- 赤道基准温：$+30.0^\circ\text{C}$；
- 极地基准温：$-15.0^\circ\text{C}$。

### 2.2 大陆度年较差调制（Continentality Effect）
水的热容远大于陆地岩石土壤。系统利用海岸距离衍生的大陆度标量 $C \in [0, 1]$ 调节气温年较差：

$$\text{Continentality}(r) = \operatorname{smoothstep}(0.08, \, 0.82, \, \text{inland})$$

- **海洋/近海（$C \to 0$）**：海洋性气候，冬暖夏凉，年较差小；
- **内陆深处（$C \to 1$）**：大陆性气候，冬极冷夏极热，年较差可达 $40^\circ\text{C} \sim 60^\circ\text{C}$。

### 2.3 环境温度垂直递减率（Atmospheric Lapse Rate）
真实大气对流层温度随海拔升高而降低。系统采用真实气象学常数：

$$\Gamma = 6.5^\circ\text{C} / 1000\text{m}$$

$$\Delta T_{\text{altitude}} = -6.5 \cdot \left(\frac{\text{climateElevationMeters}}{1000}\right)$$

海拔 $3000\text{m}$ 的高原山脉相比海平面常年降温近 $20^\circ\text{C}$，形成终年积雪与高山苔原。

---

## 3. 12 个月季节性循环与黄赤交角

由于行星自转轴存在倾角（地球黄赤交角 $\epsilon = 23.44^\circ$），太阳直射点在南北回归线之间呈正弦往返移动：

$$\delta_{\text{sun}}(t) = 23.44^\circ \cdot \sin\left(\frac{2\pi (t - 80)}{365}\right), \quad t \in [0, 11] \text{ 月份}$$

```mermaid
flowchart LR
    A[太阳直射点纬度偏移 delta] --> B[气压带与盛行风带南北平移 0.55 × delta]
    A --> C[计算各月正午太阳高度角]
    B & C --> D[逐月生成 12 个月温度、风场与水汽]
    D --> E[提取最热月、最冷月与季节降水偏度]
```

---

## 4. 水汽动力学、降水与雨影效应

系统通过 **风向加权的有向图平流算法** 模拟水汽从海洋向大陆的输送与降水转化：

```text
  海洋蒸发水汽 ──► 盛行风吹向大陆 ──► 遇山地迎风坡抬升 (Orographic Lift) ──► 丰沛地形雨
                                                                           │
                                           背风坡下沉干热 (Rain Shadow) ◄──┘
                                           形成温带/热带雨影荒漠
```

### 4.1 海洋蒸发（Evaporation）
海洋单元作为水汽源头，蒸发量由海温与风速共同决定：

$$E_{\text{ocean}} = E_0 \cdot \exp(0.045 \cdot T_{\text{SST}})$$

### 4.2 图平流输送（Advection Transport）
水汽沿风向向下游邻近单元传播。对于单元 $i$ 和下游邻居 $j$，输送权重取决于两单元连线与风矢量的夹角余弦：

$$\text{Weight}_{ij} = \max\left(0, \, \mathbf{v}_{\text{wind}}(i) \cdot \frac{\mathbf{P}_j - \mathbf{P}_i}{\|\mathbf{P}_j - \mathbf{P}_i\|}\right)$$

### 4.3 地形抬升降水与雨影效应（Orographic Precipitation & Rain Shadow）
当湿润气流沿坡度上升时（$\Delta h = h_j - h_i > 0$），气温骤降水汽凝结，触发强烈地形雨：

$$\text{OrographicFraction} = \operatorname{clamp}\left(\frac{\Delta h}{\Delta L} \cdot \text{scale}, \, 0, \, 0.72\right)$$

- **迎风坡**：最高可截留脱除 $72\%$ 的过境水汽，形成暴雨中心；
- **背风坡（$\Delta h < 0$）**：空气下沉绝热增温，降水几率归零，水汽耗尽后在山脉背风侧形成绵延数千公里的雨影沙漠（如巴塔哥尼亚沙漠、大盆地沙漠）。

### 4.4 降水量锚定与归一化
默认通过分位数映射（Quantile Mapping）将相对降水率转换为以 $\text{mm/year}$ 表示的经验降水量。`precipitationCalibration=1` 保留下述锚定，0 使用固定倍率换算，中间值线性混合。单位为毫米不代表经过观测标定：

| 分位数指标 | 物理降水量锚定值 | 对应的典型气候带 |
| :--- | :---: | :--- |
| **中位数（P50）** | $700\text{ mm}$ | 温带落叶林、半湿润农业带 |
| **P90 湿润带** | $1,800\text{ mm}$ | 亚热带季风区、常绿阔叶林 |
| **P98 极湿带** | $3,200\text{ mm}$ | 赤道热带雨林、迎风坡雨极 |
| **干旱极值** | $< 150\text{ mm}$ | 极端热荒漠与极地荒漠 |

---

## 5. 水量平衡：潜在蒸散量 (PET) 与地表有效径流 (Runoff)

陆地降水并非全部流入河流，一部分被地表植被与土壤蒸发消耗。

```text
 地表降水 Precipitation
        │
        ├──► 潜在蒸散损失 PET (由气温决定)
        │
        └──► 地表有效径流 Runoff (汇入下游江河湖泊)
```

$$\text{PET} = 0.015 \cdot \max(0, \, T_{\text{annual}} + 5.0)^{1.45}$$

$$\text{Runoff} = \max(0, \, \text{Precipitation} - \text{PET})$$

地表有效径流 `runoff` 数组是下游河网汇流计算（`RiverGenerator`）与湖泊水平衡（`LakeGenerator`）的直接物理驱动源。
