<script lang='ts'>
  import { useRegisterSW } from 'virtual:pwa-register/svelte'
  import { t } from '@/lib/i18n'
  import { Button, Panel } from '@/ui/components'

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisterError(error) {
      console.error('SW registration error', error)
    },
  })

  function reload(): void {
    updateServiceWorker(true)
  }

  function dismiss(): void {
    $needRefresh = false
  }
</script>

{#if $needRefresh}
  <div class='pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4'>
    <div class='pointer-events-auto w-full max-w-xs'>
      <Panel collapsible={false} class='border-obs-primary/30'>
        <div class='flex flex-col gap-4'>
          <div class='text-sm leading-relaxed'>
            <span class='font-semibold tracking-wide text-obs-primary'>{t('update.available')}</span>
            <p class='mt-1 text-obs-text-muted'>{t('update.description')}</p>
          </div>
          <div class='flex gap-2 justify-end'>
            <Button variant='ghost' size='sm' onclick={dismiss}>{t('update.dismiss')}</Button>
            <Button variant='primary' size='sm' onclick={reload}>{t('update.reload')}</Button>
          </div>
        </div>
      </Panel>
    </div>
  </div>
{/if}
