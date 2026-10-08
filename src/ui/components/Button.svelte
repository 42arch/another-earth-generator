<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Button } from 'bits-ui'

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'icon'
    size?: 'sm' | 'md' | 'lg'
    active?: boolean
    disabled?: boolean
    title?: string
    class?: string
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  }

  const {
    variant = 'secondary',
    size = 'md',
    active = false,
    disabled = false,
    title = '',
    class: className = '',
    onclick,
    children,
  }: Props = $props()

  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs gap-1.5',
    md: 'px-3.5 py-1.5 text-xs gap-2',
    lg: 'px-4 py-2 text-sm gap-2',
  }

  const variantClasses = {
    primary: 'bg-obs-primary/15 text-obs-primary border-obs-primary/40 hover:bg-obs-primary/25 hover:border-obs-primary/70 shadow-[0_0_12px_rgba(22,119,255,0.2)]',
    secondary: 'bg-white/[0.04] text-obs-text-muted border-white/[0.08] hover:border-white/[0.2] hover:text-obs-text-main hover:bg-white/[0.08]',
    ghost: 'bg-transparent text-obs-text-dim border-transparent hover:text-obs-text-main hover:bg-white/[0.05]',
    icon: 'p-1.5 bg-white/[0.04] text-obs-text-muted border-white/[0.08] hover:border-obs-primary/50 hover:text-obs-primary hover:bg-white/[0.08]',
  }
</script>

<Button.Root
  type='button'
  {disabled}
  {title}
  class="relative inline-flex items-center justify-center font-heading font-medium tracking-wide border rounded-md select-none transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none cursor-pointer outline-hidden focus-visible:ring-1 focus-visible:ring-obs-primary/60 {sizeClasses[size]} {variantClasses[variant]} {active ? 'ring-1 ring-obs-primary/60 border-obs-primary bg-obs-primary/20 text-obs-primary' : ''} {className}"
  {onclick}
>
  {#if children}
    {@render children()}
  {/if}
</Button.Root>
