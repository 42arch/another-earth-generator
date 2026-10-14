# 另一个地球生成器：过程化世界生成模型说明书

本文档系统阐述虚拟星球生成流水线中的地理物理与人文社会生成模型。文档侧重于**机制解释、物理近似原理、计算公式与高层伪代码**，旨在解释各个阶段“如何建模、为何做此近似”，不涉及具体的源码文件路径、行号或特定语言实现细节。

---

## 目录

- [前言：公用几何底座与空间离散](#前言公用几何底座与空间离散)
  - [1. 球面流形与 Voronoi 胞元](#1-球面流形与-voronoi-胞元)
  - [2. 双尺度参考网格与映射机制](#2-双尺度参考网格与映射机制)
  - [3. 确定性随机与空间连续噪声](#3-确定性随机与空间连续噪声)
- [第一篇：自然地理生成模型](#第一篇自然地理生成模型)
  - [第 1 阶段：球面网格构建 (MeshStage)](#第-1-阶段球面网格构建-meshstage)
  - [第 2 阶段：板块初始划分与拓扑聚类 (PlateStage)](#第-2-阶段板块初始划分与拓扑聚类-platestage)
  - [第 3 阶段：大陆地壳成核与板块属性赋予 (ContinentalCrustStage)](#第-3-阶段大陆地壳成核与板块属性赋予-continentalcruststage)
  - [第 4 阶段：欧拉旋转动力学与地幔流代理场 (SuperPlateStage)](#第-4-阶段欧拉旋转动力学与地幔流代理场-superplatestage)
  - [第 5 阶段：双尺度构造投影与边界运动学分类 (ProjectionStage)](#第-5-阶段双尺度构造投影与边界运动学分类-projectionstage)
  - [第 6 阶段：地幔驱动构造塑形与隆升骨架 (TectonicStage)](#第-6-阶段地幔驱动构造塑形与隆升骨架-tectonicstage)
  - [第 7 阶段：地貌纹理合成、相量山脊与侵蚀塑形 (TerrainStage)](#第-7-阶段地貌纹理合成相量山脊与侵蚀塑形-terrainstage)
  - [第 8 阶段：季节太阳辐射与风生大洋环流 (SeasonalCirculationStage)](#第-8-阶段季节太阳辐射与风生大洋环流-seasonalcirculationstage)
  - [第 9 阶段：逐月热力学平衡与气团水汽平流输送 (MonthlyClimateStage)](#第-9-阶段逐月热力学平衡与气团水汽平流输送-monthlyclimatestage)
  - [第 10 阶段：气候降尺度投影与降水通量守恒 (ClimateOutputStage)](#第-10-阶段气候降尺度投影与降水通量守恒-climateoutputstage)
  - [第 11 阶段：柯本气候体系经验分类 (KoppenClimateStage)](#第-11-阶段柯本气候体系经验分类-koppenclimatestage)
  - [第 12 阶段：Whittaker 生态群系与物候指标 (BiomeStage)](#第-12-阶段whittaker-生态群系与物候指标-biomestage)
  - [第 13 阶段：地表水平衡、Priority-Flood 汇流与河网等级 (SurfaceHydrologyStage)](#第-13-阶段地表水平衡priority-flood-汇流与河网等级-surfacehydrologystage)
- [第二篇：人文社会系统模型](#第二篇人文社会系统模型)
  - [第 14 阶段：综合环境宜居度与聚落等级集聚 (PopulationStage)](#第-14-阶段综合环境宜居度与聚落等级集聚-populationstage)
  - [第 15 阶段：阻力地表、生成树路网与沿海航运 (TransportStage)](#第-15-阶段阻力地表生成树路网与沿海航运-transportstage)
  - [第 16 阶段：民族发生核、文化空间漂移与多元构成 (EthnicityStage)](#第-16-阶段民族发生核文化空间漂移与多元构成-ethnicitystage)
  - [第 17 阶段：地缘权力投影、疆域协商与行政区划 (PolityStage)](#第-17-阶段地缘权力投影疆域协商与行政区划-politystage)
  - [第 18 阶段：信仰起源扩散、圣地网络与国家庇护 (ReligionStage)](#第-18-阶段信仰起源扩散圣地网络与国家庇护-religionstage)

---

## 前言：公用几何底座与空间离散

在进入具体物理和人文模型推演前，必须首先确立计算所依托的空间离散结构。真实地球表面是一个连续的闭合二维球面流形，任何基于经纬度四边形网格（Equirectangular Grid）的模型都会在两极遭遇极点奇异性（面积趋近于零、经向线收敛）。

### 1. 球面流形与 Voronoi 胞元

本系统采用**正二十面体细分球面网格（Icosphere）**与其**对偶球面 Voronoi 镶嵌**：
1. **顶点与胞元**：以正二十面体为基础，对每个正三角形面进行多级测地细分（每级边长折半，新顶点归一化投影到单位球面上）。细分后的每个顶点代表一个离散的地理“区域中心”（Region Centre）。
2. **对偶面积与邻接拓扑**：利用球面德劳内三角化（Delaunay Triangulation）的对偶——球面 Voronoi 图，确定每个区域的多边形边界。每个胞元拥有一组无方向歧义的邻居集合（除最初的 12 个五边形顶点外，绝大多数胞元均为六边形）。
3. **空间度量**：每个胞元在单位球面上具有确定的面积权重 $Area_{unit}$，全球面总面积恒等于 $4\pi$。当赋予星球物理半径 $R_{planet}$（标准地球为 $6,371\text{ km}$）时，实际物理面积为：
   $$\text{Area}_{km^2} = \text{Area}_{unit} \times R_{planet}^2$$

### 2. 双尺度参考网格与映射机制

过程化生成面临两难：宏观地理现象（如超大陆漂移、大洋环流回旋）需要大范围的连续性，而高分辨率网格（如 16 万甚至 65 万区域）若直接参与计算量为 $O(N^2)$ 或多轮迭代扩散的阶段，计算开销与内存暴增。

系统为此建立了**双尺度空间体系**：
- **固定参考网格（Reference Mesh）**：固定为 6 级细分（40,962 个胞元）。板块欧拉旋转动力学、地幔热柱生成、季节风带与大洋环流均在此尺度求解，保证无论玩家选择何种输出细节，宏观大陆轮廓与全球季风格局保持稳定。
- **动态输出网格（Output Mesh）**：由生成配置决定分辨率（例如 7 级细分 163,842 区域）。高频微地形、局部侵蚀、高分辨率河网、聚落分布在此尺度计算。
- **空间扰动映射（Perturbed Mapping）**：当将高分辨率输出网格的区域 $r$ 映射到参考网格时，不是简单查找最近邻参考胞元，而是在三维空间坐标上叠加多频域分形噪声扰动：
  $$\vec{P}_{perturbed} = \text{Normalize}(\vec{P}_r + \text{WarpAmplitude} \times \vec{\text{Noise}}(\vec{P}_r))$$
  通过在参考网格上查找距离 $\vec{P}_{perturbed}$ 最近的参考胞元，天然消除了细分多边形边界的网格走样伪影，为海岸线和山脉带来分形边缘。

### 3. 确定性随机与空间连续噪声

所有阶段均遵循**严格的确定性原则**：
- 采用由基础种子（Seed）衍生出的独立伪随机序列（PRNG），确保在任意平台上重复生成均输出完全相同的数值。
- 球面上的连续随机特征均采用**三维球面空间噪声（3D Simplex Noise）**。通过输入区域的三维单位球面直角坐标 $(x, y, z)$ 采样，避免了平面噪声投影到球面上时的极点拉伸或接缝截断。

---

## 第一篇：自然地理生成模型

---

### 第 1 阶段：球面网格构建 (MeshStage)

#### 1.1 机制原理
该阶段根据设定的细分等级构建输出网格与参考网格。在标准球面上，各胞元具有高度均一的几何形态。为了避免自然地貌呈现过分规则的几何晶格感，模型在构建几何后引入了轻微的切向随机扰动：
$$\vec{P}'_r = \text{Normalize}(\vec{P}_r + \text{Jitter} \times \vec{V}_{tangent})$$
同时预计算每个区域的三维直角坐标、地理经纬度弧度值、胞元单位球面面积，以及区域间的角距离与切向单位位移矢量，建立高效的拓扑邻接图。

#### 1.2 伪代码
```text
function BuildSphericalMesh(detailLevel, irregularity):
    baseIcosahedron = CreateRegularIcosahedron()
    vertices, triangles = SubdivideTriangles(baseIcosahedron, detailLevel)
    ProjectToUnitSphere(vertices)
    
    if irregularity > 0:
        for each vertex in vertices:
            tangent = ComputeRandomTangentVector(vertex)
            vertex = Normalize(vertex + tangent * irregularity * AverageEdgeLength)
            
    voronoiCells = ComputeSphericalVoronoi(vertices)
    neighborGraph = BuildAdjacencyGraph(voronoiCells)
    
    return Mesh(vertices, voronoiCells, neighborGraph)
```

---

### 第 2 阶段：板块初始划分与拓扑聚类 (PlateStage)

#### 2.1 机制原理
地球岩石圈由大小不一的板块拼合而成，呈现分形大小分布（少数几个巨大的主板块与若干中微型碎板块共存）。直接随机散布板块种子容易导致板块面积过于均质。

模型采用**两级层次化聚类策略**：
1. **参考过分割（Over-segmentation）**：首先在参考网格上均匀布置 100 个初始分区种子，通过多源广度优先扩散（BFS）将全球划分为 100 个紧凑的基础地质切片。
2. **板块凝聚聚类（Plate Agglomeration）**：
   - 依据配置指定 $N_{major}$ 个主板块和 $N_{micro}$ 个微板块。
   - 选取互不相邻且距离充分分散的区域作为主板块生长核，将剩余的基础切片依据图连通度与距离归并入最近的主板块。
   - 在主板块边界交汇的应力集中区（缝合带与三联点），按概率保留部分小切片作为独立的微板块。

这种方法既确保了各大板块具有自然的咬合边缘与几何拓扑，又复现了真实地球中“太平洋板块”与“菲律宾海微板块”共存的异质尺度结构。

#### 2.2 伪代码
```text
function GenerateTectonicPlates(mesh, numMajor, numMicro, seed):
    // 1. 生成 100 个基础参考多边形
    subdivisionSeeds = PickPoissonSpacedPoints(mesh, 100, seed)
    basePatches = MultiSourceFloodFill(mesh, subdivisionSeeds)
    patchGraph = BuildPatchAdjacency(basePatches)
    
    // 2. 选定主板块核心并扩张
    majorCores = SelectDistantPatches(patchGraph, numMajor, seed + 1)
    plates = InitializePlates(majorCores)
    ExpandPlatesToFill(patchGraph, plates)
    
    // 3. 在交界处孕育微板块
    boundaryPatches = FindBoundaryPatches(patchGraph, plates)
    microSeeds = SampleSubset(boundaryPatches, numMicro, seed + 2)
    CarveMicroPlates(plates, microSeeds)
    
    return plates
```

---

### 第 3 阶段：大陆地壳成核与板块属性赋予 (ContinentalCrustStage)

#### 3.1 机制原理
岩石圈板块并不直接等同于大陆。一个板块可以同时承载密度较低、厚度较大的**大陆硅铝质地壳**（轻而浮）与较薄、高密度的**大洋硅镁质地壳**（重而沉）。

1. **大陆核心沉淀**：
   - 模型在参考划分上根据目标大陆覆盖率 $TargetCoverage$ 播撒陆核种子。
   - 采用带偏置的随机游走扩散法进行陆壳增生，优先沿同一板块内部扩展，但允许超大陆横跨板块边界（模拟类似泛大陆 Pangea 跨越多个古板块的地质构型）。
2. **地壳属性赋予**：
   - 为每个区域赋予连续的大陆地壳亲和度标量：完全大洋为 0，完全陆心克拉通为 1。
   - 赋予地壳年龄与基底刚度：陆核中心形成年代久远、基底坚硬；边缘被动大陆架与裂谷带基底较弱。

#### 3.2 核心工程公式
$$\text{CrustThickness} = \text{OceanicThickness} \times (1 - C) + \text{ContinentalThickness} \times C + \text{Noise}_{crust}$$
$$\text{IsContinentCore} = \text{DistanceToContinentalMargin} > \text{CratonMarginThreshold}$$

#### 3.3 伪代码
```text
function GrowContinentalCrust(mesh, plates, targetLandRatio, seed):
    crustThickness = InitializeArray(mesh.numRegions, OCEANIC_CRUST_THICKNESS)
    landSeeds = SelectContinentalCores(plates, seed)
    
    currentLandCells = 0
    totalTargetCells = mesh.numRegions * targetLandRatio
    
    priorityQueue = InitializePriorityQueue()
    for seed in landSeeds:
        priorityQueue.Push(seed, priority = 1.0)
        
    while currentLandCells < totalTargetCells and not priorityQueue.Empty():
        curr = priorityQueue.Pop()
        if crustThickness[curr] >= CONTINENTAL_CRUST_THICKNESS:
            continue
        crustThickness[curr] = CONTINENTAL_CRUST_THICKNESS
        currentLandCells++
        
        for neighbor in mesh.GetNeighbors(curr):
            // 板块内部扩散阻力低，跨板块边界扩散阻力高
            barrier = (plates[curr] == plates[neighbor]) ? 1.0 : 0.3
            noiseFactor = 0.8 + 0.4 * SimplexNoise3D(neighbor)
            priorityQueue.Push(neighbor, priority = barrier * noiseFactor)
            
    return ComputeCrustAgeAndRigidity(mesh, crustThickness)
```

---

### 第 4 阶段：欧拉旋转动力学与地幔流代理场 (SuperPlateStage)

#### 4.1 机制原理
在球面上，刚体板块的任何位移都可以精确描述为绕通过球心的某一特定空间轴（欧拉极，Euler Pole）的**定轴旋转**。

1. **板块欧拉向量赋予**：
   - 为每个独立运动板块分配一个三维欧拉角速度向量 $\vec{\omega}_i$。其方向定义了欧拉极的球面出射点，模长 $\|\vec{\omega}_i\|$ 代表该板块的旋转角速度（厘米/年或模型相对角速率）。
2. **表面线速度场计算**：
   - 板块上任意点 $\vec{P}$（从球心指向地表的单位位置向量）的瞬时绝对运动线速度矢量 $\vec{v}$ 为外积：
     $$\vec{V}_{abs}(\vec{P}) = \vec{\omega}_i \times \vec{P}$$
3. **地幔对流代理场（Mantle Convection Proxy）**：
   - 板块运动受到深部地幔热对流的拖拽。模型通过低频大尺度调和球面函数构建全板块下方的地幔上升流（热柱，对应洋中脊与裂谷）与地幔下降流（冷俯冲汇聚流）。

#### 4.2 伪代码
```text
function ComputePlateDynamics(plates, seed):
    for each plate in plates:
        eulerPole = RandomUnitSphereVector(seed + plate.id)
        angularVelocityMagnitude = RandomRange(0.01, 0.05)
        plate.omega = eulerPole * angularVelocityMagnitude
        
    mantlePlumes = GenerateSphericalHarmonicsFields(degree = 4, seed)
    
    return plateDynamics, mantlePlumes
```

---

### 第 5 阶段：双尺度构造投影与边界运动学分类 (ProjectionStage)

#### 5.1 机制原理
此阶段将参考网格求解的大尺度板块拓扑与线速度矢量场，通过**扰动投影机制**下采样映射至高分辨率输出网格。

在输出网格上，模型通过分析每对相邻区域跨板块界线处的**相对运动速度差**，对每一个边界进行严格的运动学类型分类：
$$\Delta \vec{V} = \vec{V}_A - \vec{V}_B$$
令 $\vec{N}_{AB}$ 为由胞元 $B$ 指向胞元 $A$ 的界面法向单位向量，$\vec{T}_{AB}$ 为沿界面走向的切向单位向量：
1. **法向相对运动分量（辐聚 vs 辐散）**：
   $$\text{NormalMotion} = \Delta \vec{V} \cdot \vec{N}_{AB}$$
   - 若 $\text{NormalMotion} < -\epsilon$：两板块迎头挤压，判定为**汇聚消减型边界（Convergent Boundary）**。
   - 若 $\text{NormalMotion} > +\epsilon$：两板块互相背离，判定为**离散张裂型边界（Divergent Boundary）**。
2. **切向相对运动分量（走滑转换）**：
   $$\text{ShearMotion} = |\Delta \vec{V} \cdot \vec{T}_{AB}|$$
   - 若法向分量微弱而切向分量显著，判定为**走滑/转换断层（Transform Fault）**。

结合边界两侧的地壳性质（陆地 vs 大洋），进一步细分为：**大洋中脊、大陆裂谷、大洋俯冲带（海沟-岛弧系）、大陆碰撞带（喜马拉雅型造山带）**。

#### 5.2 伪代码
```text
function ProjectAndClassifyBoundaries(outputMesh, refPlates, perturbationMap):
    outputPlates = new Array(outputMesh.numRegions)
    
    // 1. 扰动映射到高分辨率网格
    for r = 0 to outputMesh.numRegions - 1:
        refRegion = perturbationMap[r]
        outputPlates[r] = refPlates.GetPlateAt(refRegion)
        
    // 2. 邻域差异计算与分类
    boundaries = []
    for each edge (rA, rB) in outputMesh.edges:
        if outputPlates[rA] != outputPlates[rB]:
            vA = CrossProduct(outputPlates[rA].omega, outputMesh.pos[rA])
            vB = CrossProduct(outputPlates[rB].omega, outputMesh.pos[rB])
            deltaV = vA - vB
            normal = Normalize(outputMesh.pos[rA] - outputMesh.pos[rB])
            
            convergence = -DotProduct(deltaV, normal)
            crustA = GetCrustType(rA)
            crustB = GetCrustType(rB)
            
            boundaryType = ClassifyBoundary(convergence, crustA, crustB)
            boundaries.Append(edge, boundaryType, intensity = Length(deltaV))
            
    return boundaries
```

---

### 第 6 阶段：地幔驱动构造塑形与隆升骨架 (TectonicStage)

#### 6.1 机制原理
构造高程是宏观山脉和深海沟形成的直接驱动力。该阶段建立一个**距离场与挤压应力调和模型**，计算全球地壳一阶构造骨架：

1. **碰撞隆升模型（Orogenic Uplift）**：
   在汇聚大陆边缘，抬升高度正比于相对碰撞速度与离边界距离的高斯衰减：
   $$\text{Uplift}_{collision} = \text{Intensity} \times \exp\left(-\frac{\text{DistToBoundary}^2}{2 \times \sigma_{orogeny}^2}\right)$$
   俯冲板块下插形成海沟（负高程洼陷），上覆板块前端强烈隆升并伴随弧后盆地轻微下沉。
2. **洋中脊与裂谷模型（Rifting & Mid-Ocean Ridges）**：
   离散边界处，热地幔物质上涌冷却形成对称隆起的大洋中脊，沿轴线形成狭窄的裂谷下陷（Rift Valley）：
   $$\text{Elevation}_{ridge} = \text{RidgeHeight} \times \exp\left(-\frac{\text{DistToAxis}}{\lambda_{ridge}}\right) - \text{AxialRiftDrop}$$
3. **地幔柱与热点火山链（Mantle Plumes & Hotspots）**：
   深层地幔热柱在岩石圈底部形成局部的点状圆顶隆起；当移动板块扫过固定的热点上方时，在板块表面切出链状的线性火山群岛（如夏威夷群岛轨迹）。

#### 6.2 伪代码
```text
function ComputeTectonicSkeleton(mesh, boundaries, mantlePlumes):
    skeletonElevation = InitializeArray(mesh.numRegions)
    
    // 多源测地距离变换
    distToBoundary, nearestBoundary = ComputeGeodesicDistances(mesh, boundaries)
    
    for r = 0 to mesh.numRegions - 1:
        bType = nearestBoundary[r].type
        d = distToBoundary[r]
        speed = nearestBoundary[r].intensity
        
        case bType of:
            ContinentalCollision:
                skeletonElevation[r] += speed * Gaussian(d, width = 450km)
            OceanicSubduction:
                if IsOverridingPlate(r):
                    skeletonElevation[r] += speed * AsymmetricArcProfile(d)
                else:
                    skeletonElevation[r] -= speed * DeepTrenchProfile(d)
            OceanicDivergence:
                skeletonElevation[r] += MidOceanRidgeProfile(d)
            ContinentalRift:
                skeletonElevation[r] += RiftGrabenProfile(d)
                
        // 叠加地幔上涌与下沉场
        skeletonElevation[r] += mantlePlumes.GetScalar(mesh.pos[r]) * MANTLE_UPLIFT_GAIN
        
    return skeletonElevation
```

---

### 第 7 阶段：地貌纹理合成、相量山脊与侵蚀塑形 (TerrainStage)

#### 7.1 机制原理
第 6 阶段得到的是光滑的地质宏观骨架，直接用于渲染会显得浑圆且失真。本阶段对其进行分形丰富、结构锐化与侵蚀近似：

1. **相量噪声山脉锐化（Phasor Noise Ridge Sharpening）**：
   传统的柏林噪声山脉方向杂乱无章。模型采用定向相量噪声（Phasor Noise），沿着板块构造边界走向布置高频定向波列：
   $$\text{RidgeModifier} = |\text{PhasorWave}(\vec{P}, \text{Direction}=\vec{T}_{boundary})|^{\gamma}$$
   利用指数变换 $(\gamma \approx 1.5 \sim 2.0)$ 制造出刀刃般锐利的平行褶皱山系（如安第斯山脉）。
2. **大陆架与坡折带成形（Continental Shelf & Slope）**：
   在陆地与深海过渡带，利用平滑阶跃函数构建典型的三段式边缘：
   - 浅海大陆架（坡度极平缓，水深 $0 \sim -200\text{ m}$）；
   - 大陆坡（陡峭下坠至 $-2,000 \sim -3,000\text{ m}$）；
   - 深海平原与远洋盆地（均质开阔平原）。
3. **多相侵蚀近似（Multi-phase Erosion Proxy）**：
   - **冰川侵蚀与冰斗刨蚀**：高纬度或高海拔极端寒冷区，削平尖锐峰顶，加宽谷底（U 型谷代理）。
   - **重力崩塌与坡面蠕动（Thermal/Slope Creep）**：局部坡度超过休止角（Angle of Repose）的岩石碎屑向邻域低地滚落平滑：
     $$\Delta H_r = K_{creep} \times \sum_{n \in Neighbors} (H_n - H_r)$$
   - **几何几何排水粗下切**：对构造洼地进行初步刻蚀，打通出海走廊。

最终，地表标量场被规范化转换为相对平均海平面的物理高程值 $Elevation_{km}$（海平面定义为 $0.0\text{ km}$）。

#### 7.2 伪代码
```text
function PostProcessTerrain(mesh, skeletonElevation, boundaries, seed):
    elevation = Copy(skeletonElevation)
    
    // 1. 沿造山走向调制相量山脊
    for r = 0 to mesh.numRegions - 1:
        if IsNearOrogenicBelt(r):
            trend = GetMountainTrendDirection(r, boundaries)
            ridgeNoise = EvaluatePhasorNoise(mesh.pos[r], trend, freq = 64)
            elevation[r] += SharpRidge(ridgeNoise) * GetUpliftStrength(r)
            
    // 2. 叠加多倍频三维球状分形分量
    elevation += FractalBrownianMotion3D(mesh.positions, octaves = 6) * 0.15
    
    // 3. 陆架阶跃成形
    for r = 0 to mesh.numRegions - 1:
        if elevation[r] < 0:
            elevation[r] = ApplyContinentalMarginProfile(elevation[r], distToCoast[r])
            
    // 4. 重力坡面蠕动平滑
    for iteration = 1 to 3:
        elevation = DiffuseSteepSlopes(mesh, elevation, maxAngle = 35 degrees)
        
    return elevation
```

---

### 第 8 阶段：季节太阳辐射与风生大洋环流 (SeasonalCirculationStage)

#### 8.1 机制原理
行星气候的原动力来自恒星辐射的纬度不均与行星自转公转轨道参数。
1. **地轴倾角与日照四季迁移**：
   设定地轴倾角 $\theta_{tilt}$（标准地球约为 $23.44^\circ$）。在四个典型季节锚点（春分、夏至、秋分、冬至），太阳直射纬度（赤纬 $\delta$）在 $[-\theta_{tilt}, +\theta_{tilt}]$ 之间周期正弦变动。
2. **热带辐合带（ITCZ）与三圈环流风带**：
   - 气压带与对流上升区并非固定在赤道，而是跟随太阳直射点发生季节南北移动，且陆地因热容量小，ITCZ 在陆地上的移动幅度远大于海洋（季风槽现象）。
   - 全球在经向划分为三大环流圈：信风带（低纬东风带）、西风带（中纬强风带）和极地东风带。
3. **风生大洋表层环流（Wind-Driven Ocean Gyres）**：
   - 海表风应力对海水产生切向拖拽；受科里奥利力（Coriolis Effect）偏转作用，北半球水流右偏、南半球左偏（埃克曼漂流原理）。
   - 水流遭遇大陆陆缘阻挡发生分流，从而在洋盆中形成巨大的闭合旋转大洋回旋（副热带反气旋式环流与副极地气旋式环流）。
   - **西边界强化机制**：受地球自转随纬度变化的 $\beta$ 效应制约，各大洋盆西侧的暖流狭窄而湍急（如墨西哥湾流、黑潮代理），洋盆东侧的寒流宽阔而平缓。模型直接计算洋流的相对热异常输运场。

#### 8.2 核心工程公式
$$\text{CoriolisParam}(Lat) = 2 \times \Omega \times \sin(Lat)$$
$$\text{WindEast} = \text{ZonalCirculation}(Lat - \text{ITCZ}) + \text{MonsoonThermalAnomaly}$$
$$\text{OceanCurrent} = \text{DiffuseAndDivertAgainstLand}(\text{WindDrag} \times \text{CoriolisDeflection})$$

#### 8.3 伪代码
```text
function ComputeSeasonalCirculation(mesh, landMask, axialTiltDeg):
    seasonalCirculation = []
    
    for season in [SpringEquinox, SummerSolstice, AutumnEquinox, WinterSolstice]:
        solarDeclination = axialTiltDeg * Sin(season.orbitalPhase)
        
        // 1. 计算 ITCZ 在每个经度上的位置（陆地上偏移更剧烈）
        itczLat = ComputeITCZPosition(solarDeclination, landMask)
        
        // 2. 计算东-北切平面风场
        windField = ComputeTriCellularWind(mesh, itczLat, season)
        
        // 3. 洋流积分：风应力注入 + 陆地阻挡偏转 + 闭合回旋松弛
        oceanCurrents = SimulateSurfaceOceanCurrents(mesh, windField, landMask, steps = 20)
        
        // 4. 提取洋流携带的热量异常（赤道向极地带去正温差，极地向赤道带去负温差）
        thermalAnomaly = ComputeCurrentTemperatureAdvection(oceanCurrents, mesh.latitude)
        
        seasonalCirculation.Append(windField, oceanCurrents, thermalAnomaly)
        
    return seasonalCirculation
```

---

### 第 9 阶段：逐月热力学平衡与气团水汽平流输送 (MonthlyClimateStage)

#### 9.1 机制原理
本阶段由 4 个季节锚点通过轨道相位正弦插值，依次求解 12 个独立自然月的气温与降水量。温度与降水高度互相关联，模型采用**温-湿多步交替修正**求解：

1. **气温控制方程**：
   - **纬度基础辐射温**：低纬温暖、极地寒冷，伴随极地高反射率冰雪阻尼。
   - **季节波动幅度（海陆性）**：深居大陆内部的区域，比热容极小，冬夏温差极端剧烈；海洋及受盛行洋风吹拂的沿海地区温差极度平缓：
     $$\text{AnnualRange} = \text{BaseRange} + \text{Continentality} \times K_{continent}$$
   - **垂直高程递减率（Lapse Rate）**：海拔每升高 $1,000\text{ m}$，气温下降约 $6.5^\circ\text{C}$。空气湿度越大，湿绝热递减率越小：
     $$\text{LapseRate} = 6.9 - 3.4 \times \text{RelativeMoisture} \quad (^\circ\text{C / km})$$
   - **洋流热平流影响**：暖流沿岸显著升温（如北大西洋暖流使西欧冬季温和），寒流沿岸降温增湿减雨。
2. **降水与水汽平流运移方程**：
   - **饱和水汽容量**：根据克劳修斯-克拉佩龙方程近似，饱和水汽压随气温呈指数上升。
   - **风场平流输送（Advection）**：气团从海洋吹过时吸收丰富水汽；随盛行风深入内陆，水汽随距离指数衰减（雨影区与大陆干旱中心）。
   - **动力对流抬升（ITCZ 降水）**：在低纬风场辐合带与赤道对流区，暖湿气流剧烈上升形成暴雨。
   - **地形雨与雨影效应（Orographic Precipitation）**：
     气流沿山坡上升时绝热冷却降温，水汽凝结形成迎风坡丰沛降水；越过山脊下沉绝热增温（焚风），在背风坡形成干旱雨影荒漠。

#### 9.2 伪代码
```text
function SolveMonthlyClimate(mesh, elevation, circulation, settings):
    for month = 0 to 11:
        forcing = InterpolateForcing(circulation, month)
        
        // 初步温度估计
        T = EstimateBaseTemperature(mesh, forcing)
        T -= GetLapseRate(moisture = 0.5) * Max(0, elevation)
        T += forcing.oceanThermalAnomaly * CoastDecayFactor(mesh)
        
        // 水汽输送与降水
        vaporSource = ComputeOceanEvaporation(T, mesh.landMask)
        moistureField = AdvectMoistureWithWind(mesh, vaporSource, forcing.wind)
        
        orographicLift = ComputeUpwindElevationGradient(mesh, elevation, forcing.wind)
        convergence = ComputeWindConvergence(mesh, forcing.wind)
        
        P = (moistureField * (orographicLift + convergence) + ConvectiveRain(T, forcing.itcz))
        P *= settings.precipitationScale
        
        // 云层与反照率对温度的二次反馈修正
        T -= ComputeCloudCooling(P)
        
        monthlyTemperature[month] = T
        monthlyPrecipitation[month] = P
        
    return monthlyTemperature, monthlyPrecipitation
```

---

### 第 10 阶段：气候降尺度投影与降水通量守恒 (ClimateOutputStage)

#### 10.1 机制原理
当输出网格分辨率高于气候网格时，需要进行空间重采样与插值。由于降水量直接决定后续水系的汇流排泄，简单的双线性插值会导致**全局水循环通量不守恒**，或者在高耸的微地形上遗漏局部地形抬升雨。

模型在此阶段执行两项关键操作：
1. **高程解耦温度插值**：
   插值时先恢复海平面基准温度（加上 $h_{ref} \times 6.5$），在海平面基准层进行平滑空间重采样，最后根据输出网格的局部高精度地形 $h_{out}$ 扣除实际高程递减。这样能够精准再现深切峡谷或孤立山峰的高保真局部气温。
2. **通量守恒约束（Mass Conservation Scaling）**：
   对输出区域细分后的局部降水量进行积分，引入面积加权校正系数，使得落入该宏观区域的所有细分高分辨率区域的降水总通量（$\sum P_{out} \cdot A_{out}$）与气候网格原输入值严格相等。

---

### 第 11 阶段：柯本气候体系经验分类 (KoppenClimateStage)

#### 11.1 机制原理
柯本-盖格（Köppen-Geiger）气候分类法是地理学中最经典的经验气候分类体系。它依据逐月气温与降水的年内分配节律，界定各类自然植被带的气候门槛。

模型在输出网格上，针对每个区域统计以下关键年汇总标量：
- 年平均温度 $T_{ann}$、最热月温度 $T_{hot}$、最冷月温度 $T_{cold}$、高于 $10^\circ\text{C}$ 的月份数 $N_{T10}$；
- 年总降水量 $P_{ann}$、夏半年最干燥月降水 $P_{smin}$、冬半年最干燥月降水 $P_{wmin}$、湿润月最大降水等。

分类决策树顺序如下：
1. **E 极地气候**：$T_{hot} < 10^\circ\text{C}$。若 $T_{hot} < 0^\circ\text{C}$ 为 **EF（极地冰原）**，否则为 **ET（极地苔原）**。
2. **B 干燥气候**：年总降水量小于干燥临界阈值 $P_{threshold}$：
   $$P_{threshold} = 20 \times T_{ann} + (\text{若夏雨为主加 280，冬雨为主加 0，均匀分布加 140})$$
   若 $P_{ann} < 0.5 \times P_{threshold}$ 为沙漠（**BWh / BWk**），否则为草原（**BSh / BSk**）。
3. **A 热带湿润气候**：最冷月 $T_{cold} \ge 18^\circ\text{C}$。根据旱季降水量细分为热带雨林（**Af**）、季风（**Am**）与热带草原（**Aw**）。
4. **C 温暖温带气候**：$-3^\circ\text{C} \le T_{cold} < 18^\circ\text{C}$ 且 $T_{hot} \ge 10^\circ\text{C}$。根据夏季干燥（地中海气候 **Csa/Csb**）、冬季干燥（季风湿润 **Cwa/Cwb**）或全年湿润（海洋性/湿润副热带 **Cfa/Cfb**）划分。
5. **D 大陆性冷温带气候**：$T_{cold} < -3^\circ\text{C}$ 且 $T_{hot} \ge 10^\circ\text{C}$（**Dfa, Dfb, Dfc, Dwd** 等亚型）。

#### 11.2 伪代码
```text
function ClassifyKoppen(monthlyT, monthlyP):
    annualT = Mean(monthlyT)
    annualP = Sum(monthlyP)
    Thot = Max(monthlyT)
    Tcold = Min(monthlyT)
    
    if Thot < 10:
        return (Thot < 0) ? "EF" : "ET"
        
    dryThreshold = ComputeDryThreshold(annualT, monthlyP)
    if annualP < dryThreshold:
        aridSubtype = (annualT >= 18) ? "h" : "k"
        return (annualP < 0.5 * dryThreshold) ? ("BW" + aridSubtype) : ("BS" + aridSubtype)
        
    if Tcold >= 18:
        return ClassifyTropicalGroupA(monthlyP)
    else if Tcold >= -3:
        return ClassifyTemperateGroupC(monthlyT, monthlyP)
    else:
        return ClassifyContinentalGroupD(monthlyT, monthlyP)
```

---

### 第 12 阶段：Whittaker 生态群系与物候指标 (BiomeStage)

#### 12.1 机制原理
植被生态群系不仅反映宏观气候，也是后续人类农业、放牧与聚落承载力的基础。模型采用修正的 **Whittaker 生态群系二维相空间图**，以年平均气温 $T$ 和年降水量 $P$ 为双轴，划分出热带雨林、温带落叶林、北方针叶林（泰加林）、疏林稀树草原、荒漠等基准群系。

此外，模型计算两项关键的连续生态物理指标：
1. **潜在蒸散量（PET, Potential Evapotranspiration）**：采用 Thornthwaite / Turc 经验近似公式，计算地表水分盈亏比（干燥度指数 $Aridity = P / PET$）。
2. **植物生长季长度（Growing Season Days）**：统计一年中日均温持续高于植物发芽门槛（如 $5^\circ\text{C}$）且降水不发生严重干旱胁迫的总天数。

---

### 第 13 阶段：地表水平衡、Priority-Flood 汇流与河网等级 (SurfaceHydrologyStage)

#### 13.1 机制原理
地表径流是塑造陆地景观与人类文明命脉的骨干网络。

1. **年净产流计算（Annual Runoff）**：
   降水不会全部变成河流。模型运行积雪-融雪物理循环：
   - 当月均温低于 $0^\circ\text{C}$ 时，降水作为固态积雪留在陆面；
   - 春季气温回升至 $0^\circ\text{C}$ 以上时，积雪融化释放大量地表径流；
   - 扣除月度蒸散发亏损，得出每个区域的年净产流深 $Runoff_{mm/year}$。
2. **Priority-Flood 填洼与单调排水表面构建**：
   原始地貌存在大量局部数字洼地（Sinks），若直接求坡降会导致水流死循环汇聚于坑底。
   模型采用经典的 **Barnes Priority-Flood 算法**：
   - 将所有海岸线胞元作为初始边界推入最小优先队列，优先级为地形高程；
   - 依次弹出最低胞元向陆地内部推进。若内陆邻居高程低于当前溢流出口，则将其抬升至当前出口高程（计算虚拟的无洼地排水表面 $DrainageElevation$），确保每个内陆点都拥有一条单调下降通向海洋（或内陆封闭终点湖）的唯一排水路径。
3. **最陡坡降路径（Steepest Descent D8）与拓扑累加**：
   在填洼表面上，每个陆地胞元选择坡降最陡的邻接胞元作为唯一**下游汇流目标（Downstream）**。全陆地从而构成森林状的无环有向图（DAG）。
4. **流量与河流等级计算**：
   沿拓扑拓扑排序自上游向下游累加径流，得到各处的物理平均秒流量 $Discharge$（$\text{m}^3/\text{s}$）。
   对流量超过阈值的河流段，计算其 **Horton-Strahler 河流级序**：
   - 源头支流为 1 级；
   - 两个同为 $k$ 级的河流汇流，下游升级为 $k+1$ 级；若一高一低汇合，下游维持较高等级。该级序直接决定地图上主干河道与细小支流的线宽层次。

#### 13.2 伪代码
```text
function ComputeSurfaceHydrology(mesh, elevation, oceanMask, annualRunoff):
    // 1. Priority-Flood 填洼求单调排水表面
    drainageElevation, parent = BuildDepressionFreeSurface(mesh, elevation, oceanMask)
    
    // 2. 确定每个胞元的唯一最陡下游
    downstream = new Array(mesh.numRegions).fill(-1)
    for r in LandRegions:
        downstream[r] = FindSteepestDescentNeighbor(mesh, r, drainageElevation)
        
    // 3. 拓扑排序并累积流量
    topoOrder = ComputeTopologicalSort(downstream)
    flowAccumulation = InitializeArray(mesh.numRegions, 0)
    for r in Reverse(topoOrder):
        flowAccumulation[r] += annualRunoff[r] * mesh.regionArea[r]
        if downstream[r] != -1:
            flowAccumulation[downstream[r]] += flowAccumulation[r]
            
    discharge = flowAccumulation * ACCUMULATION_TO_M3_PER_SEC
    
    // 4. 提取河网与 Strahler 级序
    riverMask = (discharge > RIVER_THRESHOLD)
    riverOrder = ComputeStrahlerOrders(mesh, downstream, riverMask)
    
    return downstream, discharge, riverMask, riverOrder
```

---

## 第二篇：人文社会系统模型

---

### 第 14 阶段：综合环境宜居度与聚落等级集聚 (PopulationStage)

#### 14.1 机制原理
人类生存与定居首先依赖于自然地理的承载能力。

1. **环境承载宜居度评价（Habitability Index）**：
   综合考量生态群系基底、作物生长季长度、水资源可用性（邻近大河）、地形坡度平缓度、防洪安全与海洋便利度：
   $$\text{Score} = \text{BiomeBase} \times \text{GrowingSeasonFactor} \times \text{MoistureAffinity} \times \text{SlopePenalty} + \text{RiverBonus} + \text{CoastBonus} - \text{FloodRisk}$$
2. **分散农业人口容量计算**：
   每个区域的基础常住人口正比于其宜居度得分与物理土地面积：
   $$\text{RuralPop}_r = \text{Habitability}_r \times \text{AreaKm2}_r \times \text{GlobalPopulationDensity}$$
   全陆地连通分量中，即使细小孤立海岛，模型亦设置最低连通种群保底。
3. **中心地选择与等级集聚（Central Place Theory & Rank-Size）**：
   人类定居不会均匀铺开，而是向优良区位（河口、汇流口、平原腹地）集聚形成中心城镇。
   - **空间泊松候选与最小间距排斥**：在满足宜居度与人口密度的前提下，依据连通分量与空间网格分块挑选聚落核心候选点，避免相邻胞元出现两个城市。
   - **腹地服务人口集聚（Urban Concentration）**：每个聚落中心作为引力核，根据距离衰减将周围腹地农村人口的一部分（由都市化配置参数控制）吸纳至城市中心内部：
     $$\text{SettlementPop} = \text{UrbanTransfer} + \min(\text{LocalRuralPop}, 5000)$$
   - 根据最终集聚规模，聚落被严格划分为村落（Village）、城镇（Town）、城市（City）和大都会（Metropolis）。

#### 14.2 核心守恒定律
$$\text{WorldTotalPopulation} = \sum_{r \in Regions} \text{RegionalPopulation}_r$$
聚落人口属于其所在区域人口的一部分，聚落统计人口不得重复累加至世界总人口。

---

### 第 15 阶段：阻力地表、生成树路网与沿海航运 (TransportStage)

#### 15.1 机制原理
交通连接打破了地理隔绝，促成了商品流通、帝国征服与文化同化。

1. **各向异性行进成本阻力面（Friction Surface）**：
   在输出网格图上，穿越相邻两区域的等价距离成本由地形物理阻力决定：
   $$\text{TravelCostKm} = \text{PhysicalDistanceKm} \times (1.0 + \text{SlopePenalty} + \text{RoughnessResistance} + \text{RiverCrossingPenalty})$$
   沿大河两岸行进平缓，而横切大峡谷或高海拔雪山阻力激增。
2. **多源区域生长与候选道路拓扑**：
   以所有聚落中心为源点，在阻力面上运行多源 Dijkstra 扩散，生成每个聚落的行进势力圈（Voronoi Catchment）。当两个不同聚落的势力圈在边界交汇时，提取其接触边界上的最低阻力通道，构筑点对点候选连接路段。
3. **基于最小生成树（MST）的主干道与冗余环路**：
   - 运行 Kruskal 算法构建覆盖连通陆地上所有聚落的最小生成树，确保无孤立城市。
   - 依据道路连接度参数，在树状网络基础上补充满足迂回比阈值（Detour Ratio $\le 1.8 \sim 2.5$）的次要环线，构建具有网状冗余度的现实路网。
4. **沿海港口与跳岛航线网络（Maritime Sea Routes）**：
   濒海聚落向海洋胞元寻找最近水域，赋予固定装卸转运成本（如 $120\text{ km}$ 等价阻力）。通过海水网格的最短路径搜索，连接隔海相望的沿海城市群（最大跨海距离限制在 $1,800\text{ km}$ 内）。
5. **市场可达性指数（Market Accessibility）**：
   依据空间引力模型（Gravity Model），计算各区域到达全大陆商业聚落的市场可达性潜能：
   $$\text{MarketAccess}_i = \sum_{j \in Settlements} \frac{\text{Pop}_j}{(\text{TravelCost}_{i,j} + 50.0)^\gamma}$$

---

### 第 16 阶段：民族发生核、文化空间漂移与多元构成 (EthnicityStage)

#### 16.1 机制原理
民族与语言是在长期的地理阻隔与交通接触中分化演进的。

1. **民族发生地（Ethnogenesis Origin）选拔**：
   在各主要人口密集区和地理连通分量上，以泊松圆盘间距（如 $\ge 650\text{ km}$）选择原始部族发源地。
2. **谱系树分支（语系与语言）**：
   - 在同一个陆地-航运接触网络内，空间距离在 $1,100\text{ km}$ 以内的部族共享同一种衍生语言；
   - 距离在 $2,500\text{ km}$ 以内的语言归入同一个共同语系（Language Family）。
3. **文化空间漫延与压缩稀疏行（CSR）多元构成**：
   文化沿陆地道路和海上航线由发源地向外扩散，其影响权重随行进阻力成本呈指数衰减：
   $$W(r, g) = \exp\left(-\frac{\text{TravelCost}(Origin_g, r)}{\text{CulturalDriftScale}}\right)$$
   在边境和繁荣商业走廊，不同民族文化发生混合。每个区域保留前 $K$ 个最主要的民族成分（最多 3 个），并按权重归一化分配该区域的全部实际人口：
   $$\sum_{g \in Groups(r)} \text{Residents}_{r, g} = \text{RegionalPopulation}_r$$
   在底层数据上采用压缩稀疏行（CSR, Compressed Sparse Row）数组格式高效存储，保证无论世界多大多密，内存开销恒定可控。

---

### 第 17 阶段：地缘权力投影、疆域协商与行政区划 (PolityStage)

#### 17.1 机制原理
国家不是自然界的固定实体，而是政治权力组织向地表空间投射与维护管辖的产物。

1. **首都选拔与国家规模预算**：
   依据市场可达性、腹地人口规模与地缘枢纽度挑选国家首都（确保首都间距 $\ge 900\text{ km}$）。
   国家的最大治理半径（权力预算）正比于其经济与人口体量：
   $$\text{GovernanceBudgetKm} = \min(3500, 850 + 200 \times \ln(1 + \text{CapitalHinterlandPop} / 1000))$$
2. **权力衰减与疆界前沿博弈（Power Projection & Frontier Contestation）**：
   以首都为源点向外扩散政治控制力。随着沿路网行进成本的增加，控制效能单调衰减：
   $$\text{CostRatio} = \frac{\text{TravelCostFromCapital}}{\text{GovernanceBudgetKm}}$$
   当两股不同的权力前沿在荒原相遇时，以先到者或相对控制力更强的一方划定国界线。边界只能沿有效连通路径蔓延，隔断的海外飞地若无航线支持会被自动裁剪。
3. **有效管辖强度（Control Strength）与无主荒野**：
   $$\text{ControlStrength}_r = \max(0, 1.0 - \text{CostRatio}_r)$$
   在远离首都的极端深山或冰原边陲，若 $\text{CostRatio} > 1.0$，国家放弃管辖，该区域被标记为无国家主权的未分配边疆（Frontier/Unclaimed）。
4. **郡县/行政区划（Administrative Districts）**：
   在国家疆界内部，以各次级聚落为中心进行二级 Voronoi 划分，将广阔的国土划分为若干地方行政管区。

---

### 第 18 阶段：信仰起源扩散、圣地网络与国家庇护 (ReligionStage)

#### 18.1 机制原理
宗教与意识形态体系跨越部落与国界，塑造人们的精神认同。

1. **宗教起源地与圣地设立**：
   在关键文化中心与历史重镇孕育宗教源点。若新教派起源于某一古老教派附近（距离 $< 1,700\text{ km}$），则将其定义为该母教的一个分支宗派（Branch/Sect）。
   在教派起源地自动设立宗教圣所/大圣地（Sacred Sites）。
2. **信仰传播阻力网络**：
   宗教主要沿着商业贸易航线与高市场可达性走廊快速传播，但在跨越国界时会受到异教政权的政治阻抗。
3. **国家庇护与国教确立（State Patronage）**：
   首都所在地的优势信仰具有极大机会被该国君主或元老院接纳为国家官方庇护宗教（Patron Religion）。获得国家庇护的宗教在其国家领土管辖范围内享有行进阻力衰减减半的传播优势。
4. **多信仰共存与世俗/无归属居民**：
   与民族类似，区域信仰采用 CSR 稀疏构成结构存储。但模型在此引入特殊信仰标记 `-1`，代表**无主要宗教归属/世俗居民（Non-affiliated）**。在边远蛮荒、未开化无人区或多方教派博弈未达均衡之地，世俗无归属居民占据主导地位。

---

## 结语：流水线全局数据流依赖图

整个虚拟地球生成流水线各阶段之间的数据承接依赖关系总结如下：

```text
[MeshStage] 
    │
    ▼
[PlateStage] ───────────┐
    │                   │
    ▼                   ▼
[ContinentalCrustStage] ───► [SuperPlateStage]
    │                               │
    └───────────────┬───────────────┘
                    │
                    ▼
            [ProjectionStage]
                    │
                    ▼
            [TectonicStage]
                    │
                    ▼
             [TerrainStage] ─── (最终宏观地形与海岸线)
                    │
        ┌───────────┴───────────────────────┐
        │                                   │
        ▼                                   ▼
[SeasonalCirculationStage]         [SurfaceHydrologyStage] ◄──┐
        │                                                     │
        ▼                                                     │
[MonthlyClimateStage] ────────────────────────────────────────┤
        │                                                     │
        ▼                                                     │
[ClimateOutputStage]                                          │
        │                                                     │
   ┌────┴──────────────────────────┐                          │
   ▼                               ▼                          │
[KoppenClimateStage]         [BiomeStage]                     │
   │                               │                          │
   └───────────────┬───────────────┘                          │
                   │                                          │
                   ▼                                          │
        [PopulationStage] ────────────────────────────────────┘
                   │
                   ▼
           [TransportStage]
                   │
                   ▼
           [EthnicityStage]
                   │
                   ▼
            [PolityStage]
                   │
                   ▼
           [ReligionStage] ─── (最终完整的虚拟星球数据)
```

每一阶段均是纯粹的无状态或幂等计算过程：给定相同的初始配置与种子，流水线能够毫厘不差地在浏览器端瞬时重现包含山川、风云与文明兴衰的整个世界。
