<script lang='ts'>
  import { LocateFixed, Minus, Plus } from '@lucide/svelte'
  import { t } from '@/lib/i18n'

  interface Props {
    open: boolean
    onZoomIn: () => void
    onZoomOut: () => void
    onResetView: () => void
  }

  const { open, onZoomIn, onZoomOut, onResetView }: Props = $props()

  const buttonClass = 'flex h-9 w-9 cursor-pointer items-center justify-center text-obs-text-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obs-primary'
</script>

{#if open}
  <nav class='pointer-events-auto fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/85 text-obs-text-main shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md' aria-label={t('mapNavigation.label')}>
    <button type='button' class={buttonClass} aria-label={t('mapNavigation.zoomIn')} title={t('mapNavigation.zoomInTitle')} onclick={onZoomIn}>
      <Plus class='h-4 w-4' />
    </button>
    <div class='h-5 w-px bg-white/10'></div>
    <button type='button' class={buttonClass} aria-label={t('mapNavigation.zoomOut')} title={t('mapNavigation.zoomOutTitle')} onclick={onZoomOut}>
      <Minus class='h-4 w-4' />
    </button>
    <div class='h-5 w-px bg-white/10'></div>
    <button type='button' class={buttonClass} aria-label={t('mapNavigation.resetView')} title={t('mapNavigation.resetView')} onclick={onResetView}>
      <LocateFixed class='h-4 w-4' />
    </button>
  </nav>
{/if}
