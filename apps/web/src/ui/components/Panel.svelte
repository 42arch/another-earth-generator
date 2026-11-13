<script lang='ts'>
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import { Collapsible } from 'bits-ui'
  import { slide } from 'svelte/transition'

  interface Props {
    title?: string
    icon?: any
    open?: boolean
    collapsible?: boolean
    class?: string
    children?: Snippet
    headerActions?: Snippet
  }

  let {
    title = '',
    icon,
    open = $bindable(true),
    collapsible = true,
    class: className = '',
    children,
    headerActions,
  }: Props = $props()
</script>

{#if collapsible}
  <Collapsible.Root
    bind:open
    class='bg-obs-surface backdrop-blur-md border border-obs-border rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-200 {className}'
  >
    {#if title}
      <header class='flex items-center justify-between px-3.5 py-2.5 bg-white/[0.02] border-b border-white/[0.06] select-none'>
        <Collapsible.Trigger
          class='flex items-center justify-between flex-1 gap-2 text-left bg-transparent border-0 p-0 m-0 cursor-pointer group text-inherit font-inherit outline-hidden focus-visible:ring-1 focus-visible:ring-obs-primary/40 rounded-sm'
        >
          <div class='flex items-center gap-2'>
            {#if icon}
              <span class='text-obs-primary text-xs flex items-center'>
                {#if typeof icon === 'string'}
                  {icon}
                {:else}
                  {@const IconComponent = icon}
                  <IconComponent class='w-3.5 h-3.5 text-obs-primary' />
                {/if}
              </span>
            {/if}
            <h3 class='m-0 font-heading text-xs font-semibold tracking-wider uppercase text-obs-text-main group-hover:text-obs-primary transition-colors'>
              {title}
            </h3>
          </div>

          <div
            class='text-obs-text-dim group-hover:text-obs-text-muted transition-transform duration-200 flex items-center'
            style:transform={open ? 'rotate(0deg)' : 'rotate(-90deg)'}
          >
            <ChevronDown class='w-3.5 h-3.5' />
          </div>
        </Collapsible.Trigger>

        {#if headerActions}
          <div class='flex items-center gap-1.5 ml-2'>
            {@render headerActions()}
          </div>
        {/if}
      </header>
    {/if}

    <Collapsible.Content class='overflow-hidden'>
      <div transition:slide={{ duration: 160 }} class='p-3.5 text-xs text-obs-text-muted'>
        {#if children}
          {@render children()}
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
{:else}
  <div class='bg-obs-surface backdrop-blur-md border border-obs-border rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-200 {className}'>
    {#if title}
      <header class='flex items-center justify-between px-3.5 py-2.5 bg-white/[0.02] border-b border-white/[0.06] select-none'>
        <div class='flex items-center gap-2'>
          {#if icon}
            <span class='text-obs-primary text-xs flex items-center'>
              {#if typeof icon === 'string'}
                {icon}
              {:else}
                {@const IconComponent = icon}
                <IconComponent class='w-3.5 h-3.5 text-obs-primary' />
              {/if}
            </span>
          {/if}
          <h3 class='m-0 font-heading text-xs font-semibold tracking-wider uppercase text-obs-text-main'>
            {title}
          </h3>
        </div>

        {#if headerActions}
          <div class='flex items-center gap-1.5 ml-2'>
            {@render headerActions()}
          </div>
        {/if}
      </header>
    {/if}

    <div class='p-3.5 text-xs text-obs-text-muted'>
      {#if children}
        {@render children()}
      {/if}
    </div>
  </div>
{/if}
