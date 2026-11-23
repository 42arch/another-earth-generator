<script lang='ts'>
  import type { PolityTraitId, SettlementFeatureId } from '@another-earth/world-core'
  import type { GenerationController } from '@/lib/generation/controller'
  import type { MessageKey } from '@/lib/i18n'
  import type { GeographicSubject, ProbeFocus } from '@/ui/hud/probe-focus'
  import type { PolityCensus } from '@/world-view/polity-census'
  import { KOPPEN_CLASS_LABELS_ZH } from '@another-earth/cartography'
  import { KOPPEN_CODES } from '@another-earth/world-core'
  import { NATURAL_BIOME_DEFINITIONS, NATURAL_LAND_COVER_DEFINITIONS } from '@another-earth/world-data'
  import { Satellite, X } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import {
    findCultureArchetype,
    findPolityArchetype,
    findPolityTrait,
    findReligionArchetype,
    findResourceDefinition,
    translateContentKey,
  } from '@/lib/generation/builtin-content'
  import { t } from '@/lib/i18n'
  import Badge from '@/ui/components/Badge.svelte'
  import { probeFocusBadge, probeFocusTitle } from '@/ui/hud/probe-focus'
  import { appState } from '@/ui/state/app.svelte'

  type PolitySummary = NonNullable<ReturnType<GenerationController['queryWorldPolity']>>
  type SettlementSummary = NonNullable<ReturnType<GenerationController['queryWorldSettlement']>>

  interface PolitySubject {
    readonly polity: PolitySummary
    readonly capitalName: string | null
    readonly census: PolityCensus | null
  }

  interface RegionInspection {
    readonly regionId: number
    readonly coordinates: { readonly longitudeDegrees: number, readonly latitudeDegrees: number }
    readonly focus: ProbeFocus
    readonly neighbors: readonly number[]
    readonly slopeDeg: number
    readonly regionFacts: ReturnType<GenerationController['queryWorldRegion']>
    readonly continentLabel: string
    readonly geographicAreaKm2: number | null
    readonly basin: ReturnType<GenerationController['queryWorldBasin']>
    readonly river: ReturnType<GenerationController['queryWorldRiver']>
    readonly lake: ReturnType<GenerationController['queryWorldLake']>
    readonly wind: { readonly east: number, readonly north: number } | null
    readonly ocean: { readonly east: number, readonly north: number, readonly warmth: number } | null
    readonly annualWindSpeedMps: number | null
    readonly annualOceanSpeedMps: number | null
    readonly hasResources: boolean
    readonly hasCivilization: boolean
    readonly settlement: SettlementSummary | null
    readonly culture: ReturnType<GenerationController['queryWorldCulture']>
    readonly religion: ReturnType<GenerationController['queryWorldReligion']>
    readonly politySubjects: readonly PolitySubject[]
    readonly polityUnassigned: boolean
    readonly polityFrontier: boolean
    readonly transportRoute: ReturnType<GenerationController['queryWorldTransportRoute']>
    readonly labelSubject: GeographicSubject | null
    readonly plateBoundaryLabels: readonly [string, string] | null
    readonly graticuleLabel: string | null
  }

  interface Props {
    open: boolean
    inspection: RegionInspection | null
  }

  const { open, inspection }: Props = $props()
  const compassDirections = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const
  const factGrid = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-2 gap-y-1.5'
  const noteClass = 'text-[11px] leading-relaxed text-obs-text-muted'

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

  function formatCoordinates(longitudeDegrees: number, latitudeDegrees: number): string {
    const latitude = latitudeDegrees >= 0
      ? `${latitudeDegrees.toFixed(2)}°N`
      : `${Math.abs(latitudeDegrees).toFixed(2)}°S`
    const longitude = longitudeDegrees >= 0
      ? `${longitudeDegrees.toFixed(2)}°E`
      : `${Math.abs(longitudeDegrees).toFixed(2)}°W`
    return `${latitude}, ${longitude}`
  }

  function formatArea(km2: number): string {
    return `${km2.toLocaleString(undefined, { maximumFractionDigits: km2 >= 100 ? 0 : 1 })} km²`
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

  function formatSpeed(value: number | null): string {
    if (value === null || !Number.isFinite(value))
      return '无数据'
    return `${value.toFixed(1)} m/s`
  }

  function formatPopulation(value: number): string {
    if (!Number.isFinite(value) || value <= 0)
      return '0'
    return Math.round(value).toLocaleString(appState.locale)
  }

  function formatRunoffVolume(cubicMeters: number): string {
    if (cubicMeters >= 1e9)
      return `${(cubicMeters / 1e9).toFixed(2)} km³/年`
    return `${cubicMeters.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³/年`
  }

  function formatSettlementFeature(featureId: SettlementFeatureId): string {
    return t(`civilization.settlementFeatures.${featureId}` as MessageKey)
  }

  function formatPolityTrait(traitId: PolityTraitId): string {
    const definition = findPolityTrait(traitId)
    return definition ? translateContentKey(definition.displayNameKey, appState.locale) : traitId
  }

  function polityTraitDescription(traitId: PolityTraitId): string {
    const definition = findPolityTrait(traitId)
    return definition ? translateContentKey(definition.descriptionKey, appState.locale) : ''
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
  {@const title = inspection ? probeFocusTitle(inspection.focus) : '行星探针读数'}
  {@const badge = inspection ? probeFocusBadge(inspection.focus) : null}
  <aside transition:fly={{ x: -300, duration: 200 }} class='pointer-events-auto fixed bottom-4 left-[calc(var(--app-sidebar-inset)+var(--app-sidebar-width)+0.75rem)] z-30 w-[340px] max-w-[calc(100vw-var(--app-sidebar-width)-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md'>
    <header class='flex items-center justify-between border-b border-white/6 px-4 py-2 select-none'>
      <div class='flex min-w-0 items-center gap-2'>
        <Satellite class='h-4 w-4 shrink-0 text-obs-primary' />
        <h2 class='m-0 truncate pt-[2px] font-heading text-[13px] font-bold tracking-wide'>{title}</h2>
      </div>
      <div class='flex items-center gap-2'>
        {#if badge}<Badge variant='slate' class='font-mono text-[9px] tracking-wider py-0.5 px-1.5'>{badge}</Badge>{/if}
        <button type='button' onclick={() => appState.inspectorOpen = false} class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/6 hover:text-obs-text-main' title='关闭探针面板' aria-label='关闭探针面板'><X class='h-4 w-4' /></button>
      </div>
    </header>
    <div class='custom-scrollbar max-h-[calc(100dvh-12rem)] overflow-y-auto p-3.5 text-xs'>
      {#if inspection}
        {@const info = inspection}
        {@const focus = info.focus}
        {@const facts = info.regionFacts}
        {@const coords = formatCoordinates(info.coordinates.longitudeDegrees, info.coordinates.latitudeDegrees)}
        <section class='flex flex-col gap-2.5 rounded-lg border border-white/6 bg-white/2 p-2.5' aria-label={title}>
          <p class='font-mono text-[10px] text-obs-text-muted'>{coords}</p>

          {#if focus.kind === 'surface'}
            <dl class={factGrid} aria-label='地表'>
              <dt class='text-obs-text-dim'>海陆</dt>
              <dd>{facts.land ? '陆地' : '海域'}</dd>
              <dt class='text-obs-text-dim'>高程</dt>
              <dd>{facts.elevationKm.toFixed(3)} km</dd>
              <dt class='text-obs-text-dim'>坡度</dt>
              <dd>{info.slopeDeg.toFixed(2)}°</dd>
              <dt class='text-obs-text-dim'>单元面积</dt>
              <dd>{formatArea(facts.areaKm2)}</dd>
            </dl>
          {:else if focus.kind === 'thematic' && (focus.id === 'elevation' || focus.id === 'dem')}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>海陆</dt>
              <dd>{facts.land ? '陆地' : '海域'}</dd>
              <dt class='text-obs-text-dim'>高程</dt>
              <dd>{facts.elevationKm.toFixed(3)} km</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'plates'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>板块</dt>
              <dd class='font-mono'>{facts.plateId}</dd>
              <dt class='text-obs-text-dim'>地壳</dt>
              <dd>{facts.crustType === 1 ? '大陆地壳' : '大洋地壳'}</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'continents'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>陆海分区</dt>
              <dd>{info.continentLabel}</dd>
              {#if info.geographicAreaKm2 !== null}
                <dt class='text-obs-text-dim'>分区面积</dt>
                <dd>{formatArea(info.geographicAreaKm2)}</dd>
              {/if}
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'temperature'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>第 {facts.month + 1} 月气温</dt>
              <dd>{facts.temperatureC.toFixed(1)} °C</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'annual-temperature'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>年平均气温</dt>
              <dd>{facts.annualMeanTemperatureC.toFixed(1)} °C</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'precipitation'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>第 {facts.month + 1} 月降水</dt>
              <dd>{facts.precipitationMm.toFixed(1)} mm</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'annual-precipitation'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>年降水量</dt>
              <dd>{facts.annualPrecipitationMm.toFixed(0)} mm/年</dd>
            </dl>
          {:else if (focus.kind === 'thematic' && focus.id === 'wind-speed') || (focus.kind === 'overlay' && focus.id === 'wind-arrows')}
            <p class={noteClass}>{info.wind ? formatCirculationVector(info.wind.east, info.wind.north, 1) : '无环流数据'}</p>
          {:else if focus.kind === 'thematic' && focus.id === 'annual-wind-speed'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>年平均风速</dt>
              <dd>{formatSpeed(info.annualWindSpeedMps)}</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'ocean-speed'}
            <p class={noteClass}>{facts.land ? '陆地，无表层洋流' : info.ocean ? formatCirculationVector(info.ocean.east, info.ocean.north, 2) : '无环流数据'}</p>
          {:else if focus.kind === 'thematic' && focus.id === 'annual-ocean-speed'}
            <p class={noteClass}>{facts.land ? '陆地，无表层洋流' : formatSpeed(info.annualOceanSpeedMps)}</p>
          {:else if focus.kind === 'overlay' && focus.id === 'ocean-arrows'}
            <p class={noteClass}>
              {#if facts.land}
                陆地，无表层洋流
              {:else if info.ocean}
                {formatCirculationVector(info.ocean.east, info.ocean.north, 2)} · 暖度 {info.ocean.warmth.toFixed(2)}
              {:else}
                无环流数据
              {/if}
            </p>
          {:else if focus.kind === 'thematic' && focus.id === 'snow'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>第 {facts.month + 1} 月积雪水当量</dt>
              <dd>{facts.snowWaterEquivalentMm.toFixed(1)} mm</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'runoff'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>年径流深</dt>
              <dd>{facts.annualRunoffMm.toFixed(1)} mm/年</dd>
            </dl>
          {:else if focus.kind === 'thematic' && focus.id === 'basins'}
            {#if info.basin}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>流域</dt>
                <dd class='font-mono'>{info.basin.id}</dd>
                <dt class='text-obs-text-dim'>类型</dt>
                <dd>{info.basin.endorheic ? '内流流域' : '外流流域'}</dd>
                <dt class='text-obs-text-dim'>流域面积</dt>
                <dd>{formatArea(info.basin.areaKm2)}</dd>
                <dt class='text-obs-text-dim'>年径流总量</dt>
                <dd>{formatRunoffVolume(info.basin.annualRunoffM3)}</dd>
              </dl>
            {:else}
              <p class={noteClass}>此处不在陆地流域内</p>
            {/if}
          {:else if focus.kind === 'thematic' && focus.id === 'koppen'}
            {@const koppenCode = KOPPEN_CODES[facts.koppenClass] ?? 'Ocean'}
            {@const koppenLabel = KOPPEN_CLASS_LABELS_ZH[facts.koppenClass] ?? koppenCode}
            <p class={noteClass}>{koppenLabel}</p>
          {:else if focus.kind === 'thematic' && focus.id === 'biomes'}
            {@const biomeDef = NATURAL_BIOME_DEFINITIONS.find(d => d.id === facts.potentialBiomeId)}
            <p class={noteClass}>{facts.land ? (biomeDef ? `${biomeDef.nameZh} · ${biomeDef.id}` : facts.potentialBiomeId) : '海洋'}</p>
          {:else if focus.kind === 'thematic' && focus.id === 'land-cover'}
            {@const coverDef = NATURAL_LAND_COVER_DEFINITIONS.find(d => d.id === facts.landCoverId)}
            <p class={noteClass}>{facts.land ? (coverDef ? `${coverDef.nameZh} · ${coverDef.id}` : facts.landCoverId) : '海洋'}</p>
          {:else if focus.kind === 'thematic' && focus.id === 'agricultural-potential'}
            {#if !info.hasResources}
              <p class={noteClass}>当前世界没有资源数据</p>
            {:else if !facts.land}
              <p class={noteClass}>海洋，无农业潜力</p>
            {:else}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>农业潜力</dt>
                <dd>{(facts.agriculturalPotential * 100).toFixed(0)}%</dd>
              </dl>
            {/if}
          {:else if focus.kind === 'thematic' && focus.id === 'deposit-richness'}
            {#if !info.hasResources}
              <p class={noteClass}>当前世界没有资源数据</p>
            {:else if !facts.land}
              <p class={noteClass}>海洋，无矿产富集</p>
            {:else if facts.deposits.length === 0}
              <p class={noteClass}>此处没有矿产或能源点</p>
            {:else}
              <ul class='flex flex-col gap-1 text-[11px]'>
                {#each facts.deposits as deposit (deposit.id)}
                  <li>{formatResourceName(deposit.resourceId)} · 富集 {(deposit.richness * 100).toFixed(0)}%</li>
                {/each}
              </ul>
            {/if}
          {:else if focus.kind === 'thematic' && focus.id === 'population-density'}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if !facts.land}
              <p class={noteClass}>海洋</p>
            {:else}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>人口密度</dt>
                <dd>{facts.populationDensity.toFixed(1)} 人/km²</dd>
                <dt class='text-obs-text-dim'>区域人口</dt>
                <dd>{formatPopulation(facts.population)} 人</dd>
              </dl>
            {/if}
          {:else if (focus.kind === 'thematic' && focus.id === 'polity-territory') || (focus.kind === 'overlay' && (focus.id === 'polity-borders' || focus.id === 'polity-labels'))}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if info.polityUnassigned}
              <p class={noteClass}>无归属地</p>
            {:else if info.politySubjects.length === 0}
              <p class={noteClass}>此处没有国家政区</p>
            {:else}
              <div class='flex flex-col gap-1.5'>
                {#each info.politySubjects as subject (subject.polity.id)}
                  {@const pickedArch = formatPolityArchetypeSummary(subject.polity.archetypeId)}
                  <div class='rounded border border-sky-400/25 bg-sky-400/8 p-1.5 text-[10px]'>
                    <div class='font-semibold text-sky-200'>
                      {subject.polity.name}{subject.polity.sizeClass ? ` · ${politySizeLabels[subject.polity.sizeClass] ?? subject.polity.sizeClass}` : ''}
                    </div>
                    {#if subject.polity.traits.length > 0}
                      <div class='mt-1 flex flex-wrap gap-1'>
                        {#each subject.polity.traits as trait (trait)}
                          <span class='rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-100' title={polityTraitDescription(trait)}>{formatPolityTrait(trait)}</span>
                        {/each}
                      </div>
                    {/if}
                    {#if pickedArch}
                      <div class='mt-0.5 text-obs-text-muted'>政体类型：{pickedArch.name} · {pickedArch.succession}</div>
                      <div class='text-obs-text-dim'>
                        元首：{pickedArch.headOfStateTitle}{pickedArch.headOfGovernmentTitle ? ` · 政府首脑：${pickedArch.headOfGovernmentTitle}` : ''}{pickedArch.legislatureTitle ? ` · 立法：${pickedArch.legislatureTitle}` : ''}
                      </div>
                    {/if}
                    {#if subject.capitalName}
                      <div class='text-obs-text-dim'>首都：{subject.capitalName} · 立国第 {subject.polity.foundedAtYear} 年</div>
                    {/if}
                    {#if subject.census}
                      <div class='mt-1 text-obs-text-muted'>
                        人口 {formatPopulation(subject.census.population)} · 面积 {formatArea(subject.census.areaKm2)} · 密度 {subject.census.densityPerKm2.toFixed(1)} 人/km²
                      </div>
                      <div class='text-obs-text-dim'>
                        聚落 {subject.census.settlementCount} · 首都 {subject.census.capitalCount} · 城市 {subject.census.cityCount} · 城镇 {subject.census.townCount} · 村落 {subject.census.villageCount}{subject.census.portCount > 0 ? ` · 港口 ${subject.census.portCount}` : ''}
                      </div>
                      {#if subject.census.leadingSettlements.length > 0}
                        <div class='mt-1 flex flex-col gap-0.5 text-obs-text-dim'>
                          {#each subject.census.leadingSettlements as place (place.id)}
                            <span>{place.name} · {settlementTierLabels[place.tier] ?? '城镇'}{place.isPort ? ' · 港口' : ''} · {formatPopulation(place.population)} 人</span>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/each}
                {#if info.polityFrontier}
                  <p class={noteClass}>另一侧为无归属地</p>
                {/if}
              </div>
            {/if}
          {:else if focus.kind === 'thematic' && focus.id === 'culture-dominant'}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if info.culture}
              {@const cultureArch = findCultureArchetype(info.culture.archetypeId)}
              <div class='rounded border border-violet-400/25 bg-violet-400/8 p-1.5 text-[10px]'>
                <div class='font-semibold text-violet-200'>{info.culture.name}</div>
                {#if cultureArch}
                  <div class='text-obs-text-muted'>原型：{translateContentKey(cultureArch.displayNameKey, appState.locale)}</div>
                {/if}
              </div>
            {:else}
              <p class={noteClass}>此处没有主导文化</p>
            {/if}
          {:else if focus.kind === 'thematic' && focus.id === 'religion-dominant'}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if info.religion}
              {@const religionArch = findReligionArchetype(info.religion.archetypeId)}
              <div class='rounded border border-rose-400/25 bg-rose-400/8 p-1.5 text-[10px]'>
                <div class='font-semibold text-rose-200'>{info.religion.name}</div>
                {#if religionArch}
                  <div class='text-obs-text-muted'>原型：{translateContentKey(religionArch.displayNameKey, appState.locale)} · 宽容度 {(religionArch.tolerance * 100).toFixed(0)}%</div>
                {/if}
              </div>
            {:else}
              <p class={noteClass}>此处没有主导宗教</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'rivers'}
            {#if info.river}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>河道</dt>
                <dd class='font-mono'>{info.river.id}</dd>
                <dt class='text-obs-text-dim'>斯特拉勒等级</dt>
                <dd>{info.river.strahlerOrder} 级</dd>
                <dt class='text-obs-text-dim'>年均流量</dt>
                <dd>{info.river.annualMeanDischargeM3s.toFixed(1)} m³/s</dd>
                <dt class='text-obs-text-dim'>类型</dt>
                <dd>{info.river.endorheic ? '内流河' : '外流河'}</dd>
              </dl>
            {:else}
              <p class={noteClass}>没有读到这条河流</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'lakes'}
            {#if info.lake}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>湖泊</dt>
                <dd class='font-mono'>{info.lake.id}</dd>
                <dt class='text-obs-text-dim'>类型</dt>
                <dd>{info.lake.endorheic ? '内流湖' : '外流湖'}</dd>
                <dt class='text-obs-text-dim'>面积</dt>
                <dd>{formatArea(info.lake.areaKm2)}</dd>
                <dt class='text-obs-text-dim'>水位</dt>
                <dd>{info.lake.waterLevelKm.toFixed(3)} km</dd>
              </dl>
            {:else}
              <p class={noteClass}>没有读到这片湖泊</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'coastlines'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>采样点</dt>
              <dd>{facts.land ? '陆地一侧' : '海域一侧'}</dd>
              <dt class='text-obs-text-dim'>高程</dt>
              <dd>{facts.elevationKm.toFixed(3)} km</dd>
            </dl>
          {:else if focus.kind === 'overlay' && focus.id === 'plate-boundaries'}
            {#if info.plateBoundaryLabels}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>一侧</dt>
                <dd>{info.plateBoundaryLabels[0]}</dd>
                <dt class='text-obs-text-dim'>另一侧</dt>
                <dd>{info.plateBoundaryLabels[1]}</dd>
              </dl>
            {:else}
              <p class={noteClass}>没有读到这条板块边界</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'labels'}
            {#if info.labelSubject}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>名称</dt>
                <dd>{info.labelSubject.name}</dd>
                <dt class='text-obs-text-dim'>面积</dt>
                <dd>{formatArea(info.labelSubject.areaKm2)}</dd>
              </dl>
            {:else}
              <p class={noteClass}>没有读到这个地名</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'graticule'}
            <p class={noteClass}>{info.graticuleLabel ?? '经纬网'}</p>
          {:else if focus.kind === 'overlay' && focus.id === 'cell-wireframe'}
            <dl class={factGrid} aria-label={title}>
              <dt class='text-obs-text-dim'>区域</dt>
              <dd class='font-mono'>#{info.regionId}</dd>
              <dt class='text-obs-text-dim'>相邻单元</dt>
              <dd>{info.neighbors.length}</dd>
              <dt class='text-obs-text-dim'>面积</dt>
              <dd>{formatArea(facts.areaKm2)}</dd>
            </dl>
          {:else if focus.kind === 'overlay' && (focus.id === 'settlements' || focus.id === 'settlement-labels')}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if info.settlement}
              <div class='rounded border border-amber-400/25 bg-amber-400/8 p-1.5 text-[10px]'>
                <div class='font-semibold text-amber-200'>
                  {info.settlement.name} · {settlementTierLabels[info.settlement.tier ?? 'town'] ?? '城镇'}{info.settlement.isPort ? ' · 港口' : ''}
                </div>
                <div class='text-obs-text-muted'>人口约 {formatPopulation(info.settlement.population)} · 建城于第 {info.settlement.foundedAtYear} 年</div>
                {#if info.settlement.features.length > 0}
                  <div class='mt-1 flex flex-wrap gap-1'>
                    {#each info.settlement.features as feature (feature)}
                      <span class='rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-100'>{formatSettlementFeature(feature)}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <p class={noteClass}>没有读到这个聚落</p>
            {/if}
          {:else if focus.kind === 'overlay' && focus.id === 'transport-routes'}
            {#if !info.hasCivilization}
              <p class={noteClass}>当前世界没有文明数据</p>
            {:else if info.transportRoute}
              <dl class={factGrid} aria-label={title}>
                <dt class='text-obs-text-dim'>线路</dt>
                <dd>{transportModeLabels[info.transportRoute.mode] ?? info.transportRoute.mode}</dd>
                <dt class='text-obs-text-dim'>通行成本</dt>
                <dd>{info.transportRoute.cost.toFixed(2)}</dd>
                <dt class='text-obs-text-dim'>流量指数</dt>
                <dd>{info.transportRoute.trafficScore.toFixed(2)}</dd>
                <dt class='text-obs-text-dim'>途经区域</dt>
                <dd>{info.transportRoute.regions.length}</dd>
              </dl>
            {:else}
              <p class={noteClass}>没有读到这条航路</p>
            {/if}
          {:else}
            <p class={noteClass}>这一层在此处没有单独读数</p>
          {/if}
        </section>
      {:else}
        <div class='flex flex-col items-center gap-2 py-4 text-center text-xs text-obs-text-dim'>
          <Satellite class='h-6 w-6 animate-pulse text-obs-primary/60' />
          <span>点击地图上的图层，只查看这一层在该位置的读数</span>
        </div>
      {/if}
    </div>
  </aside>
{/if}
