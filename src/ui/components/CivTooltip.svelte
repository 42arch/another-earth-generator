<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { Tooltip } from 'bits-ui'

  interface Props {
    content?: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
    delayDuration?: number
    children?: Snippet
    tooltipContent?: Snippet
  }

  const {
    content = '',
    side = 'top',
    sideOffset = 6,
    delayDuration = 200,
    children,
    tooltipContent,
  }: Props = $props()
</script>

<Tooltip.Provider {delayDuration}>
  <Tooltip.Root>
    <Tooltip.Trigger class='inline-flex'>
      {#if children}
        {@render children()}
      {/if}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        {sideOffset}
        class='z-50 rounded-md border border-white/[0.12] bg-[#08120d]/95 px-2.5 py-1 text-[11px] font-medium text-obs-text-main shadow-2xl backdrop-blur-md outline-hidden select-none'
      >
        <Tooltip.Arrow class='fill-[#08120d] stroke-white/[0.12]' />
        {#if tooltipContent}
          {@render tooltipContent()}
        {:else}
          <span>{content}</span>
        {/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
