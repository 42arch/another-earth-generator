<script lang='ts'>
  import { useRegisterSW } from 'virtual:pwa-register/svelte'
  import { Button, Panel } from '@/ui/components'

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisterError(_error: any) {
      console.error('SW registration error', _error)
    },
  })

  function reload() {
    updateServiceWorker(true)
  }

  function close() {
    $needRefresh = false
  }
</script>

{#if $needRefresh}
  <div class='fixed bottom-24 right-6 z-50 pointer-events-auto w-[300px]'>
    <Panel collapsible={false} class='border-obs-primary/30 shadow-[0_8px_32px_rgba(0,0,0,0.6)]'>
      <div class='flex flex-col gap-4'>
        <div class='text-sm leading-relaxed'>
          <span class='font-semibold tracking-wide text-obs-primary'>更新可用</span>
          <p class='mt-1 text-obs-text-muted'>发现新版本，请刷新以获取最新内容。</p>
        </div>
        <div class='flex gap-2 justify-end'>
          <Button variant='ghost' size='sm' onclick={close}>
            忽略
          </Button>
          <Button variant='primary' size='sm' onclick={reload}>
            立即刷新
          </Button>
        </div>
      </div>
    </Panel>
  </div>
{/if}
