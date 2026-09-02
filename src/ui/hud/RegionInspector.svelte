<script lang='ts'>
  import {
    Castle,
    Compass,
    Droplets,
    Landmark,
    Languages,
    Mountain,
    Radio,
    Sparkles,
    Trees,
  } from '@lucide/svelte'
  import { slide } from 'svelte/transition'
  import CivBadge from '@/ui/components/CivBadge.svelte'
  import CivPanel from '@/ui/components/CivPanel.svelte'
  import { uiState } from '@/ui/state/ui-state.svelte'

  const region = $derived(uiState.selectedRegion)
</script>

<aside class='pointer-events-none fixed left-4 bottom-18 z-30 w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-6.5rem)]'>
  <div class='pointer-events-auto max-h-[calc(100dvh-6.5rem)] overflow-y-auto custom-scrollbar'>
    <CivPanel
      title='区域侦测详报'
      icon={Radio}
      bind:open={uiState.inspectorOpen}
    >
      {#if !region}
        <div class='py-3 text-center text-obs-text-dim text-xs flex flex-col items-center gap-1.5'>
          <Compass class='w-5 h-5 text-obs-amber/60 animate-pulse' />
          <span>点击球体任意区域以侦测地学详报</span>
        </div>
      {:else}
        <div transition:slide={{ duration: 150 }} class='flex flex-col gap-2 text-xs'>
          <!-- 区域标题与坐标徽章 -->
          <div class='flex items-center justify-between border-b border-white/[0.06] pb-2'>
            <div>
              <span class='font-mono text-obs-text-main font-bold text-sm'>
                Region #{region.region}
              </span>
              <span class='text-[11px] text-obs-text-dim ml-1.5 font-mono'>
                {region.latitude.toFixed(1)}°{region.latitude >= 0 ? 'N' : 'S'}, {Math.abs(region.longitude).toFixed(1)}°{region.longitude >= 0 ? 'E' : 'W'}
              </span>
            </div>

            <div class='flex items-center gap-1'>
              <CivBadge variant={region.feature === '海洋' ? 'blue' : region.feature === '湖泊' ? 'emerald' : 'amber'}>
                {region.feature}
              </CivBadge>
              <CivBadge variant='slate'>
                板块 #{region.plate}
              </CivBadge>
            </div>
          </div>

          <!-- 生态群落与地貌概览 -->
          <div class='grid grid-cols-2 gap-2 bg-white/[0.02] p-2 rounded-md border border-white/[0.04]'>
            <div class='flex items-center gap-2'>
              <Trees class='w-4 h-4 text-obs-emerald shrink-0' />
              <div class='flex flex-col'>
                <span class='text-[10px] text-obs-text-dim uppercase'>生态群落</span>
                <span class='text-obs-text-main font-medium text-xs leading-tight'>{region.biome}</span>
              </div>
            </div>
            <div class='flex items-center gap-2'>
              <Mountain class='w-4 h-4 text-obs-amber shrink-0' />
              <div class='flex flex-col'>
                <span class='text-[10px] text-obs-text-dim uppercase'>海拔 / 高程</span>
                <span class='text-obs-text-main font-mono text-xs leading-tight'>{region.climateElevationMeters.toFixed(0)}m ({region.elevation.toFixed(2)})</span>
              </div>
            </div>
          </div>

          <!-- 气候气象指标 -->
          <div class='grid grid-cols-3 gap-1 text-[11px] bg-white/[0.02] p-2 rounded-md border border-white/[0.04] font-mono'>
            <div>
              <span class='text-obs-text-dim text-[9px] block'>年均温</span>
              <span class='text-rose-300 font-semibold'>{region.temperature.toFixed(1)}°C</span>
            </div>
            <div>
              <span class='text-obs-text-dim text-[9px] block'>最暖 / 最冷月</span>
              <span class='text-obs-text-muted'>{region.warmestMonthTemperature.toFixed(0)}° / {region.coldestMonthTemperature.toFixed(0)}°</span>
            </div>
            <div>
              <span class='text-obs-text-dim text-[9px] block'>年降水量</span>
              <span class='text-blue-300 font-semibold'>{region.annualPrecipitationMm.toFixed(0)}mm</span>
            </div>
          </div>

          <!-- 人文聚落 -->
          {#if region.settlement}
            {@const set = region.settlement}
            <div class='bg-obs-amber/10 p-2 rounded-md border border-obs-amber/25 flex flex-col gap-1'>
              <div class='flex items-center justify-between'>
                <div class='flex items-center gap-1.5 font-medium text-obs-amber-light text-xs'>
                  <Castle class='w-3.5 h-3.5 text-obs-amber' />
                  <span>{set.name}</span>
                </div>
                <CivBadge variant='amber'>{set.type}</CivBadge>
              </div>
              <div class='flex items-center justify-between text-[11px] text-obs-text-muted font-mono'>
                <span>人口: <strong class='text-obs-text-main'>{set.population.toLocaleString()}</strong></span>
                <span>繁荣度: <strong class='text-obs-amber-light'>{(set.prosperity * 100).toFixed(0)}%</strong></span>
                {#if set.isPort}
                  <span class='text-cyan-300 text-[10px]'>✦ 港口</span>
                {/if}
              </div>
            </div>
          {/if}

          <!-- 文化语言、国家与信仰归属 -->
          {#if region.culture || region.polity || region.religion}
            <div class='bg-white/[0.025] p-2 rounded-md border border-white/[0.07] flex flex-col gap-1.5'>
              <div class='flex items-center gap-1.5 text-[10px] tracking-wide text-obs-text-dim uppercase'>
                <Languages class='w-3.5 h-3.5 text-obs-amber' />
                <span>人文归属</span>
              </div>
              <div class='grid grid-cols-2 gap-1.5'>
                {#if region.culture}
                  {@const culture = region.culture}
                  <div class='col-span-2 border-l-2 border-obs-emerald/60 bg-obs-emerald/[0.06] px-2 py-1.5 min-w-0'>
                    <div class='flex items-center justify-between gap-2'>
                      <span class='text-emerald-200 font-medium truncate' title={culture.name}>{culture.name}文化</span>
                      {#if culture.isCore}
                        <CivBadge variant='emerald'>文化核心</CivBadge>
                      {/if}
                    </div>
                    <div class='text-[10px] text-obs-text-dim mt-0.5 flex items-center justify-between gap-2'>
                      <span class='truncate'>{culture.language}语 · {culture.languageFamily}语族</span>
                      <span class='font-mono shrink-0'>{(culture.influence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                {/if}

                {#if region.polity}
                  {@const polity = region.polity}
                  <div class='border-l-2 border-obs-amber/60 bg-obs-amber/[0.06] px-2 py-1.5 min-w-0'>
                    <div class='flex items-center gap-1 text-[10px] text-obs-text-dim'>
                      <Landmark class='w-3 h-3 text-obs-amber' />
                      <span>{polity.isCapital ? '首府' : '政治归属'}</span>
                    </div>
                    <div class='text-obs-amber-light font-medium truncate mt-0.5' title={polity.name}>{polity.name}</div>
                    <div class='text-[9px] text-obs-text-dim font-mono'>控制 {(polity.control * 100).toFixed(0)}%</div>
                  </div>
                {/if}

                {#if region.religion}
                  {@const religion = region.religion}
                  <div class='border-l-2 border-violet-400/60 bg-violet-400/[0.06] px-2 py-1.5 min-w-0'>
                    <div class='flex items-center gap-1 text-[10px] text-obs-text-dim'>
                      <Sparkles class='w-3 h-3 text-violet-300' />
                      <span>{religion.isHolySite ? '圣地' : '主流信仰'}</span>
                    </div>
                    <div class='text-violet-200 font-medium truncate mt-0.5' title={religion.name}>{religion.name}</div>
                    <div class='text-[9px] text-obs-text-dim font-mono'>影响 {(religion.influence * 100).toFixed(0)}%</div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- 水系与湖泊 -->
          {#if region.lake}
            {@const lake = region.lake}
            <div class='bg-obs-blue/10 p-2 rounded-md border border-obs-blue/25 flex flex-col gap-1 text-[11px]'>
              <div class='flex items-center justify-between'>
                <span class='text-blue-300 font-medium'>湖泊 #{lake.id + 1}</span>
                <CivBadge variant='blue'>{lake.isEndorheic ? '内流湖' : '外流湖'}</CivBadge>
              </div>
              <div class='flex items-center justify-between text-obs-text-muted font-mono'>
                <span>状态: {lake.iceState}</span>
                <span>盐度: <strong class='text-blue-300'>{(lake.salinity * 100).toFixed(0)}%</strong></span>
                <span>蓄水率: <strong class='text-blue-300'>{(lake.fillRatio * 100).toFixed(0)}%</strong></span>
              </div>
            </div>
          {/if}

          {#if region.isRiver}
            <div class='bg-obs-blue/10 px-2 py-1 rounded-md border border-obs-blue/20 flex items-center justify-between text-[11px]'>
              <span class='text-blue-300 flex items-center gap-1'>
                <Droplets class='w-3 h-3' />
                {region.isSeasonalRiver ? '季节性河道' : '常年主河道'}
              </span>
              <span class='text-obs-text-dim font-mono'>季节性 {(region.riverSeasonality * 100).toFixed(0)}%</span>
            </div>
          {/if}

          {#if region.ocean}
            {@const ocean = region.ocean}
            <div class='bg-white/[0.02] p-2 rounded-md border border-white/[0.04] flex items-center justify-between text-[11px] font-mono'>
              <span>海表温: <strong class='text-cyan-300'>{ocean.sst.toFixed(1)}°C</strong></span>
              <span>洋流强度: <strong class='text-blue-300'>{(ocean.currentSpeed * 100).toFixed(0)}%</strong></span>
            </div>
          {/if}

          <!-- 宜居度与地缘指标 -->
          <div class='flex items-center justify-between text-[10px] text-obs-text-dim border-t border-white/[0.06] pt-1.5 font-mono'>
            <span>宜居性: {(region.habitability * 100).toFixed(0)}%</span>
            <span>可达性: {(region.accessibility * 100).toFixed(0)}%</span>
            <span>大陆性: {(region.continentality * 100).toFixed(0)}%</span>
          </div>
        </div>
      {/if}
    </CivPanel>
  </div>
</aside>
