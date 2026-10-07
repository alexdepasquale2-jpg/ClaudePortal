<!-- Installed Genomes. Ones with a Canvas UI can be opened into a pane. -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';
</script>

<section class="panel block" aria-labelledby="genomes-title">
  <h2 id="genomes-title" class="eyebrow">Genomes</h2>
  {#if shell.genomes.length === 0}
    <p class="muted small">No Genomes installed.</p>
  {:else}
    <ul class="list">
      {#each shell.genomes as g (g.id)}
        <li>
          <div class="head">
            <span class="mono id">{g.id}</span>
            <span class="muted small">v{g.version}</span>
            {#if g.ui === 'canvas'}
              <button class="btn open" type="button" onclick={() => shell.send('open', g.id)}>
                Open<span class="sr-only"> {g.id}</span>
              </button>
            {/if}
          </div>
          <p class="muted small">{g.purpose}</p>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }

  li {
    padding: 8px 0;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 2px;
  }

  li:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .id {
    font-weight: 600;
  }

  .open {
    margin-left: auto;
    min-height: 28px;
    padding: 2px 12px;
    font-size: 0.8125rem;
  }
</style>
