<script lang='ts'>
  import { useRegisterSW } from 'virtual:pwa-register/svelte'

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
  <div class='fixed bottom-24 right-6 z-50 p-4 bg-slate-800 border border-slate-700 rounded-xl shadow-xl shadow-black/50 text-slate-200 pointer-events-auto flex flex-col gap-3 max-w-[300px]'>
    <div class='text-sm'>
      <span class='font-bold text-sky-400'>更新可用</span>
      <p class='mt-1 text-slate-400'>发现新版本，请刷新以获取最新内容。</p>
    </div>
    <div class='flex gap-2 justify-end'>
      <button onclick={close} class='px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors cursor-pointer'>
        忽略
      </button>
      <button onclick={reload} class='px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors cursor-pointer'>
        立即刷新
      </button>
    </div>
  </div>
{/if}
