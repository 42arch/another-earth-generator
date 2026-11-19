<script lang='ts'>
  import type { MessageKey } from '@/lib/i18n'
  import { Orbit } from '@lucide/svelte'
  import { Progress } from 'bits-ui'
  import { fade } from 'svelte/transition'
  import { t } from '@/lib/i18n'

  const pipelineStageKeys: Record<string, MessageKey> = {
    'mesh': 'generation.stages.mesh',
    'reference-mesh': 'generation.stages.referenceMesh',
    'reference-subdivisions': 'generation.stages.referenceSubdivisions',
    'plate-topology': 'generation.stages.plateTopology',
    'continental-crust': 'generation.stages.continentalCrust',
    'plate-dynamics': 'generation.stages.plateDynamics',
    'tectonics': 'generation.stages.tectonics',
    'tectonic-elevation': 'generation.stages.tectonicElevation',
    'geology': 'generation.stages.geology',
    'terrain': 'generation.stages.terrain',
    'geographic-regions': 'generation.stages.geographicRegions',
    'geographic-names': 'generation.stages.geographicNames',
    'climate-c0': 'generation.stages.climateC0',
    'cryosphere-i0': 'generation.stages.cryosphereI0',
    'hydrology-h0': 'generation.stages.hydrologyH0',
    'static-lakes-l1': 'generation.stages.staticLakesL1',
    'ecology-e0': 'generation.stages.ecologyE0',
  }

  type State
    = | { status: 'idle' }
      | { status: 'starting', level: number, irregularity: number }
      | { status: 'pipeline', stageId?: string, progress: number }
      | { status: 'completed', level: number, irregularity: number }
      | { status: 'cancelled', hasPublishedWorld: boolean, cacheCleared: boolean }
      | { status: 'failed', hasPublishedWorld: boolean }

  interface Props {
    active: boolean
    state: State
    onCancel: () => void
    cancelDisabled?: boolean
  }

  const { active, state, onCancel, cancelDisabled = false }: Props = $props()

  function getPipelineStageLabel(stageId: string): string {
    const key = pipelineStageKeys[stageId]
    return key ? t(key) : t('generation.executing', { stageId })
  }

  const progress = $derived(
    state.status === 'pipeline'
      ? state.progress
      : state.status === 'completed'
      ? 1
      : 0,
  )

  const message = $derived.by(() => {
    switch (state.status) {
      case 'starting':
        return t('generation.starting', { level: state.level, irregularity: state.irregularity.toFixed(2) })
      case 'pipeline':
        return `${getPipelineStageLabel(state.stageId ?? 'mesh')} ${Math.round(state.progress * 100)}%`
      case 'completed':
        return t('generation.completed', { level: state.level, irregularity: state.irregularity.toFixed(2) })
      case 'cancelled':
        return [
          t(state.hasPublishedWorld ? 'generation.cancelledWithWorld' : 'generation.cancelled'),
          state.cacheCleared ? t('generation.cacheCleared') : '',
        ].filter(Boolean).join(' ')
      case 'failed':
        return t(state.hasPublishedWorld ? 'generation.failedWithWorld' : 'generation.failed')
      case 'idle':
        return ''
    }
  })

  const percent = $derived(Math.max(0, Math.min(100, Math.round(progress * 100))))
</script>

{#if active}
  <div
    transition:fade={{ duration: 250 }}
    class='pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070a0f]/50 backdrop-blur-lg select-none'
    role='status'
    aria-live='polite'
    aria-label={t('generation.ariaLabel')}
  >
    <div class='globe-container relative flex items-center justify-center w-32 h-32 mb-8' aria-hidden='true'>
      <div class='globe relative w-full h-full rounded-full'>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20 transform-[rotateY(30deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20 transform-[rotateY(60deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20 transform-[rotateY(90deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20 transform-[rotateY(120deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/20 transform-[rotateY(150deg)]'></div>
        <div class='absolute inset-0 rounded-full border border-obs-primary/30 transform-[rotateX(90deg)]'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 124px; height: 124px; left: 2px; top: 2px; transform: translateY(-16px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 124px; height: 124px; left: 2px; top: 2px; transform: translateY(16px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 111px; height: 111px; left: 8.5px; top: 8.5px; transform: translateY(-32px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 111px; height: 111px; left: 8.5px; top: 8.5px; transform: translateY(32px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 85px; height: 85px; left: 21.5px; top: 21.5px; transform: translateY(-48px) rotateX(90deg)'></div>
        <div class='absolute rounded-full border border-obs-primary/10' style='width: 85px; height: 85px; left: 21.5px; top: 21.5px; transform: translateY(48px) rotateX(90deg)'></div>
      </div>
      <div class='absolute inset-0 rounded-full overflow-hidden'>
        <div class='w-full h-full bg-linear-to-b from-transparent via-obs-primary/5 to-obs-primary/10 border-b border-obs-primary/30 animate-[radar_2s_linear_infinite] motion-reduce:animate-none'></div>
      </div>
    </div>

    <div class='flex flex-col items-center text-center px-4 max-w-sm z-10'>
      <h2 class='font-heading text-lg font-bold tracking-[0.18em] uppercase text-obs-text-main m-0'>Another Earth Generator</h2>
      <Progress.Root value={percent} class='relative w-48 h-0.5 bg-white/8 rounded-full my-3 overflow-hidden' aria-label={t('generation.progress')}>
        <div class='absolute top-0 left-0 h-full bg-obs-primary rounded-full transition-[width] duration-200' style={`width: ${percent}%`}></div>
      </Progress.Root>
      <p class='font-sans text-xs text-obs-text-dim m-0 flex items-center gap-1.5'>
        <Orbit class='w-3 h-3 text-obs-primary shrink-0 animate-spin motion-reduce:animate-none' style='animation-duration: 4s;' />
        <span>{message}</span>
      </p>
      <button type='button' class='mt-5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-obs-text-muted hover:bg-white/10 hover:text-white disabled:opacity-40' onclick={onCancel} disabled={cancelDisabled}>
        {t('generation.cancel')}
      </button>
    </div>
  </div>
{/if}

<style>
  .globe-container { perspective: 800px; }
  .globe { transform-style: preserve-3d; animation: rotate-globe 12s linear infinite; }
  @keyframes rotate-globe {
    0% { transform: rotateX(20deg) rotateY(0deg); }
    100% { transform: rotateX(20deg) rotateY(360deg); }
  }
  @keyframes radar {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .globe { animation: none; }
  }
</style>
