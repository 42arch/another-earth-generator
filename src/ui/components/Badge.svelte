<script lang='ts'>
  import type { Snippet } from 'svelte'

  interface Props {
    variant?: 'amber' | 'blue' | 'emerald' | 'rose' | 'slate' | 'cyan'
    size?: 'sm' | 'md'
    class?: string
    children?: Snippet
  }

  const {
    variant = 'slate',
    size = 'sm',
    class: className = '',
    children,
  }: Props = $props()

  const variantStyles = {
    amber: 'bg-obs-amber/10 text-amber-300 border-obs-amber/30',
    blue: 'bg-obs-blue/10 text-blue-300 border-obs-blue/30',
    emerald: 'bg-obs-emerald/10 text-emerald-300 border-obs-emerald/30',
    rose: 'bg-obs-rose/10 text-rose-300 border-obs-rose/30',
    cyan: 'bg-obs-cyan/10 text-cyan-300 border-obs-cyan/30',
    slate: 'bg-white/[0.05] text-obs-text-muted border-white/[0.08]',
  }

  const sizeStyles = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-0.5 text-xs',
  }
</script>

<span
  class='inline-flex items-center gap-1 font-heading font-medium tracking-wide border rounded-md select-none {sizeStyles[size]} {variantStyles[variant]} {className}'
>
  {#if children}
    {@render children()}
  {/if}
</span>
