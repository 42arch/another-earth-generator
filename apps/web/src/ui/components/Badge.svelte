<script lang='ts'>
  import type { Snippet } from 'svelte'

  interface Props {
    variant?: 'primary' | 'slate'
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
    primary: 'bg-obs-primary/10 text-obs-primary border-obs-primary/30',
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
