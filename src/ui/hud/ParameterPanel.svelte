<script lang='ts'>
  import {
    Play,
    SlidersHorizontal,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import Slider from '@/ui/components/Slider.svelte'
  import { appState } from '@/ui/state/app.svelte'
</script>

{#if appState.parameterPanelOpen}
  <aside
    transition:fly={{ x: -360, duration: 200 }}
    class='pointer-events-auto fixed left-4 top-16 bottom-20 z-40 w-[340px] max-w-[calc(100vw-32px)] bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col text-obs-text-main overflow-hidden'
  >
    <!-- 抽屉头部 -->
    <header class='flex items-center justify-between px-4 py-2 border-b border-white/[0.08]'>
      <div class='flex items-center gap-2'>
        <SlidersHorizontal class='w-4 h-4 text-obs-primary' />
        <div class='flex flex-col'>
          <h2 class='font-sans text-[13px] font-bold tracking-wide text-obs-text-main m-0 leading-none pt-[2px]'>
            参数设置
          </h2>
        </div>
      </div>

      <button
        type='button'
        onclick={() => appState.parameterPanelOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer'
        title='关闭参数面板'
      >
        <X class='w-4 h-4' />
      </button>
    </header>

    <!-- 参数内容滚动区 -->
    <div class='flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar text-xs'>

      <!-- 基础设置 -->
      <div class='flex flex-col gap-2 relative'>
        <div class='flex items-center gap-2 mb-1'>
          <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold'>
            基础网格
          </span>
          <div class='flex-1 h-px bg-white/5'></div>
        </div>

        <Slider
          label='随机种子'
          description='决定整个星球生成结果的初始伪随机数种子。相同种子在其他参数不变的情况下必定生成完全一致的星球。'
          bind:value={appState.params.core.seed}
          min={1}
          max={99999}
          step={1}
          decimals={0}
        />
        <Slider
          label='分辨率等级'
          description='控制生成的三维二十面体网格细分数。分为中、高、极高三个层级。'
          bind:value={appState.params.core.detail}
          min={0}
          max={2}
          step={1}
          decimals={0}
          toSlider={(v) => {
            if (v <= 40962)
              return 0
            if (v <= 163842)
              return 1
            return 2
          }}
          fromSlider={(v) => {
            if (v === 0)
              return 40962
            if (v === 1)
              return 163842
            return 655362
          }}
          formatValue={(v) => {
            if (v <= 40962)
              return '中 (4万)'
            if (v <= 163842)
              return '高 (16万)'
            return '极高 (65万)'
          }}
        />
        <Slider
          label='网格规整度'
          description='控制底层 Voronoi 网格的松弛度。0 为完全随机不规则，1 为趋近于均匀正六边形。'
          bind:value={appState.params.core.irregularity}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='地形粗糙度'
          description='基础地形生成时的分形噪声扰动幅度。影响星球表面山脉分布的锯齿感和起伏剧烈程度。'
          bind:value={appState.params.terrain.roughness}
          min={0}
          max={0.5}
          step={0.01}
          decimals={2}
        />
        <Slider
          label='地形扭曲'
          description='引入域翘曲 (Domain Warping)，使地形走势出现自然流体般的拉伸和旋转，产生更生动的大陆形状。'
          bind:value={appState.params.terrain.terrainWarp}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='地形平滑'
          description='板块碰撞及噪声叠加后的高程平滑处理强度。值越高地形过渡越柔和，但也会失去陡峭细节。'
          bind:value={appState.params.terrain.smoothing}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='冰川侵蚀'
          description='模拟极地及高海拔长期冰川滑动刮擦造成的地貌改变（如U型谷），削低高峰的高程。'
          bind:value={appState.params.terrain.glacialErosion}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='水力侵蚀'
          description='模拟降水与河流汇流的长期冲刷，在迎风坡和流水通道形成沟壑和沉积平原。'
          bind:value={appState.params.terrain.hydraulicErosion}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />

        <Slider
          label='山脊锐化'
          description='应用岭化噪声 (Ridged Noise)，增强板块俯冲带和造山带山脉的陡峭山脊特征。'
          bind:value={appState.params.terrain.ridgeSharpening}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
      </div>

      <!-- 板块构造配置 -->
      <div class='flex flex-col gap-2 relative mt-2'>
        <div class='flex items-center gap-2 mb-1'>
          <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold flex items-center gap-1.5'>
            构造参数
          </span>
          <div class='flex-1 h-px bg-white/5'></div>
        </div>
        <Slider
          label='主要板块'
          description='控制全球连续运动的主要构造板块数量。'
          bind:value={appState.params.geology.primaryPlateCount}
          min={2}
          max={24}
          step={1}
          decimals={0}
        />
        <Slider
          label='小板块'
          description='在主要板块边界附近生成的独立运动小板块上限。实际数量可能更少。'
          bind:value={appState.params.geology.microPlateCount}
          min={0}
          max={20}
          step={1}
          decimals={0}
        />
        <Slider
          label='板块面积差异'
          description='主要板块目标面积的差异程度，数值越高越容易出现大面积板块。'
          bind:value={appState.params.geology.plateSizeVariety}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='大陆数量'
          description='初始生成的大陆极点数量。影响全球宏观陆地斑块的数量和聚集程度。'
          bind:value={appState.params.geology.continentCount}
          min={1}
          max={30}
          step={1}
          decimals={0}
        />
        <Slider
          label='陆地覆盖率'
          description='全球陆地面积占星球总表面积的比例。0 为纯净的水世界，1 为完全没有海洋的荒漠星球。'
          bind:value={appState.params.geology.landCoverage}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
        />
        <Slider
          label='面积差异'
          description='各个大陆初始扩张权重的随机差异幅度。0 表示各大陆大小相似，1 极易出现超级大陆。'
          bind:value={appState.params.geology.continentSizeVariety}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
      </div>

      <!-- 岛屿与火山配置 -->
      <div class='flex flex-col gap-2 relative mt-2'>
        <div class='flex items-center gap-2 mb-1'>
          <span class='font-sans text-[11px] uppercase tracking-wide text-obs-text-muted font-bold flex items-center gap-1.5'>
            火山岛弧
          </span>
          <div class='flex-1 h-px bg-white/5'></div>
        </div>
        <Slider
          label='岛弧系统'
          description='模拟大洋板块俯冲边界生成的火山岛弧链数量，如同环太平洋火山带。'
          bind:value={appState.params.geology.islandArcCount}
          min={0}
          max={12}
          step={1}
          decimals={0}
        />
        <Slider
          label='岛屿密度'
          description='整体大洋中离散岛屿的数量和生成概率，主要受大洋中脊及微板块碎裂影响。'
          bind:value={appState.params.geology.islandDensity}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
        />
        <Slider
          label='热点数量'
          description='模拟地幔热柱突破地壳产生的热点 (Hotspot) 数量，如夏威夷群岛链，不受板块边界限制。'
          bind:value={appState.params.geology.hotspotCount}
          min={0}
          max={10}
          step={1}
          decimals={0}
        />
      </div>
    </div>

    <!-- 底部操作区 -->
    <footer class='flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-black/10'>
      {#if appState.hasUnappliedChanges}
        <span class='text-[10px] text-obs-amber font-medium'>参数已修改，等待执行</span>
      {:else}
        <span class='text-[10px] text-obs-text-dim'>调整参数后手动执行</span>
      {/if}
      <button
        type='button'
        class='flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold tracking-wider text-obs-amber-light border border-obs-amber/40 rounded-md bg-obs-amber/15 hover:bg-obs-amber/25 hover:border-obs-amber/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
        onclick={() => appState.regenerateWorld(undefined, true)}
        disabled={appState.isGenerating}
      >
        <Play class='w-3 h-3 fill-current' />
        <span>{appState.isGenerating ? '演化中...' : '开始演化'}</span>
      </button>
    </footer>
  </aside>
{/if}
