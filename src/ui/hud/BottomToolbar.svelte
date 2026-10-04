<script lang='ts'>
  const appVersion = import.meta.env.VITE_APP_VERSION
</script>

<footer class='pointer-events-none fixed bottom-4 inset-x-0 z-30 flex justify-center'>
  <div class='pointer-events-auto flex items-center gap-4 px-6 py-2 bg-[#1e1e20]/85 backdrop-blur-md rounded-full border border-white/10 text-[11px] font-medium text-obs-text-muted shadow-[0_4px_16px_rgba(0,0,0,0.3)]'>
    <span class='opacity-60 font-mono text-[10px]'>
      异星生成器 v{appVersion}
    </span>
    <div class='w-px h-3 bg-white/20'></div>
    <a
      href='https://github.com/42arch/another-earth-generator'
      target='_blank'
      rel='noopener noreferrer'
      class='opacity-60 hover:opacity-100 hover:text-white transition-opacity font-mono text-[10px] tracking-wider'
      title='GitHub Repository'
    >
      GitHub
    </a>
  </div>
</footer>
