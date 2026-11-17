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
        class='z-50 rounded-md border border-white/8 bg-[#1e1e20] px-2.5 py-1.5 text-[11px] font-medium text-obs-text-main shadow-xl backdrop-blur-md outline-hidden select-none'
      >
        <Tooltip.Arrow class='text-[#2a2a2d] stroke-white/8' style='color: #2a2a2d;' />
        {#if tooltipContent}
          {@render tooltipContent()}
        {:else}
          <span>{content}</span>
        {/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
