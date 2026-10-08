<script lang='ts'>
  import { Smartphone } from '@lucide/svelte'
</script>

<div class='rotate-prompt fixed inset-0 z-[100] flex-col items-center justify-center bg-obs-surface/80 backdrop-blur-md border border-obs-border text-white pointer-events-auto'>
  <div class='flex flex-col items-center gap-6'>
    <div class='animate-phone-rotate'>
      <Smartphone class='w-16 h-16 text-obs-amber' strokeWidth={1.5} />
    </div>
    <div class='text-center space-y-2'>
      <h2 class='text-lg font-medium text-obs-amber-light'>建议横屏浏览</h2>
      <p class='text-sm text-obs-text-muted'>为了获得最佳体验，请关闭方向锁定<br>并将设备旋转至横向模式</p>
    </div>
  </div>
</div>

<style>
  .rotate-prompt {
    display: none;
  }

  /* 仅在竖屏并且是移动设备屏幕大小时显示 */
  @media (orientation: portrait) and (max-width: 768px) {
    .rotate-prompt {
      display: flex;
    }
  }

  @keyframes phone-rotate {
    0%, 10% { transform: rotate(0deg); }
    40%, 60% { transform: rotate(-90deg); }
    90%, 100% { transform: rotate(0deg); }
  }

  .animate-phone-rotate {
    animation: phone-rotate 2.5s ease-in-out infinite;
  }
</style>
