<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Check } from '@lucide/svelte'
  import { Checkbox, Label } from 'bits-ui'

  let nextId = 0
  function generateId(): string {
    return `ae-checkbox-${++nextId}`
  }

  interface Props {
    label?: string
    checked?: boolean
    disabled?: boolean
    id?: string
    size?: 'sm' | 'md'
    description?: string
    class?: string
    checkboxClass?: string
    labelClass?: string
    onchange?: (checked: boolean) => void
    oncommit?: (checked: boolean) => void
    children?: Snippet
  }

  let {
    label = '',
    checked = $bindable(false),
    disabled = false,
    id,
    size = 'sm',
    description = '',
    class: className = '',
    checkboxClass = '',
    labelClass = '',
    onchange,
    oncommit,
    children,
  }: Props = $props()

  const defaultId = generateId()
  const checkboxId = $derived(id ?? defaultId)

  const activeClass = 'text-obs-primary focus-visible:ring-obs-primary/60 data-[state=checked]:bg-obs-primary/20 data-[state=checked]:border-obs-primary/60'

  const sizeClasses = {
    sm: 'size-4',
    md: 'size-5',
  }

  const iconSizes = {
    sm: 'size-3 stroke-[2.5]',
    md: 'size-3.5 stroke-[2.5]',
  }
</script>

<div class="inline-flex items-center gap-2 {className}">
  <Checkbox.Root
    id={checkboxId}
    bind:checked
    {disabled}
    onCheckedChange={(val) => {
      checked = val
      onchange?.(val)
      oncommit?.(val)
    }}
    class="flex {sizeClasses[size]} shrink-0 items-center justify-center rounded-sm border border-white/[0.16] bg-white/[0.05] transition-colors hover:border-white/30 focus-visible:outline-hidden focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-40 cursor-pointer {activeClass} {checkboxClass}"
  >
    {#snippet children({ checked: isChecked })}
      {#if isChecked}
        <Check class={iconSizes[size]} />
      {/if}
    {/snippet}
  </Checkbox.Root>

  {#if label || children}
    <Label.Root
      for={checkboxId}
      class="cursor-pointer select-none text-[11px] text-obs-text-muted hover:text-obs-text-main transition-colors disabled:pointer-events-none disabled:opacity-40 {labelClass}"
    >
      {#if children}
        {@render children()}
      {:else}
        {label}
      {/if}
      {#if description}
        <span class="block text-[10px] text-obs-text-dim leading-tight">
          {description}
        </span>
      {/if}
    </Label.Root>
  {/if}
</div>
