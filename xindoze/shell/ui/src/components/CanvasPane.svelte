<!-- Canvas panes: Organism UIs (XUI). One is shown; chips switch between them. -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';
  import PaneView from './PaneView.svelte';

  const pane = $derived(shell.panes.find((p) => p.organism === shell.activePane) ?? null);
</script>

<section class="canvas" aria-label="Canvas">
  {#if shell.panes.length > 1}
    <div class="chips" role="group" aria-label="Open Organisms">
      {#each shell.panes as p (p.organism)}
        <button
          class="chip"
          type="button"
          aria-pressed={p.organism === shell.activePane}
          onclick={() => (shell.activePane = p.organism)}
        >
          {p.organism.replace(/^xindoze\./, '')}
        </button>
      {/each}
    </div>
  {/if}

  {#if pane}
    {#key pane.organism}
      <PaneView {pane} />
    {/key}
  {:else}
    <div class="empty">
      <p class="eyebrow">Canvas</p>
      <p>Organism interfaces appear here.</p>
      <p class="hint">Try <q>show my water this week</q> or <q>find my largest files</q>.</p>
    </div>
  {/if}
</section>

<style>
  .canvas {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    min-height: 100%;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    min-height: 32px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 550;
    text-transform: capitalize;
  }

  .chip[aria-pressed='true'] {
    border-color: var(--biolume-ink);
    color: var(--fg);
    background: var(--surface-2);
  }

  .empty {
    margin: auto 0;
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
    color: var(--fg);
    padding: 48px 0;
  }

  .hint {
    color: var(--muted);
    font-size: 0.875rem;
  }
</style>
