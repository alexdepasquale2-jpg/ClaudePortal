<!-- Pending asks, pinned above the Intent Bar so they are visible from every view. -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';
  import AskCard from './AskCard.svelte';
</script>

{#if shell.asks.length}
  <div class="dock" role="region" aria-label="Waiting for your approval">
    {#each shell.asks as pending (pending.id)}
      <AskCard {pending} />
    {/each}
  </div>
{/if}

<style>
  .dock {
    position: relative;
    display: grid;
    gap: 10px;
    max-height: min(62vh, 560px);
    overflow-y: auto;
    padding: 2px 2px 10px;
  }
</style>
