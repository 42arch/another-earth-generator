<script lang='ts' generics="T">
  import { Select } from 'bits-ui'
  import { Check, ChevronDown } from '@lucide/svelte'

  interface Option<T> {
    label: string
    value: T
    description?: string
  }

  interface Props<T> {
    label?: string
    value: T
    options: Option<T>[]
    placeholder?: string
    disabled?: boolean
    class?: string
    onchange?: (val: T) => void
    oncommit?: (val: T) => void
  }

  let {
    label = '',
    value = $bindable(),
    options = [],
    placeholder = '请选择...',
    disabled = false,
    class: className = '',
    onchange,
    oncommit,
  }: Props<T> = $props()

  const valueMap = $derived(new Map(options.map(opt => [String(opt.value), opt.value])))
  const stringValue = $derived(value !== undefined && value !== null ? String(value) : '')
  const selectedOption = $derived(options.find(opt => String(opt.value) === stringValue))

  function handleValueChange(val: string) {
    if (valueMap.has(val)) {
      const originalValue = valueMap.get(val) as T
      value = originalValue
      onchange?.(originalValue)
      oncommit?.(originalValue)
    }
  }
</script>

<div class='flex flex-col gap-1 py-1 text-obs-text-main {className}'>
  {#if label}
    <span class='font-sans text-[11px] text-obs-text-muted'>
      {label}
    </span>
  {/if}

  <Select.Root
    type='single'
    value={stringValue}
    onValueChange={handleValueChange}
    {disabled}
    items={options.map(opt => ({ value: String(opt.value), label: opt.label }))}
  >
    <Select.Trigger
      class='flex items-center justify-between w-full bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.1] hover:border-white/[0.2] rounded-md px-2.5 py-1.5 font-sans text-xs text-obs-text-main focus:outline-hidden focus:border-obs-amber/60 focus:ring-1 focus:ring-obs-amber/30 cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none group'
    >
      <span class='truncate {selectedOption ? "text-obs-text-main font-medium" : "text-obs-text-dim"}'>
        {selectedOption ? selectedOption.label : placeholder}
      </span>
      <div class='text-obs-text-dim group-hover:text-obs-text-muted transition-colors ml-2 shrink-0'>
        <ChevronDown class='w-3.5 h-3.5' />
      </div>
    </Select.Trigger>

    <Select.Portal>
      <Select.Content
        class='z-50 min-w-[var(--bits-select-anchor-width)] max-h-60 overflow-y-auto rounded-lg border border-white/[0.12] bg-[#08120d]/95 p-1 text-obs-text-main shadow-2xl backdrop-blur-xl outline-hidden select-none'
        sideOffset={4}
      >
        <Select.Viewport class='p-0.5 flex flex-col gap-0.5'>
          {#each options as opt}
            <Select.Item
              value={String(opt.value)}
              label={opt.label}
              class='relative flex w-full cursor-pointer select-none items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-obs-text-muted outline-hidden transition-colors data-[highlighted]:bg-obs-amber/15 data-[highlighted]:text-obs-amber-light data-[disabled]:pointer-events-none data-[disabled]:opacity-40 {String(opt.value) === stringValue ? "text-obs-amber font-medium bg-obs-amber/10" : ""}'
            >
              <div class='flex flex-col'>
                <span class='font-sans'>{opt.label}</span>
                {#if opt.description}
                  <span class='text-[10px] text-obs-text-dim leading-tight'>{opt.description}</span>
                {/if}
              </div>

              {#if String(opt.value) === stringValue}
                <Check class='w-3.5 h-3.5 text-obs-amber shrink-0 ml-2' />
              {/if}
            </Select.Item>
          {/each}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</div>
