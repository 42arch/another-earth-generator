<script lang='ts'>
  import type { GenerationController } from '@/lib/generation/controller'
  import { KOPPEN_CLASS_LABELS_ZH } from '@another-earth/cartography'
  import { KOPPEN_CODES } from '@another-earth/world-core'
  import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
  import { Satellite, X } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import {
    findCultureArchetype,
    findPeopleArchetype,
    findPolityArchetype,
    findReligionArchetype,
    findResourceDefinition,
    translateContentKey,
  } from '@/lib/generation/builtin-content'
  import Badge from '@/ui/components/Badge.svelte'
  import { appState } from '@/ui/state/app.svelte'

  interface RegionPopulationGroupSummary {
    readonly population: number
    readonly peopleName: string
    readonly cultureName: string
    readonly religionName: string | null
    readonly polityName: string | null
  }

  interface RegionInspection {
    readonly regionId: number
    readonly coordinates: { readonly longitudeDegrees: number, readonly latitudeDegrees: number }
    readonly entityId?: string
    readonly featureHit?: { readonly layerId: string, readonly sourceId: string, readonly featureId: string, readonly entityId?: string }
    readonly neighbors: readonly number[]
    readonly slopeDeg: number
    readonly regionFacts: ReturnType<GenerationController['queryWorldRegion']>
    readonly continentLabel: string
    readonly basin: ReturnType<GenerationController['queryWorldBasin']>
    readonly river: ReturnType<GenerationController['queryWorldRiver']>
    readonly lake: ReturnType<GenerationController['queryWorldLake']>
    readonly wind: { readonly east: number, readonly north: number } | null
    readonly ocean: { readonly east: number, readonly north: number, readonly warmth: number } | null
    readonly contributingAreaKm2: number
    readonly accumulatedFlowM3s: number
    readonly hasResources: boolean
    readonly hasCivilization: boolean
    readonly dominantPeople: ReturnType<GenerationController['queryWorldPeople']>
    readonly dominantCulture: ReturnType<GenerationController['queryWorldCulture']>
    readonly dominantReligion: ReturnType<GenerationController['queryWorldReligion']>
    readonly dominantPolity: ReturnType<GenerationController['queryWorldPolity']>
    readonly dominantPolityCapitalName: string | null
    readonly pickedPolity: ReturnType<GenerationController['queryWorldPolity']>
    readonly pickedPolityCapitalName: string | null
    readonly pickedSettlement: ReturnType<GenerationController['queryWorldSettlement']>
    readonly pickedTransportRoute: ReturnType<GenerationController['queryWorldTransportRoute']>
    readonly pickedCulture: ReturnType<GenerationController['queryWorldCulture']>
    readonly pickedReligion: ReturnType<GenerationController['queryWorldReligion']>
    readonly regionPopulationGroups: readonly RegionPopulationGroupSummary[]
  }

  interface Props {
    open: boolean
    inspection: RegionInspection | null
  }

  const { open, inspection }: Props = $props()
  const compassDirections = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const

  const settlementTierLabels: Record<string, string> = {
    capital: '首都',
    city: '城市',
    town: '城镇',
    village: '村落',
  }

  const politySizeLabels: Record<string, string> = {
    'city-state': '城邦',
    'regional': '区域政权',
    'kingdom': '王国',
    'empire': '帝国',
  }

  const transportModeLabels: Record<string, string> = {
    road: '陆路驿道',
    river: '内河航道',
    sea: '近海航线',
  }

  const resourceCategoryLabels: Record<string, string> = {
    mineral: '矿产',
    energy: '能源',
    biological: '生物',
  }

  const successionLabels: Record<string, string> = {
    hereditary: '世袭制',
    elective: '选举制',
    appointed: '任命制',
    rotating: '轮值制',
    collective: '集体执政',
    mixed: '混合制',
  }

  function formatCirculationVector(east: number, north: number, digits: number): string {
    const speedMps = Math.hypot(east, north)
    if (!Number.isFinite(speedMps))
      return '无数据'
    const speed = `${speedMps.toFixed(digits)} m/s`
    if (speedMps < 1e-4)
      return speed
    const sector = Math.round(Math.atan2(east, north) / (Math.PI / 4))
    return `${speed} · 向${compassDirections[(sector + 8) % 8]}`
  }

  function formatPopulation(value: number): string {
    if (!Number.isFinite(value) || value <= 0)
      return '0'
    return Math.round(value).toLocaleString(appState.locale)
  }

  function formatResourceName(resourceId: string): string {
    const def = findResourceDefinition(resourceId)
    if (!def)
      return resourceId
    const label = translateContentKey(def.displayNameKey, appState.locale)
    return `${label} (${resourceCategoryLabels[def.category] ?? def.category})`
  }

  function formatPolityArchetypeSummary(archetypeId: string): {
    name: string
    headOfStateTitle: string
    headOfGovernmentTitle: string | null
    legislatureTitle: string | null
    succession: string
  } | null {
    const archetype = findPolityArchetype(archetypeId)
    if (!archetype)
      return null
    return {
      name: translateContentKey(archetype.displayNameKey, appState.locale),
      headOfStateTitle: archetype.headOfStateTitle,
      headOfGovernmentTitle: archetype.headOfGovernmentTitle,
      legislatureTitle: archetype.legislatureTitle,
      succession: successionLabels[archetype.succession] ?? archetype.succession,
    }
  }
</script>

{#if open}
  <aside transition:fly={{ x: -300, duration: 200 }} class='pointer-events-auto fixed bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-30 w-[340px] max-w-[calc(100vw-var(--app-sidebar-width)-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2 select-none'>
      <div class='flex items-center gap-2'>
        <Satellite class='h-4 w-4 text-obs-primary' />
        <h2 class='m-0 pt-[2px] font-heading text-[13px] font-bold tracking-wide uppercase'>{inspection ? `REGION #${inspection.regionId}` : '行星探针读数'}</h2>
      </div>
      <div class='flex items-center gap-2'>
        {#if inspection}<Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>MESH</Badge>{/if}
        <button type='button' onclick={() => appState.inspectorOpen = false} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title='关闭探针面板' aria-label='关闭探针面板'><X class='h-4 w-4' /></button>
      </div>
    </header>
    <div class='custom-scrollbar max-h-[calc(100dvh-12rem)] overflow-y-auto p-3.5 text-xs'>
      {#if inspection}
        {@const info = inspection}
        {@const biomeDef = NATURAL_BIOME_DEFINITIONS.find(d => d.id === info.regionFacts.potentialBiomeId)}
        {@const coverDef = NATURAL_LAND_COVER_DEFINITIONS.find(d => d.id === info.regionFacts.landCoverId)}
        {@const koppenCode = KOPPEN_CODES[info.regionFacts.koppenClass] ?? 'Ocean'}
        {@const koppenLabel = KOPPEN_CLASS_LABELS_ZH[info.regionFacts.koppenClass] ?? koppenCode}
        <section class='flex flex-col gap-3 text-xs' aria-label='选中区域'>
          <div class='flex flex-col gap-2.5 text-xs'>
            <div class='flex flex-col gap-1 rounded-lg border border-white/6 bg-white/2 p-2.5'>
              <p class='font-mono text-obs-primary font-semibold'>
                Region #{info.regionId} · {info.neighbors.length} 个相邻单元
              </p>
              <p class='font-mono text-[10px] text-obs-text-muted'>
                坐标 {info.coordinates.latitudeDegrees >= 0 ? `${info.coordinates.latitudeDegrees.toFixed(2)}°N` : `${Math.abs(info.coordinates.latitudeDegrees).toFixed(2)}°S`},
                {info.coordinates.longitudeDegrees >= 0 ? `${info.coordinates.longitudeDegrees.toFixed(2)}°E` : `${Math.abs(info.coordinates.longitudeDegrees).toFixed(2)}°W`}
                · 面积 {info.regionFacts.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²
              </p>
              {#if info.featureHit}
                <p class='mt-0.5 rounded bg-obs-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-obs-primary'>
                  命中要素：{info.featureHit.featureId} ({info.featureHit.sourceId})
                </p>
              {/if}
              {#if info.pickedSettlement}
                <div class='mt-1 rounded border border-amber-400/25 bg-amber-400/8 p-1.5 text-[10px]'>
                  <div class='font-semibold text-amber-200'>
                    聚落：{info.pickedSettlement.name} · {settlementTierLabels[info.pickedSettlement.tier ?? 'town'] ?? '城镇'}{info.pickedSettlement.isPort ? ' · 港口' : ''}
                  </div>
                  <div class='text-obs-text-muted'>人口约 {formatPopulation(info.pickedSettlement.population)} · 建城于第 {info.pickedSettlement.foundedAtYear} 年</div>
                </div>
              {/if}
              {#if info.pickedPolity}
                {@const pickedArch = formatPolityArchetypeSummary(info.pickedPolity.archetypeId)}
                <div class='mt-1 rounded border border-sky-400/25 bg-sky-400/8 p-1.5 text-[10px]'>
                  <div class='font-semibold text-sky-200'>
                    政体：{info.pickedPolity.name}{info.pickedPolity.sizeClass ? ` · ${politySizeLabels[info.pickedPolity.sizeClass] ?? info.pickedPolity.sizeClass}` : ''}
                  </div>
                  {#if pickedArch}
                    <div class='text-obs-text-muted'>政体类型：{pickedArch.name} · {pickedArch.succession}</div>
                    <div class='text-obs-text-dim'>
                      元首：{pickedArch.headOfStateTitle}{pickedArch.headOfGovernmentTitle ? ` · 政府首脑：${pickedArch.headOfGovernmentTitle}` : ''}{pickedArch.legislatureTitle ? ` · 立法：${pickedArch.legislatureTitle}` : ''}
                    </div>
                  {/if}
                  {#if info.pickedPolityCapitalName}
                    <div class='text-obs-text-dim'>首都：{info.pickedPolityCapitalName} · 立国第 {info.pickedPolity.foundedAtYear} 年</div>
                  {/if}
                </div>
              {/if}
              {#if info.pickedTransportRoute}
                <div class='mt-1 rounded border border-emerald-400/25 bg-emerald-400/8 p-1.5 text-[10px]'>
                  <div class='font-semibold text-emerald-200'>
                    交通线路：{transportModeLabels[info.pickedTransportRoute.mode] ?? info.pickedTransportRoute.mode} ({info.pickedTransportRoute.id})
                  </div>
                  <div class='text-obs-text-muted'>
                    通行成本 {info.pickedTransportRoute.cost.toFixed(2)} · 流量指数 {info.pickedTransportRoute.trafficScore.toFixed(2)} · 途经 {info.pickedTransportRoute.regions.length} 个区域
                  </div>
                </div>
              {/if}
              {#if info.pickedCulture}
                {@const cultureArch = findCultureArchetype(info.pickedCulture.archetypeId)}
                <div class='mt-1 rounded border border-violet-400/25 bg-violet-400/8 p-1.5 text-[10px]'>
                  <div class='font-semibold text-violet-200'>文化：{info.pickedCulture.name}</div>
                  {#if cultureArch}
                    <div class='text-obs-text-muted'>原型：{translateContentKey(cultureArch.displayNameKey, appState.locale)}</div>
                  {/if}
                </div>
              {/if}
              {#if info.pickedReligion}
                {@const religionArch = findReligionArchetype(info.pickedReligion.archetypeId)}
                <div class='mt-1 rounded border border-rose-400/25 bg-rose-400/8 p-1.5 text-[10px]'>
                  <div class='font-semibold text-rose-200'>宗教：{info.pickedReligion.name}</div>
                  {#if religionArch}
                    <div class='text-obs-text-muted'>原型：{translateContentKey(religionArch.displayNameKey, appState.locale)} · 宽容度 {(religionArch.tolerance * 100).toFixed(0)}%</div>
                  {/if}
                </div>
              {/if}
            </div>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='地质与地形'>
              <dt class='text-obs-text-dim'>海陆与高程</dt>
              <dd>{info.regionFacts.land ? '陆地' : '海域'} · {info.regionFacts.elevationKm.toFixed(3)} km</dd>
              <dt class='text-obs-text-dim'>地形坡度</dt>
              <dd>{info.slopeDeg.toFixed(2)}°</dd>
              <dt class='text-obs-text-dim'>大陆 / 洋 / 海归属</dt>
              <dd>{info.continentLabel}</dd>
              <dt class='text-obs-text-dim'>构造板块 / 地壳</dt>
              <dd class='font-mono'>{info.regionFacts.plateId} · {info.regionFacts.crustType === 1 ? '大陆地壳' : '大洋地壳'}</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域气候'>
              <dt class='text-obs-text-dim'>第 {info.regionFacts.month + 1} 月气温 / 降水</dt>
              <dd>{info.regionFacts.temperatureC.toFixed(1)} °C / {info.regionFacts.precipitationMm.toFixed(1)} mm</dd>
              <dt class='text-obs-text-dim'>年均温 / 年总降水</dt>
              <dd>{info.regionFacts.annualMeanTemperatureC.toFixed(1)} °C / {info.regionFacts.annualPrecipitationMm.toFixed(0)} mm/年</dd>
              <dt class='text-obs-text-dim'>Köppen 气候带</dt>
              <dd>{koppenLabel}</dd>
              <dt class='text-obs-text-dim'>10m 月均风速</dt>
              <dd>{info.wind ? formatCirculationVector(info.wind.east, info.wind.north, 1) : '无数据'}</dd>
              <dt class='text-obs-text-dim'>表层洋流 / 暖度</dt>
              <dd>{info.ocean ? `${formatCirculationVector(info.ocean.east, info.ocean.north, 2)} (暖度 ${info.ocean.warmth.toFixed(2)})` : '无数据'}</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域生态'>
              <dt class='text-obs-text-dim'>潜在生物群系</dt>
              <dd>{biomeDef ? `${biomeDef.nameZh} · ${biomeDef.id}` : info.regionFacts.potentialBiomeId}</dd>
              <dt class='text-obs-text-dim'>自然地表覆盖</dt>
              <dd>{coverDef ? `${coverDef.nameZh} · ${coverDef.id}` : info.regionFacts.landCoverId}</dd>
              <dt class='text-obs-text-dim'>干旱指数 / 生长季</dt>
              <dd>{info.regionFacts.aridityIndex.toFixed(3)} / {info.regionFacts.growingSeasonMonths} 个月</dd>
            </dl>

            <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='区域水文'>
              <dt class='text-obs-text-dim'>月末积雪水当量</dt>
              <dd>{info.regionFacts.snowWaterEquivalentMm.toFixed(1)} mm</dd>
              <dt class='text-obs-text-dim'>年径流深</dt>
              <dd>{info.regionFacts.annualRunoffMm.toFixed(1)} mm/年</dd>
              <dt class='text-obs-text-dim'>汇流量 / 汇水面积</dt>
              <dd>{info.accumulatedFlowM3s.toFixed(2)} m³/s · {info.contributingAreaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
              <dt class='text-obs-text-dim'>下游流向</dt>
              <dd>{info.regionFacts.downstreamRegion < 0 ? (info.basin?.endorheic ? '内流汇点' : '海洋出口') : `Region #${info.regionFacts.downstreamRegion}`}</dd>
              <dt class='text-obs-text-dim'>所属流域</dt>
              <dd class='font-mono'>{info.regionFacts.basinId ?? '海洋'}</dd>
              {#if info.river}
                <dt class='text-obs-text-dim'>河道段详情</dt>
                <dd>{info.river.id} · {info.river.strahlerOrder} 级 · 年均流量 {info.river.annualMeanDischargeM3s.toFixed(1)} m³/s</dd>
              {/if}
              {#if info.lake}
                <dt class='text-obs-text-dim'>静态湖泊详情</dt>
                <dd>{info.lake.id} · {info.lake.endorheic ? '内流湖' : '外流湖'} · 面积 {info.lake.areaKm2.toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</dd>
              {/if}
            </dl>

            {#if info.hasResources}
              <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='自然资源潜力'>
                <dt class='text-obs-text-dim'>农 / 林 / 渔潜力</dt>
                <dd>{(info.regionFacts.agriculturalPotential * 100).toFixed(0)}% / {(info.regionFacts.forestryPotential * 100).toFixed(0)}% / {(info.regionFacts.fisheryPotential * 100).toFixed(0)}%</dd>
                {#if info.regionFacts.deposits.length > 0}
                  <dt class='text-obs-text-dim'>矿产与能源点</dt>
                  <dd class='flex flex-col gap-1'>
                    {#each info.regionFacts.deposits as deposit (deposit.id)}
                      <span>{formatResourceName(deposit.resourceId)} · 富集 {(deposit.richness * 100).toFixed(0)}%</span>
                    {/each}
                  </dd>
                {/if}
              </dl>
            {/if}

            {#if info.hasCivilization}
              {@const polityArch = info.dominantPolity ? formatPolityArchetypeSummary(info.dominantPolity.archetypeId) : null}
              {@const peopleArch = info.dominantPeople ? findPeopleArchetype(info.dominantPeople.archetypeId) : null}
              {@const cultureArch = info.dominantCulture ? findCultureArchetype(info.dominantCulture.archetypeId) : null}
              {@const religionArch = info.dominantReligion ? findReligionArchetype(info.dominantReligion.archetypeId) : null}
              <dl class='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5 border-t border-white/6 pt-2' aria-label='宜居与初始文明'>
                <dt class='text-obs-text-dim'>宜居度 / 承载力</dt>
                <dd>{(info.regionFacts.habitability * 100).toFixed(0)}% · {info.regionFacts.carryingCapacityPerKm2.toFixed(1)} 人/km²</dd>
                <dt class='text-obs-text-dim'>区域人口 / 密度</dt>
                <dd>{formatPopulation(info.regionFacts.population)} 人 · {info.regionFacts.populationDensity.toFixed(1)} 人/km²</dd>
                <dt class='text-obs-text-dim'>交通可达性</dt>
                <dd>{(info.regionFacts.transportAccessibility * 100).toFixed(0)}%</dd>
                <dt class='text-obs-text-dim'>主导族群 / 文化</dt>
                <dd>
                  {#if info.dominantPeople || info.dominantCulture}
                    {info.dominantPeople?.name ?? '无'}{peopleArch ? ` (${translateContentKey(peopleArch.displayNameKey, appState.locale)})` : ''}
                    ·
                    {info.dominantCulture?.name ?? '无'}{cultureArch ? ` (${translateContentKey(cultureArch.displayNameKey, appState.locale)})` : ''}
                  {:else}
                    无人定居
                  {/if}
                </dd>
                <dt class='text-obs-text-dim'>主导宗教</dt>
                <dd>
                  {#if info.dominantReligion}
                    {info.dominantReligion.name}{religionArch ? ` (${translateContentKey(religionArch.displayNameKey, appState.locale)})` : ''}
                  {:else}
                    无主导宗教
                  {/if}
                </dd>
                <dt class='text-obs-text-dim'>所属政体</dt>
                <dd>
                  {#if info.dominantPolity}
                    <div class='flex flex-col gap-0.5'>
                      <span>
                        {info.dominantPolity.name}{info.dominantPolity.sizeClass ? ` · ${politySizeLabels[info.dominantPolity.sizeClass] ?? info.dominantPolity.sizeClass}` : ''}
                      </span>
                      {#if polityArch}
                        <span class='text-[10px] text-obs-text-muted'>
                          {polityArch.name} · {polityArch.succession} · 元首：{polityArch.headOfStateTitle}
                        </span>
                      {/if}
                      {#if info.dominantPolityCapitalName}
                        <span class='text-[10px] text-obs-text-dim'>首都：{info.dominantPolityCapitalName}</span>
                      {/if}
                    </div>
                  {:else}
                    无归属边疆
                  {/if}
                </dd>
                {#if info.regionFacts.settlements.length > 0}
                  <dt class='text-obs-text-dim'>本地聚落</dt>
                  <dd class='flex flex-col gap-1'>
                    {#each info.regionFacts.settlements as settlement (settlement.id)}
                      <span>
                        {settlement.name} · {settlementTierLabels[settlement.tier ?? 'town'] ?? '城镇'}{settlement.isPort ? ' · 港口' : ''} ({formatPopulation(settlement.population)} 人)
                      </span>
                    {/each}
                  </dd>
                {/if}
                {#if info.regionPopulationGroups.length > 0}
                  <dt class='text-obs-text-dim'>人口构成</dt>
                  <dd class='flex flex-col gap-1 text-[10px]'>
                    {#each info.regionPopulationGroups.slice(0, 4) as group, index (`${group.peopleName}-${group.cultureName}-${index}`)}
                      <span class='text-obs-text-muted'>
                        {group.peopleName} / {group.cultureName}{group.religionName ? ` / ${group.religionName}` : ''} · {formatPopulation(group.population)} 人
                      </span>
                    {/each}
                  </dd>
                {/if}
              </dl>
            {/if}
          </div>
        </section>
      {:else}
        <div class='flex flex-col items-center gap-2 py-4 text-center text-xs text-obs-text-dim'>
          <Satellite class='h-6 w-6 animate-pulse text-obs-primary/60' />
          <span>点击行星地表区域，发射探针以获取环境数据</span>
        </div>
      {/if}
    </div>
  </aside>
{/if}
