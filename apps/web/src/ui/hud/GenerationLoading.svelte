<script lang='ts'>
  import { Orbit } from '@lucide/svelte'
  import { Progress } from 'bits-ui'
  import { fade } from 'svelte/transition'

  const pipelineStageLabels: Record<string, string> = {
    'mesh': '正在构建球面拓扑网格…',
    'reference-mesh': '正在构建参考球面网格…',
    'reference-subdivisions': '正在细分参考网格…',
    'plate-topology': '正在生成构造板块…',
    'continental-crust': '正在生成大陆地壳…',
    'plate-dynamics': '正在计算板块运动…',
    'tectonics': '正在计算构造骨架…',
    'tectonic-elevation': '正在塑造基础高程…',
    'geology': '正在完成地质投影…',
    'terrain': '正在生成地形…',
    'geographic-regions': '正在划分大陆、洋与海…',
    'geographic-names': '正在命名大陆与大洋…',
    'climate-c0': '正在计算初步气候…',
    'cryosphere-i0': '正在计算积雪与融雪…',
    'hydrology-h0': '正在生成初步径流与河网…',
    'static-lakes-l1': '正在识别静态洼地湖泊…',
    'ecology-e0': '正在生成初步生态分类…',
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
    return pipelineStageLabels[stageId] ?? `正在执行：${stageId}`
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
        return `正在生成 L${state.level} · 扰动 ${state.irregularity.toFixed(2)}…`
      case 'pipeline':
        return `${getPipelineStageLabel(state.stageId ?? 'mesh')} ${Math.round(state.progress * 100)}%`
      case 'completed':
        return `L${state.level} · 扰动 ${state.irregularity.toFixed(2)} 完整自然世界已就绪`
      case 'cancelled':
        return `${state.hasPublishedWorld ? '生成已取消，保留当前已发布世界。' : '生成已取消。'}${state.cacheCleared ? 'Worker 缓存已清空。' : ''}`
      case 'failed':
        return state.hasPublishedWorld ? '生成失败，已保留上一个有效世界。' : '生成失败。'
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
    aria-label='正在生成世界'
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
      <Progress.Root value={percent} class='relative w-48 h-0.5 bg-white/8 rounded-full my-3 overflow-hidden' aria-label='生成进度'>
        <div class='absolute top-0 left-0 h-full bg-obs-primary rounded-full transition-[width] duration-200' style={`width: ${percent}%`}></div>
      </Progress.Root>
      <p class='font-sans text-xs text-obs-text-dim m-0 flex items-center gap-1.5'>
        <Orbit class='w-3 h-3 text-obs-primary shrink-0 animate-spin motion-reduce:animate-none' style='animation-duration: 4s;' />
        <span>{message}</span>
      </p>
      <button type='button' class='mt-5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-obs-text-muted hover:bg-white/10 hover:text-white disabled:opacity-40' onclick={onCancel} disabled={cancelDisabled}>
        取消生成
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
