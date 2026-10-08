<script lang='ts'>
  import { CircleQuestionMark } from '@lucide/svelte'
  import { Slider } from 'bits-ui'
  import Tooltip from './Tooltip.svelte'

  interface Props {
    label: string
    value: number
    min: number
    max: number
    step?: number
    unit?: string
    decimals?: number
    description?: string
    toSlider?: (value: number) => number
    fromSlider?: (value: number) => number
    formatValue?: (value: number) => string
    onchange?: (val: number) => void
    oncommit?: (val: number) => void
  }

  import { untrack } from 'svelte'

  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 0.01,
    unit = '',
    decimals = 2,
    description = '',
    toSlider,
    fromSlider,
    formatValue,
    onchange,
    oncommit,
  }: Props = $props()

  let sliderValue = $state(untrack(() => toSlider ? toSlider(value) : value))

  $effect(() => {
    const next = toSlider ? toSlider(value) : value
    if (sliderValue !== next)
      sliderValue = next
  })

  function actualValue(slider: number): number {
    return fromSlider ? fromSlider(slider) : slider
  }

  function handleValueChange(slider: number) {
    const next = actualValue(slider)
    value = next
    onchange?.(next)
  }

  function handleValueCommit(slider: number) {
    const next = actualValue(slider)
    value = next
    oncommit?.(next)
  }

  const formattedDisplay = $derived(
    formatValue
      ? formatValue(value)
      : decimals === 0 ? Math.round(value).toString() : value.toFixed(decimals),
  )
</script>

<div class='flex flex-col gap-1 py-1 text-obs-text-main'>
  <div class='flex items-center justify-between text-xs'>
    <div class='flex items-center gap-1.5'>
      <span class='font-sans text-[11px] font-medium text-obs-text-muted'>
        {label}
      </span>
      {#if description}
        <Tooltip content={description} delayDuration={100}>
          <div class='cursor-help text-obs-text-dim hover:text-white transition-colors'>
            <CircleQuestionMark class='w-3 h-3' />
          </div>
        </Tooltip>
      {/if}
    </div>
    <span class='font-mono text-obs-primary text-[11px] font-semibold'>
      {formattedDisplay}{unit}
    </span>
  </div>

  <Slider.Root
    type='single'
    bind:value={sliderValue}
    onValueChange={handleValueChange}
    onValueCommit={handleValueCommit}
    {min}
    {max}
    {step}
    class='relative flex w-full touch-none select-none items-center py-1 cursor-pointer group'
  >
    <!-- 精细导轨 -->
    <span class='relative h-1 w-full grow overflow-hidden rounded-full bg-white/[0.08]'>
      <!-- 填充部分 -->
      <Slider.Range class='absolute h-full bg-obs-primary group-hover:bg-obs-primary-hover' />
    </span>

    <!-- 游标 -->
    <Slider.Thumb
      index={0}
      class='block h-3 w-3 rounded-full bg-white shadow-md transition-transform focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-obs-primary/50 group-hover:scale-125 active:scale-125'
    />
  </Slider.Root>
</div>
