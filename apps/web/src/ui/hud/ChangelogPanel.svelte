<script lang='ts'>
  import { X } from '@lucide/svelte'
  import { changelog } from '@/lib/changelog'
  import { t } from '@/lib/i18n'
  import { appState } from '@/ui/state/app.svelte'

  function categoryTitle(title: string | null): string {
    if (!title)
      return ''
    switch (title) {
      case 'chore': return t('changelog.categories.chore')
      case 'feat': return t('changelog.categories.feat')
      case 'fix': return t('changelog.categories.fix')
      case 'Patch Changes': return t('changelog.categories.patchChanges')
      case 'Minor Changes': return t('changelog.categories.minorChanges')
      case 'Major Changes': return t('changelog.categories.majorChanges')
      case 'Refactors': return t('changelog.categories.refactors')
      default: return title
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape')
      appState.changelogOpen = false
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if appState.changelogOpen}
  <div class='pointer-events-auto fixed inset-0 z-60 bg-black/40 backdrop-blur-sm'>
    <button type='button' class='absolute inset-0 h-full w-full cursor-default' aria-label={t('changelog.close')} onclick={() => appState.changelogOpen = false}></button>
    <div
      class='absolute top-[8vh] left-1/2 z-10 flex max-h-[82dvh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e20]/95 text-obs-text-main shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl'
      role='dialog'
      aria-modal='true'
      aria-labelledby='changelog-panel-title'
    >
      <header class='flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3'>
        <h2 id='changelog-panel-title' class='m-0 font-heading text-[13px] font-bold tracking-wide'>{t('changelog.title')}</h2>
        <button type='button' class='rounded-md p-1 text-obs-text-dim transition-colors hover:bg-white/10 hover:text-white' title={t('changelog.close')} aria-label={t('changelog.close')} onclick={() => appState.changelogOpen = false}>
          <X class='h-4 w-4' />
        </button>
      </header>

      <div class='custom-scrollbar overflow-y-auto px-4 py-3'>
        <div class='flex flex-col gap-5'>
          {#each changelog as release (release.version)}
            <article class='border-b border-white/6 pb-4 last:border-0 last:pb-0'>
              <h3 class='mb-2 mt-0 font-mono text-[11px] font-semibold text-obs-primary'>v{release.version}</h3>
              {#each release.categories as category, index (`${release.version}-${category.title ?? index}`)}
                <section class='mb-2 last:mb-0'>
                  {#if category.title}
                    <h4 class='mb-1 mt-0 text-[10px] font-semibold text-obs-text-main'>{categoryTitle(category.title)}</h4>
                  {/if}
                  <ul class='m-0 list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-obs-text-muted'>
                    {#each category.items as item (item.en)}
                      <li>{appState.locale === 'zh-CN' ? item.zhCN : item.en}</li>
                    {/each}
                  </ul>
                </section>
              {/each}
            </article>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
