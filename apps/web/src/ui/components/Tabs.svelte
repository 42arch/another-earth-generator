<script lang='ts' generics="T extends string">
  import type { Snippet } from 'svelte'
  import { Tabs } from 'bits-ui'

  interface TabItem<T extends string> {
    value: T
    label: string
  }

  interface Props<T extends string> {
    value: T
    items: TabItem<T>[]
    ariaLabel?: string
    class?: string
    listClass?: string
    triggerClass?: string
    contentClass?: string
    content?: Snippet<[value: T]>
  }

  let {
    value = $bindable(),
    items,
    ariaLabel = '选项卡',
    class: className = '',
    listClass = '',
    triggerClass = '',
    contentClass = '',
    content,
  }: Props<T> = $props()
</script>

<Tabs.Root bind:value activationMode='automatic' loop class='flex min-h-0 flex-1 flex-col {className}'>
  <Tabs.List
    aria-label={ariaLabel}
    class='mx-2 mt-2 grid gap-0.5 rounded-md border border-white/[0.06] bg-black/20 p-0.5 {listClass}'
    style={`grid-template-columns: repeat(${items.length}, minmax(0, 1fr))`}
  >
    {#each items as item (item.value)}
      <Tabs.Trigger
        value={item.value}
        class='min-h-7 whitespace-nowrap cursor-pointer rounded px-2 text-[11px] font-semibold text-obs-text-dim transition-colors hover:bg-white/[0.04] hover:text-obs-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-obs-primary data-[state=active]:bg-white/10 data-[state=active]:text-obs-text-main data-[state=active]:shadow-sm {triggerClass}'
      >
        {item.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>

  {#each items as item (item.value)}
    <Tabs.Content
      value={item.value}
      class='hidden data-[state=active]:flex flex-1 min-h-0 overflow-y-auto p-4 flex-col gap-4 custom-scrollbar text-xs focus-visible:outline-none {contentClass}'
    >
      {#if content}
        {@render content(item.value)}
      {/if}
    </Tabs.Content>
  {/each}
</Tabs.Root>
