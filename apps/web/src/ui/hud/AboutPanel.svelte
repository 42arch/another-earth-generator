<script lang='ts'>
  import { ArrowUpRight, X } from '@lucide/svelte'
  import { t } from '@/lib/i18n'
  import webPackage from '../../../package.json'

  interface Props {
    open: boolean
    onClose: () => void
  }

  const { open, onClose }: Props = $props()
  const version = webPackage.version
  const repositoryUrl = 'https://github.com/42arch/another-earth-generator'
  const issuesUrl = `${repositoryUrl}/issues/new`

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape')
      onClose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class='pointer-events-auto fixed inset-0 z-60 bg-black/40 backdrop-blur-sm'
  >
    <button type='button' class='absolute inset-0 h-full w-full cursor-default' aria-label={t('about.close')} onclick={onClose}></button>
    <div
      class='absolute top-[12vh] left-1/2 z-10 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-white/10 bg-[#1e1e20]/85 p-4 text-obs-text-main shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-md'
      role='dialog'
      aria-modal='true'
      aria-labelledby='about-panel-title'
      aria-describedby='about-panel-description'
    >
      <header class='mb-3 flex items-start justify-between gap-3'>
        <div>
          <p class='mb-1 mt-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-obs-primary'>{t('about.eyebrow')}</p>
          <div class='flex items-center gap-1.5'>
            <h2 id='about-panel-title' class='m-0 font-heading text-[13px] font-bold tracking-wide'>Another Earth Generator</h2>
            <span class='rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-obs-text-muted'>v{version}</span>
          </div>
        </div>
        <button type='button' class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/10 hover:text-white' title={t('about.close')} aria-label={t('about.close')} onclick={onClose}>
          <X class='h-4 w-4' />
        </button>
      </header>

      <p id='about-panel-description' class='mb-3 mt-0 text-[11px] leading-relaxed text-obs-text-muted'>{t('about.description')}</p>

      <div class='flex gap-2'>
        <a
          class='flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-[10px] text-obs-text-main transition-colors hover:border-obs-primary/40 hover:bg-white/8'
          href={repositoryUrl}
          target='_blank'
          rel='noreferrer'
        >
          <span class='truncate'>{t('about.repository')}</span>
          <ArrowUpRight class='h-3.5 w-3.5 shrink-0 text-obs-text-muted' />
        </a>
        <a
          class='flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-[10px] text-obs-text-main transition-colors hover:border-obs-primary/40 hover:bg-white/8'
          href={issuesUrl}
          target='_blank'
          rel='noreferrer'
        >
          <span class='truncate'>{t('about.feedback')}</span>
          <ArrowUpRight class='h-3.5 w-3.5 shrink-0 text-obs-text-muted' />
        </a>
      </div>
    </div>
  </div>
{/if}
