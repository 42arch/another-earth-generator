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

  const displayMultiplier = $derived(unit === '%' ? 100 : 1)
  const displayValue = $derived(value * displayMultiplier)
  const formattedDisplay = $derived(
    decimals === 0 ? Math.round(displayValue).toString() : displayValue.toFixed(decimals),
  )

  function handleInputCommit(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.value.trim() === '')
      return
    const next = Number(input.value) / displayMultiplier
    if (!Number.isFinite(next))
      return
    value = Math.min(max, Math.max(min, next))
    onchange?.(value)
    oncommit?.(value)
  }
</script>

<div class='flex flex-col gap-1.5 py-1.5 text-obs-text-main'>
  <div class='flex items-center justify-between gap-3 text-xs'>
    <span class='font-sans text-xs font-medium text-obs-text-muted'>
      {label}
    </span>
    <label class='flex items-center rounded border border-white/10 bg-black/15 px-1.5 focus-within:border-obs-amber/60'>
      <input
        type='number'
        value={formattedDisplay}
        min={min * displayMultiplier}
        max={max * displayMultiplier}
        step={step * displayMultiplier}
        oninput={handleInputCommit}
        aria-label={label}
        class='w-16 bg-transparent py-0.5 text-right font-mono text-xs text-obs-text-main outline-none'
      />
      {#if unit}<span class='pl-0.5 text-[10px] text-obs-text-dim'>{unit}</span>{/if}
    </label>
  </div>

  {#if description}
    <p class='text-[11px] text-obs-text-dim -mt-0.5 leading-snug'>
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
    class='relative flex w-full touch-none select-none items-center py-1.5 cursor-pointer group'
  >
    <!-- 精细导轨 -->
    <span class='relative h-1 w-full grow overflow-hidden rounded-full bg-white/[0.1]'>
      <!-- 填充部分 -->
      <Slider.Range class='absolute h-full bg-obs-amber group-hover:bg-obs-amber-light' />
    </span>

    <!-- 游标 -->
    <Slider.Thumb
      index={0}
      aria-label={label}
      class='block h-3.5 w-3.5 rounded-full border-2 border-[#20252b] bg-obs-amber transition-transform focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white group-hover:scale-110'
    />
  </Slider.Root>
</div>
