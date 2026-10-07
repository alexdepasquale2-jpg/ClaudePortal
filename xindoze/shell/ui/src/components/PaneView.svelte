<!-- One Organism's Canvas pane: its XUI tree plus the status of its last tool call. -->
<script lang="ts">
  import type { Action } from '../lib/api';
  import { shell, type Pane } from '../lib/shell.svelte';
  import { MAX_NODES, countNodes } from '../lib/xui';
  import { setXui } from '../lib/xui-context';
  import XuiRenderer from './XuiRenderer.svelte';

  let { pane }: { pane: Pane } = $props();

  setXui({
    get pane() {
      return pane;
    },
    run: (action: Action) =>
      'intent' in action
        ? shell.send(action.intent, pane.organism)
        : shell.runTool(pane, action.tool, action.args),
  });

  const tooBig = $derived(countNodes(pane.ui) > MAX_NODES);
</script>

<div class="pane">
  <h2 class="title">
    <span class="org">{pane.organism.replace(/^xindoze\./, '')}</span>
    <span class="id mono">{pane.organism}</span>
  </h2>
  {#if tooBig}
    <p class="note">This view has more than {MAX_NODES} elements, so it isn't shown.</p>
  {:else}
    <XuiRenderer node={pane.ui} />
  {/if}
  <p class="status" role="status">{pane.status}</p>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .title {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 1.35rem;
    text-transform: capitalize;
  }

  .id {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--muted);
    text-transform: none;
  }

  .note,
  .status {
    font-size: 0.875rem;
    color: var(--muted);
  }

  .status:empty {
    min-height: 1px;
  }
</style>
