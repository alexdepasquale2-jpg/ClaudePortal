<!-- Desktop conquest switch. Takeover is fullscreen-at-login and always reversible. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../lib/api';
  import type { ConquestView } from '../lib/api';

  let view = $state<ConquestView | null>(null);
  let error = $state('');

  const modes: { id: ConquestView['mode']; label: string }[] = [
    { id: 'guest', label: 'Guest' },
    { id: 'overlay', label: 'Overlay' },
    { id: 'takeover', label: 'Takeover' },
  ];

  onMount(() => {
    api.conquest().then((v) => (view = v)).catch(() => (view = null));
  });

  async function choose(mode: ConquestView['mode']) {
    error = '';
    try {
      view = await api.setConquest(mode);
    } catch (e) {
      error = api.errorText(e);
    }
  }
</script>

{#if view?.supported}
  <section class="panel block" aria-labelledby="conquest-title">
    <h2 id="conquest-title" class="eyebrow">Conquest</h2>
    <div class="modes">
      {#each modes as mode (mode.id)}
        <button
          type="button"
          class="mode"
          aria-pressed={view.mode === mode.id}
          onclick={() => choose(mode.id)}
        >
          {mode.label}
        </button>
      {/each}
    </div>
    <p class="muted small">
      Takeover is fullscreen at login. Explorer stays running. Undo: {view.undo}
    </p>
    {#if error}<p class="muted small">{error}</p>{/if}
  </section>
{/if}

<style>
  .modes {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .mode {
    flex: 1;
    border: 1px solid var(--line);
    background: transparent;
    color: inherit;
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    cursor: pointer;
  }

  .mode[aria-pressed='true'] {
    border-color: var(--biolume);
    color: var(--biolume-ink, var(--biolume));
  }
</style>
