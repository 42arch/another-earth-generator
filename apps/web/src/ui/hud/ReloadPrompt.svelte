<script lang='ts'>
  import { useRegisterSW } from 'virtual:pwa-register/svelte'
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
            <span class='font-semibold tracking-wide text-obs-primary'>更新可用</span>
            <p class='mt-1 text-obs-text-muted'>发现新版本，请刷新以获取最新内容。</p>
          </div>
          <div class='flex gap-2 justify-end'>
            <Button variant='ghost' size='sm' onclick={dismiss}>忽略</Button>
            <Button variant='primary' size='sm' onclick={reload}>立即刷新</Button>
          </div>
        </div>
      </Panel>
    </div>
  </div>
{/if}
