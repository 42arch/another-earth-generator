<script lang='ts'>
  import { Slider } from 'bits-ui'

  interface Props {
    label: string
    value: number
    min: number
    max: number
    step?: number
    unit?: string
    decimals?: number
    description?: string
    onchange?: (val: number) => void
    oncommit?: (val: number) => void
  }

  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 0.01,
    unit = '',
    decimals = 2,
    description = '',
    onchange,
    oncommit,
  }: Props = $props()

  function handleValueChange(val: number) {
    onchange?.(val)
  }

  function handleValueCommit(val: number) {
    oncommit?.(val)
  }

  const formattedDisplay = $derived(
    decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals),
  )
</script>

<div class='flex flex-col gap-1 py-1 text-obs-text-main'>
  <div class='flex items-center justify-between text-xs'>
    <span class='font-sans text-[11px] font-medium text-obs-text-muted'>
      {label}
    </span>
    <span class='font-mono text-obs-amber-light text-[11px] font-semibold'>
      {formattedDisplay}{unit}
    </span>
  </div>

  {#if description}
    <p class='text-[10px] text-obs-text-dim -mt-0.5 leading-tight'>
      {description}
    </p>
  {/if}

  <Slider.Root
    type='single'
    bind:value={value}
    onValueChange={handleValueChange}
    onValueCommit={handleValueCommit}
    {min}
    {max}
    {step}
    class='relative flex w-full touch-none select-none items-center py-1 cursor-pointer group'
  >
    <!-- 精细导轨 -->
    <span class='relative h-1 w-full grow overflow-hidden rounded-full bg-white/[0.08] border border-white/[0.04]'>
      <!-- 填充部分 -->
      <Slider.Range class='absolute h-full bg-obs-amber/80 group-hover:bg-obs-amber' />
    </span>

    <!-- 游标 -->
    <Slider.Thumb
      index={0}
      class='block h-3 w-3 rounded-full border border-emerald-300 bg-obs-amber shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-transform focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-obs-amber group-hover:scale-125 active:scale-125'
    />
  </Slider.Root>
</div>


