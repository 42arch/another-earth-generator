<script lang='ts'>
  import { packageId as cartographyId } from '@another-earth/cartography'
  import { packageId as worldCoreId } from '@another-earth/world-core'
  import { packageId as worldDataId } from '@another-earth/world-data'

  const packages = [worldDataId, worldCoreId, cartographyId]
</script>

<svelte:head>
  <meta name='description' content='Another Earth workspace' />
</svelte:head>

<div class='min-h-screen bg-stone-50 text-stone-900'>
  <header class='flex h-16 items-center justify-between border-b border-stone-200 bg-white px-6'>
    <h1 class='text-lg font-semibold tracking-tight'>Another Earth</h1>
    <a href='/mesh-debug' class='text-sm text-stone-500 underline underline-offset-4'>Mesh Debug</a>
  </header>

  <div class='mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 md:grid-cols-[14rem_1fr]'>
    <aside class='rounded-lg border border-stone-200 bg-white p-4' aria-label='Workspace navigation'>
      <h2 class='text-xs font-semibold uppercase tracking-wider text-stone-500'>Workspace</h2>
      <p class='mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm font-medium'>Overview</p>
    </aside>

    <main class='min-h-[28rem] rounded-lg border border-stone-200 bg-white p-6'>
      <h2 class='text-xl font-semibold'>Workspace ready</h2>
      <p class='mt-2 text-sm text-stone-600'>The application shell is ready for the next milestone.</p>
      <p class='mt-8 text-xs font-medium uppercase tracking-wider text-stone-500'>Connected packages</p>
      <ul class='mt-3 space-y-2 text-sm text-stone-700'>
        {#each packages as packageName}
          <li class='rounded-md border border-stone-200 px-3 py-2 font-mono text-xs'>{packageName}</li>
        {/each}
      </ul>
    </main>
  </div>
</div>
