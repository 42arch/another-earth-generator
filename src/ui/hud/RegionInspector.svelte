<script lang='ts'>
  import {
    Satellite,
    X,
  } from '@lucide/svelte'
  import { fly, slide } from 'svelte/transition'
  import { classifyOceanCurrentThermal } from '@/core/climate/ocean-current-thermal'
  import { SETTLEMENT_RANK_LABELS } from '@/core/society/society-data'
  import Badge from '@/ui/components/Badge.svelte'
  import { appState } from '@/ui/state/app.svelte'

  const region = $derived(appState.selectedRegion)
  const month = $derived(appState.params.appearance.climateMonth)
  const monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']

  function vectorDirection(east: number, north: number): string {
    if (Math.hypot(east, north) < 0.05)
      return '近静止'
    const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
    const angle = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI)
    return `${directions[Math.round(angle / (Math.PI / 4)) % 8]}向`
  }

  function thermalLabel(warmth: number): string {
    const thermalClass = classifyOceanCurrentThermal(warmth)
    return thermalClass === 'cold' ? '冷流' : thermalClass === 'warm' ? '暖流' : '中性'
  }
</script>

<aside
  transition:fly={{ x: -300, duration: 200 }}
  class='pointer-events-auto fixed left-4 bottom-4 z-30 w-[340px] max-w-[calc(100vw-32px)] bg-[#1e1e20]/85 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] flex flex-col text-obs-text-main overflow-hidden'
>
  <!-- 头部 -->
  <header class='flex items-center justify-between px-4 py-2 border-b border-white/[0.06] select-none'>
    <div class='flex items-center gap-2'>
      <Satellite class='w-4 h-4 text-obs-primary' />
      <h2 class='font-heading text-[13px] font-bold tracking-wide uppercase text-obs-text-main m-0 leading-none pt-[2px]'>
        {#if region}
          SECTOR {region.region}
        {:else}
          行星探针读数
        {/if}
      </h2>
    </div>

    <div class='flex items-center gap-2'>
      {#if region}
        <Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>
          PLATE {region.plate}
        </Badge>
        {#if region.continent !== undefined && region.continent >= 0}
          <Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>
            CONT {region.continent}
          </Badge>
        {/if}
      {/if}
      <button
        type='button'
        onclick={() => appState.inspectorOpen = false}
        class='text-obs-text-dim hover:text-obs-text-main p-1 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer'
        title='关闭探针面板'
      >
        <X class='w-4 h-4' />
      </button>
    </div>
  </header>

  <!-- 内容区 -->
  <div class='flex-1 overflow-y-auto p-3.5 flex flex-col gap-3 custom-scrollbar text-xs max-h-[calc(100dvh-12rem)]'>
    {#if !region}
      <div class='py-4 text-center text-obs-text-dim text-xs flex flex-col items-center gap-2'>
        <Satellite class='w-6 h-6 text-obs-primary/60 animate-[pulse_2s_ease-in-out_infinite]' />
        <span>点击行星地表区域，发射探针以获取环境数据</span>
      </div>
    {:else}
      <div transition:slide={{ duration: 150 }} class='flex flex-col gap-2 text-xs'>
        <!-- 数据项容器 -->
        <div class='flex flex-col gap-4'>
          <!-- 核心地理 -->
          <div class='flex flex-col gap-1.5'>
            <div class='flex justify-between items-center'>
              <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>经纬度 (Lat/Lon)</span>
              <span class='text-obs-text-main font-mono'>{region.latitude.toFixed(1)}°{region.latitude >= 0 ? 'N' : 'S'} // {Math.abs(region.longitude).toFixed(1)}°{region.longitude >= 0 ? 'E' : 'W'}</span>
            </div>
            <div class='flex justify-between items-center'>
              <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>高程 (Elevation)</span>
              <span class='text-obs-text-main font-mono'>{region.elevation.toFixed(2)} km</span>
            </div>
            <div class='flex justify-between items-center'>
              <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>构造细分 (Subdivision)</span>
              <span class='text-obs-text-main font-mono'>#{region.plateDetail}</span>
            </div>
            {#if appState.params.appearance.baseMap === 'geometric-flow'}
              <div class='flex justify-between items-center'>
                <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>地形排水 (Drainage)</span>
                <span class='text-obs-text-main font-mono'>汇流: {region.geometricFlowCount?.toFixed(0) ?? '—'}</span>
              </div>
            {/if}
          </div>

          {#if region.habitability !== undefined}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='text-[11px] text-obs-text-dim uppercase tracking-wider'>人口与聚落</div>
              <div class='flex justify-between items-center'><span class='text-obs-text-dim'>宜居性</span><span class='font-mono'>{(region.habitability * 100).toFixed(0)}%</span></div>
              <div class='flex justify-between items-center'><span class='text-obs-text-dim'>区域人口</span><span class='font-mono'>{Math.round(region.population ?? 0).toLocaleString('zh-CN')} 人</span></div>
              <div class='flex justify-between items-center'><span class='text-obs-text-dim'>人口密度</span><span class='font-mono'>{(region.populationDensity ?? 0).toFixed(1)} 人/km²</span></div>
              {#if region.settlement}
                <div class='mt-1 rounded-md bg-obs-primary/10 border border-obs-primary/20 p-2 flex flex-col gap-1'>
                  <div class='font-medium text-obs-text-main'>{region.settlement.name} · {SETTLEMENT_RANK_LABELS[region.settlement.rank]}</div>
                  {#if region.isPort}<div class='text-obs-primary'>航线接驳节点</div>{/if}
                  <div class='text-obs-text-dim'>聚落人口 {Math.round(region.settlement.population).toLocaleString('zh-CN')} 人</div>
                  <div class='text-obs-text-dim'>服务腹地 {Math.round(region.settlement.hinterlandPopulation).toLocaleString('zh-CN')} 人</div>
                  <div class='text-obs-text-dim'>{region.settlement.reasons.join(' · ')}</div>
                </div>
              {/if}
            </div>
          {/if}

          {#if region.ethnicComposition && region.ethnicComposition.length > 0}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='text-[11px] text-obs-text-dim uppercase tracking-wider'>民族与语言</div>
              {#each region.ethnicComposition as group}
                <div class='flex justify-between gap-2'>
                  <span class='text-obs-text-main'>{group.name} <span class='text-obs-text-dim'>· {group.languageName}</span></span>
                  <span class='font-mono shrink-0'>{Math.round(group.population).toLocaleString('zh-CN')} 人 · {(group.share * 100).toFixed(0)}%</span>
                </div>
              {/each}
              <div class='text-[10px] text-obs-text-dim'>主要群体的起源区域 #{region.ethnicComposition[0].originRegion}；主要群体不一定超过半数。</div>
              {#if region.languageComposition}
                <div class='pt-1 text-[10px] text-obs-text-dim'>语言：{region.languageComposition.map(language => `${language.name}（${language.familyName}）${(language.share * 100).toFixed(0)}%`).join(' · ')}</div>
              {/if}
            </div>
          {/if}

          {#if region.religiousComposition && region.religiousComposition.length > 0}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='text-[11px] text-obs-text-dim uppercase tracking-wider'>宗教与信仰 · 主要归属</div>
              {#each region.religiousComposition as belief}
                <div class='flex justify-between gap-2'>
                  <span class='text-obs-text-main'>{belief.name}</span>
                  <span class='font-mono shrink-0'>{Math.round(belief.population).toLocaleString('zh-CN')} 人 · {(belief.share * 100).toFixed(0)}%</span>
                </div>
              {/each}
              {#if region.religiousComposition[0].originName}
                <div class='text-[10px] text-obs-text-dim'>主要信仰起源：{region.religiousComposition[0].originName}{region.religiousComposition[0].parentName ? ` · ${region.religiousComposition[0].parentName}分支` : ''}</div>
              {/if}
              {#if region.sacredSiteNames && region.sacredSiteNames.length > 0}
                <div class='text-[10px] text-obs-primary'>圣地：{region.sacredSiteNames.join(' · ')}</div>
              {/if}
            </div>
          {/if}

          {#if region.marketAccess !== undefined}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='text-[11px] text-obs-text-dim uppercase tracking-wider'>交通与市场</div>
              <div class='flex justify-between items-center'><span class='text-obs-text-dim'>最近市场</span><span>{region.nearestMarketName ?? '无陆路市场'}</span></div>
              {#if region.marketCostKm !== undefined}
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>通行成本</span><span class='font-mono'>{region.marketCostKm.toFixed(0)} km 等效</span></div>
              {/if}
              <div class='flex justify-between items-center'><span class='text-obs-text-dim'>市场可达性</span><span class='font-mono'>{(region.marketAccess * 100).toFixed(0)}%</span></div>
              {#if region.route}
                <div class='mt-1 rounded-md bg-obs-primary/10 border border-obs-primary/20 p-2 flex flex-col gap-1'>
                  <div class='font-medium'>{region.route.kind === 'sea' ? '航线' : '陆路'} · {region.routeFromName} — {region.routeToName}</div>
                  <div class='text-obs-text-dim'>路径 {region.route.distanceKm.toFixed(0)} km · 成本 {region.route.costKm.toFixed(0)} km 等效</div>
                </div>
              {/if}
            </div>
          {/if}

          {#if region.habitability !== undefined && region.isLand}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='text-[11px] text-obs-text-dim uppercase tracking-wider'>国家与行政</div>
              {#if region.polityName}
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>所属国家</span><span>{region.polityName}</span></div>
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>政体</span><span>{region.polityForm === 'kingdom' ? '王国' : region.polityForm === 'republic' ? '共和国' : region.polityForm === 'league' ? '联盟' : '城邦'}</span></div>
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>首都</span><span>{region.capitalName}</span></div>
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>行政区</span><span>{region.districtName ?? '—'}</span></div>
                <div class='flex justify-between items-center'><span class='text-obs-text-dim'>控制强度</span><span class='font-mono'>{((region.controlStrength ?? 0) * 100).toFixed(0)}%</span></div>
                {#if region.officialLanguageName}<div class='flex justify-between items-center'><span class='text-obs-text-dim'>官方语言</span><span>{region.officialLanguageName}</span></div>{/if}
                {#if region.patronReligionName}<div class='flex justify-between items-center'><span class='text-obs-text-dim'>扶持信仰</span><span>{region.patronReligionName}</span></div>{/if}
              {:else}
                <div class='text-obs-text-dim'>未归属任何国家</div>
              {/if}
            </div>
          {/if}

          <!-- 矢量流场 -->
          {#if region.vectorKind && region.vectorEast !== undefined && region.vectorNorth !== undefined}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='flex justify-between items-center'>
                <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>{region.vectorKind === 'wind' ? '盛行风' : '洋流'}去向 (Dir)</span>
                {#if region.vectorKind === 'ocean-current' && region.isLand}
                  <span class='text-obs-text-muted font-mono'>N/A</span>
                {:else}
                  <span class='text-obs-text-main font-mono'>{vectorDirection(region.vectorEast, region.vectorNorth)}</span>
                {/if}
              </div>
              {#if !(region.vectorKind === 'ocean-current' && region.isLand)}
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>相对强度 (Strength)</span>
                  <span class='text-obs-text-main font-mono'>{Math.hypot(region.vectorEast, region.vectorNorth).toFixed(2)}</span>
                </div>
                {#if region.vectorKind === 'ocean-current' && region.vectorWarmth !== undefined}
                  <div class='flex justify-between items-center'>
                    <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>海温特征 (Thermal)</span>
                    <span class='text-obs-text-main font-mono'>{thermalLabel(region.vectorWarmth)}</span>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}

          <!-- 气候与生态 -->
          {#if region.koppenLabel && region.monthlyTemperatureC && region.monthlyPrecipitationMm}
            <div class='border-t border-white/[0.06]'></div>
            <div class='flex flex-col gap-1.5'>
              <div class='flex justify-between items-center'>
                <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>Köppen 气候</span>
                <span class='text-obs-text-main font-mono'>{region.koppenLabel}</span>
              </div>
              {#if region.biomeLabel}
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>生物群系 (Biome)</span>
                  <span class='text-obs-text-main font-mono'>{region.biomeLabel}</span>
                </div>
              {/if}
              {#if region.isLand}
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>年均气温 (Temp)</span>
                  <span class='text-obs-text-main font-mono'>{region.annualTemperatureC?.toFixed(1)} °C</span>
                </div>
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>年降水量 (Precip)</span>
                  <span class='text-obs-text-main font-mono'>{region.annualPrecipitationMm?.toFixed(0)} mm</span>
                </div>
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>干燥指数 (Aridity)</span>
                  <span class='text-obs-text-main font-mono'>{region.aridityIndex?.toFixed(2) ?? '—'}</span>
                </div>
                <div class='flex justify-between items-center'>
                  <span class='text-[11px] text-obs-text-dim uppercase tracking-wider'>生长季 (Season)</span>
                  <span class='text-obs-text-main font-mono'>{region.growingSeasonMonths ?? '—'} 个月</span>
                </div>
              {/if}
            </div>

            <!-- 月份数据图表/选择器 -->
            <div class='border-t border-white/[0.06] pt-3'>
              <div class='flex justify-between items-center text-obs-text-main mb-2'>
                <span class='text-[11px] text-obs-text-dim tracking-wider'>{monthNames[month]} 气象数据</span>
                <span class='font-mono font-medium'>{region.monthlyTemperatureC[month].toFixed(1)}° / {region.monthlyPrecipitationMm[month].toFixed(0)}mm</span>
              </div>
              <div class='grid grid-cols-4 gap-1'>
                {#each monthNames as name, index}
                  <button
                    type='button'
                    onclick={() => appState.updateParam('appearance', 'climateMonth', index)}
                    class="rounded border px-1 py-1 text-center font-mono text-[10px] cursor-pointer transition-colors {month === index ? 'border-obs-primary/50 bg-obs-primary/10 text-obs-primary' : 'border-white/[0.04] text-obs-text-dim hover:bg-white/[0.04] hover:text-obs-text-main'}"
                  >
                    <span class='block'>{name}</span>
                    <span class='block mt-0.5 opacity-80'>{region.monthlyTemperatureC[index].toFixed(0)}°·{region.monthlyPrecipitationMm[index].toFixed(0)}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</aside>
