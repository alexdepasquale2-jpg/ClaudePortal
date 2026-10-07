<!-- Undo every reversible effect of a task, then say what happened. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { errorText, type RewindReport } from '../lib/api';
  import Icon from '../lib/icons/Icon.svelte';
  import { shell } from '../lib/shell.svelte';

  let { taskId }: { taskId: string } = $props();

  let busy = $state(false);
  let report = $state<RewindReport | null>(null);
  let error = $state<string | null>(null);
  let result: HTMLElement | undefined = $state();

  async function rewind() {
    busy = true;
    error = null;
    try {
      report = await shell.rewind(taskId);
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
    await tick();
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    result?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }

  const nothing = $derived(
    report !== null && report.undone.length + report.skipped.length + report.failed.length === 0,
  );
</script>

<div class="rewind">
  <button
    class="btn"
    type="button"
    onclick={rewind}
    disabled={busy || report !== null}
    aria-busy={busy}
  >
    <Icon name="rewind" size={16} />
    {report ? 'Rewound' : busy ? 'Rewinding…' : 'Rewind'}
  </button>
  <div class="result" role="status" bind:this={result}>
    {#if error}
      <p class="failed">Rewind didn't finish: {error}</p>
    {:else if nothing}
      <p class="muted">Nothing left to undo.</p>
    {:else if report}
      <ul>
        {#each report.undone as line, i (i)}<li class="undone">{line}</li>{/each}
        {#each report.skipped as line, i (i)}<li class="muted">{line}</li>{/each}
        {#each report.failed as line, i (i)}<li class="failed">{line}</li>{/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .rewind {
    display: grid;
    gap: 6px;
    justify-items: start;
  }

  ul {
    margin: 0;
    padding-left: 1.1em;
    font-size: 0.875rem;
  }

  .undone::marker {
    color: var(--biolume-ink);
  }

  .muted {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .failed {
    color: var(--ember-ink);
    font-size: 0.875rem;
  }
</style>
