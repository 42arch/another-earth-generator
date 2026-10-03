<script lang='ts'>
  import { Switch } from 'bits-ui'

  interface Props {
    label: string
    checked: boolean
    color?: 'amber' | 'emerald' | 'blue' | 'rose'
    description?: string
    onchange?: (checked: boolean) => void
    oncommit?: (checked: boolean) => void
  }

  let {
    label,
    checked = $bindable(false),
    color = 'amber',
    description = '',
    onchange,
    oncommit,
  }: Props = $props()

  const glowColors = {
    amber: 'bg-obs-amber border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
    emerald: 'bg-obs-emerald border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
    blue: 'bg-obs-blue border-blue-300 shadow-[0_0_8px_rgba(59,130,246,0.6)]',
    rose: 'bg-obs-rose border-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
  }
</script>

<div class='flex items-center justify-between py-1 text-obs-text-main'>
  <div class='flex flex-col pr-2'>
    <span class='font-sans text-[11px] text-obs-text-muted'>
      {label}
    </span>
    {#if description}
      <span class='text-[10px] text-obs-text-dim leading-tight'>
        {description}
      </span>
    {/if}
  </div>

  <Switch.Root
    bind:checked
    onCheckedChange={(val) => {
      checked = val
      onchange?.(val)
      oncommit?.(val)
    }}
    class='peer inline-flex h-4 w-7.5 shrink-0 cursor-pointer items-center rounded-full border border-white/[0.12] bg-white/[0.05] transition-colors focus-visible:outline-hidden data-[state=checked]:bg-obs-amber/20 data-[state=checked]:border-obs-amber/50'
  >
    <Switch.Thumb
      class="pointer-events-none block h-2.5 w-2.5 rounded-full border transition-all duration-150 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-obs-text-dim data-[state=unchecked]:border-transparent {checked ? glowColors[color] : ''}"
    />
  </Switch.Root>
</div>
