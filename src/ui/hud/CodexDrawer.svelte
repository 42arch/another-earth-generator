<script lang='ts'>
  import {
    Castle,
    Droplets,
    Globe,
    RotateCcw,
    SlidersHorizontal,
    Sparkles,
    Sun,
    Workflow,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import CivButton from '@/ui/components/CivButton.svelte'
  import CivSelect from '@/ui/components/CivSelect.svelte'
  import CivSlider from '@/ui/components/CivSlider.svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'

  const tabs = [
    { id: 'tectonics' as const, label: '板块构造', icon: Workflow },
    { id: 'land' as const, label: '陆块大洋', icon: Globe },
    { id: 'climate' as const, label: '气候天象', icon: Sun },
    { id: 'hydrology' as const, label: '水文湖泊', icon: Droplets },
    { id: 'human' as const, label: '文明聚落', icon: Castle },
  ]
</script>

{#if uiState.codexDrawerOpen}
  <aside
    transition:fly={{ x: -360, duration: 200 }}
    class='pointer-events-auto fixed left-4 top-16 bottom-4 z-40 w-92 max-w-[calc(100vw-32px)] obs-panel rounded-lg shadow-2xl flex flex-col text-obs-text-main overflow-hidden'
  >
    <!-- 抽屉头部 -->
    <header class='flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]'>
      <div class='flex items-center gap-2'>
        <SlidersHorizontal class='w-4 h-4 text-obs-amber' />
        <div>
          <h2 class='font-heading text-sm font-bold tracking-wider uppercase text-obs-text-main m-0 leading-tight'>
            行星参数控制台
          </h2>
          <span class='text-[10px] text-obs-text-dim tracking-wide'>
            Genesis Control Center
          </span>
        </div>
      </div>

      <button
        type='button'
        onclick={() => uiState.codexDrawerOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer'
        title='关闭抽屉'
      >
        <X class='w-4 h-4' />
      </button>
    </header>

    <!-- 标签页导航栏 -->
    <nav class='flex border-b border-white/[0.06] bg-black/20 overflow-x-auto select-none'>
      {#each tabs as tab}
        {@const Icon = tab.icon}
        <button
          type='button'
          onclick={() => uiState.activeTab = tab.id}
          class="flex-1 min-w-16 py-2 px-1 text-center font-heading text-[11px] font-medium tracking-wide uppercase border-b-2 transition-all flex flex-col items-center gap-1 cursor-pointer {uiState.activeTab === tab.id ? 'border-obs-amber text-obs-amber-light bg-obs-amber/10' : 'border-transparent text-obs-text-dim hover:text-obs-text-muted hover:bg-white/[0.02]'}"
        >
          <Icon class='w-3.5 h-3.5' />
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>

    <!-- 参数内容滚动区 -->
    <div class='flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar text-xs'>
      <!-- 网格质量与种子 -->
      <div class='bg-white/[0.02] p-2.5 rounded-md border border-white/[0.04] flex flex-col gap-2'>
        <CivSlider
          label='种子 (Seed)'
          bind:value={uiState.params.seed}
          min={1}
          max={9999}
          step={1}
          decimals={0}
          oncommit={val => uiState.updateParam('seed', val)}
        />
        <CivSelect
          label='球面细分精度 (Subdivision Quality)'
          bind:value={uiState.params.subdivision}
          options={[
            { label: '快速预览 (Subdivision 4)', value: 4 },
            { label: '均衡精度 (Subdivision 5)', value: 5 },
            { label: '默认高清 (Subdivision 6)', value: 6 },
          ]}
          oncommit={val => uiState.updateParam('subdivision', Number(val))}
        />
      </div>

      <!-- Tab 1: 板块构造 -->
      {#if uiState.activeTab === 'tectonics'}
        <CivSlider
          label='板块数量 (Plate Count)'
          bind:value={uiState.params.plateCount}
          min={6}
          max={48}
          step={1}
          decimals={0}
          description='地壳分裂的板块总数，影响板块碰撞与海沟走向'
          oncommit={val => uiState.updateParam('plateCount', val)}
        />
        <CivSlider
          label='造山应力 (Mountain Strength)'
          bind:value={uiState.params.mountainStrength}
          min={0}
          max={1}
          step={0.01}
          description='板块聚合挤压带的地形抬升剧烈程度'
          oncommit={val => uiState.updateParam('mountainStrength', val)}
        />
        <CivSlider
          label='地表起伏噪声 (Relief Noise)'
          bind:value={uiState.params.noiseStrength}
          min={0}
          max={1}
          step={0.01}
          description='Simplex 高频地形噪声扰动幅度'
          oncommit={val => uiState.updateParam('noiseStrength', val)}
        />
      {/if}

      <!-- Tab 2: 陆块大洋 -->
      {#if uiState.activeTab === 'land'}
        <CivSlider
          label='大陆数量 (Continents)'
          bind:value={uiState.params.continentCount}
          min={1}
          max={10}
          step={1}
          decimals={0}
          description='克拉通陆核数量'
          oncommit={val => uiState.updateParam('continentCount', val)}
        />
        <CivSlider
          label='陆地覆盖率 (Land Coverage)'
          bind:value={uiState.params.landCoverage}
          min={0.1}
          max={0.7}
          step={0.01}
          unit='%'
          description='全球地表面积中陆地的总占比'
          oncommit={val => uiState.updateParam('landCoverage', val)}
        />
        <CivSlider
          label='规模差异 (Size Variety)'
          bind:value={uiState.params.sizeVariety}
          min={0}
          max={1}
          step={0.01}
          description='各大陆面积的离散程度'
          oncommit={val => uiState.updateParam('sizeVariety', val)}
        />
        <CivSlider
          label='陆块离散度 (Spread)'
          bind:value={uiState.params.spread}
          min={0}
          max={1}
          step={0.01}
          description='大陆板块在全球分布的分散程度'
          oncommit={val => uiState.updateParam('spread', val)}
        />
        <CivSlider
          label='陆块紧凑度 (Compactness)'
          bind:value={uiState.params.compactness}
          min={0}
          max={1}
          step={0.01}
          description='大陆是聚集的整块还是破碎蜿蜒'
          oncommit={val => uiState.updateParam('compactness', val)}
        />
        <CivSlider
          label='延展拉伸率 (Elongation)'
          bind:value={uiState.params.elongation}
          min={0}
          max={1}
          step={0.01}
          description='大陆沿主轴方向的拉伸倾向'
          oncommit={val => uiState.updateParam('elongation', val)}
        />
        <CivSlider
          label='海岸曲折度 (Coastline Roughness)'
          bind:value={uiState.params.coastlineRoughness}
          min={0}
          max={1}
          step={0.01}
          description='海岸线分形曲折与峡湾复杂度'
          oncommit={val => uiState.updateParam('coastlineRoughness', val)}
        />
        <CivSlider
          label='离岸岛屿数 (Islands)'
          bind:value={uiState.params.islandCount}
          min={0}
          max={60}
          step={1}
          decimals={0}
          description='散布在大洋与大陆架边缘的岛屿数'
          oncommit={val => uiState.updateParam('islandCount', val)}
        />
        <CivSlider
          label='岛屿陆地份额 (Island Land Share)'
          bind:value={uiState.params.islandLandShare}
          min={0}
          max={0.25}
          step={0.01}
          oncommit={val => uiState.updateParam('islandLandShare', val)}
        />
        <CivSlider
          label='岛屿聚集度 (Island Clustering)'
          bind:value={uiState.params.islandClustering}
          min={0}
          max={1}
          step={0.01}
          description='从分散的远洋孤岛过渡到群岛与岛链结构'
          oncommit={val => uiState.updateParam('islandClustering', val)}
        />
        <CivSlider
          label='构造岛屿偏向 (Tectonic Island Bias)'
          bind:value={uiState.params.islandTectonicBias}
          min={0}
          max={1}
          step={0.01}
          description='提高火山岛弧沿板块边界生成的倾向'
          oncommit={val => uiState.updateParam('islandTectonicBias', val)}
        />
      {/if}

      <!-- Tab 3: 气候天象 -->
      {#if uiState.activeTab === 'climate'}
        <CivSlider
          label='赤道基准温度 (Equator Temp)'
          bind:value={uiState.params.equatorTemperature}
          min={20}
          max={36}
          step={0.5}
          unit='°C'
          oncommit={val => uiState.updateParam('equatorTemperature', val)}
        />
        <CivSlider
          label='极地基准温度 (Pole Temp)'
          bind:value={uiState.params.poleTemperature}
          min={-35}
          max={5}
          step={0.5}
          unit='°C'
          oncommit={val => uiState.updateParam('poleTemperature', val)}
        />
        <CivSlider
          label='地轴倾角 (Axial Tilt)'
          bind:value={uiState.params.axialTilt}
          min={0}
          max={45}
          step={0.5}
          unit='°'
          description='星球自转倾角，决定季节温差幅度'
          oncommit={val => uiState.updateParam('axialTilt', val)}
        />
        <CivSlider
          label='垂直递减率 (Lapse Rate)'
          bind:value={uiState.params.elevationLapseRate}
          min={0}
          max={10}
          step={0.1}
          unit='°C/km'
          oncommit={val => uiState.updateParam('elevationLapseRate', val)}
        />
        <CivSlider
          label='洋流输热 (Ocean Heat Transport)'
          bind:value={uiState.params.oceanHeatTransport}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('oceanHeatTransport', val)}
        />
        <CivSlider
          label='地形雨强度 (Orographic Rain)'
          bind:value={uiState.params.orographicStrength}
          min={0}
          max={2}
          step={0.05}
          description='迎风坡抬升降水与背风坡雨影效应'
          oncommit={val => uiState.updateParam('orographicStrength', val)}
        />
        <CivSlider
          label='副热带干旱度 (Subtropical Dryness)'
          bind:value={uiState.params.subtropicalDryness}
          min={0}
          max={0.9}
          step={0.05}
          oncommit={val => uiState.updateParam('subtropicalDryness', val)}
        />
        <div class='pt-2 mt-1 border-t border-white/[0.06] text-[10px] uppercase tracking-wider text-obs-text-dim'>
          环流与热量输送
        </div>
        <CivSlider
          label='纬度温度曲线 (Latitude Curve)'
          bind:value={uiState.params.latitudeTemperatureExponent}
          min={0.5}
          max={5}
          step={0.1}
          description='控制赤道至极地的温度梯度形状'
          oncommit={val => uiState.updateParam('latitudeTemperatureExponent', val)}
        />
        <CivSlider
          label='温度扰动 (Temperature Noise)'
          bind:value={uiState.params.temperatureNoiseStrength}
          min={0}
          max={6}
          step={0.1}
          unit='°C'
          oncommit={val => uiState.updateParam('temperatureNoiseStrength', val)}
        />
        <CivSlider
          label='风场扰动 (Wind Perturbation)'
          bind:value={uiState.params.windPerturbation}
          min={0}
          max={0.5}
          step={0.01}
          oncommit={val => uiState.updateParam('windPerturbation', val)}
        />
        <CivSlider
          label='洋流强度 (Ocean Current Strength)'
          bind:value={uiState.params.oceanCurrentStrength}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('oceanCurrentStrength', val)}
        />
        <div class='pt-2 mt-1 border-t border-white/[0.06] text-[10px] uppercase tracking-wider text-obs-text-dim'>
          水汽与降水
        </div>
        <CivSlider
          label='海洋蒸发 (Ocean Evaporation)'
          bind:value={uiState.params.oceanEvaporation}
          min={0.005}
          max={0.1}
          step={0.001}
          decimals={3}
          oncommit={val => uiState.updateParam('oceanEvaporation', val)}
        />
        <CivSlider
          label='陆地蒸发 (Land Evaporation)'
          bind:value={uiState.params.landEvaporation}
          min={0}
          max={0.03}
          step={0.001}
          decimals={3}
          oncommit={val => uiState.updateParam('landEvaporation', val)}
        />
        <CivSlider
          label='水汽输送迭代 (Moisture Iterations)'
          bind:value={uiState.params.moistureIterations}
          min={8}
          max={120}
          step={1}
          decimals={0}
          oncommit={val => uiState.updateParam('moistureIterations', val)}
        />
        <CivSlider
          label='水汽滞留率 (Moisture Retention)'
          bind:value={uiState.params.moistureRetention}
          min={0.8}
          max={1}
          step={0.005}
          decimals={3}
          oncommit={val => uiState.updateParam('moistureRetention', val)}
        />
        <CivSlider
          label='基础降水 (Base Precipitation)'
          bind:value={uiState.params.basePrecipitation}
          min={0}
          max={0.05}
          step={0.001}
          decimals={3}
          oncommit={val => uiState.updateParam('basePrecipitation', val)}
        />
        <CivSlider
          label='赤道辐合降水 (Equatorial Rain)'
          bind:value={uiState.params.equatorialRainStrength}
          min={0}
          max={0.12}
          step={0.002}
          decimals={3}
          oncommit={val => uiState.updateParam('equatorialRainStrength', val)}
        />
        <CivSlider
          label='中纬锋面降水 (Midlatitude Rain)'
          bind:value={uiState.params.midlatitudeRainStrength}
          min={0}
          max={0.06}
          step={0.001}
          decimals={3}
          oncommit={val => uiState.updateParam('midlatitudeRainStrength', val)}
        />
        <CivSlider
          label='蒸散强度 (Evapotranspiration)'
          bind:value={uiState.params.evapotranspirationStrength}
          min={0}
          max={1}
          step={0.02}
          oncommit={val => uiState.updateParam('evapotranspirationStrength', val)}
        />
        <CivSlider
          label='土壤下渗 (Infiltration)'
          bind:value={uiState.params.infiltration}
          min={0}
          max={0.6}
          step={0.01}
          oncommit={val => uiState.updateParam('infiltration', val)}
        />
      {/if}

      <!-- Tab 4: 水文湖泊 -->
      {#if uiState.activeTab === 'hydrology'}
        <CivSlider
          label='湖泊密度 (Lake Density)'
          bind:value={uiState.params.lakeDensity}
          min={0}
          max={1}
          step={0.05}
          description='地表洼地形成湖泊的倾向'
          oncommit={val => uiState.updateParam('lakeDensity', val)}
        />
        <CivSlider
          label='最小湖深 (Lake Min Depth)'
          bind:value={uiState.params.lakeMinDepth}
          min={0.002}
          max={0.04}
          step={0.001}
          oncommit={val => uiState.updateParam('lakeMinDepth', val)}
        />
        <CivSlider
          label='最小湖区规模 (Lake Min Region Count)'
          bind:value={uiState.params.lakeMinRegionCount}
          min={1}
          max={12}
          step={1}
          decimals={0}
          description='过滤仅由极少数网格构成的微型湖泊'
          oncommit={val => uiState.updateParam('lakeMinRegionCount', val)}
        />
        <CivSlider
          label='最小离岸距离 (Lake Coast Distance)'
          bind:value={uiState.params.lakeMinCoastDistance}
          min={0}
          max={12}
          step={1}
          decimals={0}
          description='避免近海洼地被过度识别为内陆湖'
          oncommit={val => uiState.updateParam('lakeMinCoastDistance', val)}
        />
        <CivSlider
          label='湖泊最大陆地占比 (Lake Coverage Cap)'
          bind:value={uiState.params.lakeMaxLandCoverage}
          min={0}
          max={0.1}
          step={0.005}
          decimals={3}
          oncommit={val => uiState.updateParam('lakeMaxLandCoverage', val)}
        />
        <CivSlider
          label='蒸发强度 (Evaporation Strength)'
          bind:value={uiState.params.lakeEvaporationStrength}
          min={0}
          max={3}
          step={0.05}
          description='影响湖水入流蒸发比及咸化演变'
          oncommit={val => uiState.updateParam('lakeEvaporationStrength', val)}
        />
        <CivSlider
          label='湖泊溢流阈值 (Lake Overflow)'
          bind:value={uiState.params.lakeOverflowThreshold}
          min={0.05}
          max={2}
          step={0.05}
          description='水量超过阈值时，内陆湖更倾向形成出流口'
          oncommit={val => uiState.updateParam('lakeOverflowThreshold', val)}
        />
        <CivSlider
          label='最低蓄水率 (Lake Minimum Fill)'
          bind:value={uiState.params.lakeMinFillRatio}
          min={0}
          max={0.95}
          step={0.01}
          oncommit={val => uiState.updateParam('lakeMinFillRatio', val)}
        />
        <CivSlider
          label='干流汇水阈值 (River Threshold)'
          bind:value={uiState.params.riverBasinThreshold}
          min={0.0005}
          max={0.03}
          step={0.0005}
          description='地表径流汇聚形成显式河流的下限'
          oncommit={val => uiState.updateParam('riverBasinThreshold', val)}
        />
        <CivSlider
          label='河流发源海拔 (River Source Elevation)'
          bind:value={uiState.params.riverMinSourceElevation}
          min={0.2}
          max={0.7}
          step={0.01}
          oncommit={val => uiState.updateParam('riverMinSourceElevation', val)}
        />
        <CivSlider
          label='最短河流长度 (River Min Length)'
          bind:value={uiState.params.riverMinLength}
          min={1}
          max={16}
          step={1}
          decimals={0}
          description='过滤短促且缺少流域尺度的小溪段'
          oncommit={val => uiState.updateParam('riverMinLength', val)}
        />
      {/if}

      <!-- Tab 5: 文明聚落 -->
      {#if uiState.activeTab === 'human'}
        <CivSlider
          label='聚落生成密度 (Settlement Density)'
          bind:value={uiState.params.settlementDensity}
          min={0.15}
          max={2.5}
          step={0.05}
          description='基于宜居度与水源的可繁衍文明聚落数'
          oncommit={val => uiState.updateParam('settlementDensity', val)}
        />
        <div class='pt-2 mt-1 border-t border-white/[0.06] text-[10px] uppercase tracking-wider text-obs-text-dim'>
          文化、政体与信仰
        </div>
        <CivSlider
          label='文化数量 (Culture Count)'
          bind:value={uiState.params.cultureCount}
          min={0}
          max={18}
          step={1}
          decimals={0}
          oncommit={val => uiState.updateParam('cultureCount', val)}
        />
        <CivSlider
          label='文化交融度 (Cultural Blending)'
          bind:value={uiState.params.culturalBlending}
          min={0}
          max={1}
          step={0.05}
          description='较高值会让文化过渡区更宽广'
          oncommit={val => uiState.updateParam('culturalBlending', val)}
        />
        <CivSlider
          label='政体数量 (Polity Count)'
          bind:value={uiState.params.polityCount}
          min={1}
          max={16}
          step={1}
          decimals={0}
          oncommit={val => uiState.updateParam('polityCount', val)}
        />
        <CivSlider
          label='政体凝聚力 (Political Cohesion)'
          bind:value={uiState.params.politicalCohesion}
          min={0}
          max={1}
          step={0.05}
          description='越高越易形成连续、稳定的统治区域'
          oncommit={val => uiState.updateParam('politicalCohesion', val)}
        />
        <CivSlider
          label='海外扩张倾向 (Overseas Expansion)'
          bind:value={uiState.params.overseasExpansion}
          min={0}
          max={1}
          step={0.05}
          oncommit={val => uiState.updateParam('overseasExpansion', val)}
        />
        <CivSlider
          label='宗教数量 (Religion Count)'
          bind:value={uiState.params.religionCount}
          min={0}
          max={12}
          step={1}
          decimals={0}
          oncommit={val => uiState.updateParam('religionCount', val)}
        />
        <CivSlider
          label='传教扩张性 (Proselytism)'
          bind:value={uiState.params.religiousProselytism}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('religiousProselytism', val)}
        />
        <div class='pt-2 mt-1 border-t border-white/[0.06] text-[10px] uppercase tracking-wider text-obs-text-dim'>
          交通与贸易
        </div>
        <CivSlider
          label='道路密度 (Road Density)'
          bind:value={uiState.params.roadDensity}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('roadDensity', val)}
        />
        <CivSlider
          label='航线密度 (Shipping Density)'
          bind:value={uiState.params.shippingRouteDensity}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('shippingRouteDensity', val)}
        />
        <CivSlider
          label='最大航行距离 (Shipping Range)'
          bind:value={uiState.params.shippingMaxRange}
          min={0.2}
          max={2.5}
          step={0.05}
          oncommit={val => uiState.updateParam('shippingMaxRange', val)}
        />
        <CivSlider
          label='洋流助航 (Current Influence)'
          bind:value={uiState.params.shippingCurrentInfluence}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('shippingCurrentInfluence', val)}
        />
        <CivSlider
          label='风力助航 (Wind Influence)'
          bind:value={uiState.params.shippingWindInfluence}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('shippingWindInfluence', val)}
        />
        <CivSlider
          label='公海风险 (Open Ocean Risk)'
          bind:value={uiState.params.shippingOpenOceanRisk}
          min={0}
          max={1}
          step={0.05}
          oncommit={val => uiState.updateParam('shippingOpenOceanRisk', val)}
        />
        <CivSlider
          label='贸易活跃度 (Trade Activity)'
          bind:value={uiState.params.tradeActivity}
          min={0}
          max={1.5}
          step={0.05}
          oncommit={val => uiState.updateParam('tradeActivity', val)}
        />
        <CivSlider
          label='生产专业化 (Trade Specialization)'
          bind:value={uiState.params.tradeSpecialization}
          min={0}
          max={1}
          step={0.05}
          oncommit={val => uiState.updateParam('tradeSpecialization', val)}
        />
      {/if}
    </div>

    <!-- 底部操作 -->
    <footer class='p-3 border-t border-white/[0.06] bg-black/20 flex items-center justify-between gap-2'>
      <CivButton
        variant='ghost'
        size='sm'
        onclick={() => uiState.randomizeSeed()}
      >
        <Sparkles class='w-3.5 h-3.5 mr-1 text-obs-amber' />
        随机种子
      </CivButton>

      <CivButton
        variant='amber'
        size='sm'
        class='flex-1'
        onclick={() => uiState.regenerateWorld()}
      >
        <RotateCcw class='w-3.5 h-3.5 mr-1' />
        重新演化
      </CivButton>
    </footer>
  </aside>
{/if}
