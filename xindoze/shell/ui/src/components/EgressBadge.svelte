<!-- The zero-egress indicator: Biolume while nothing has left the device, Ember once anything has. -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';

  const egress = $derived(shell.pulse?.egress ?? []);
  const hosts = $derived([...new Set(egress.map((e) => e.host))]);
</script>

<span class="egress" class:out={egress.length > 0} role="status">
  {#if !shell.pulse}
    <span class="dot" aria-hidden="true"></span> Checking egress
  {:else if egress.length === 0}
    <span class="dot good" aria-hidden="true"></span> Zero egress
  {:else}
    <span class="dot alert" aria-hidden="true"></span>
    Egress: {hosts.length === 1 ? hosts[0] : `${hosts.length} hosts`}
  {/if}
</span>

<style>
  .egress {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 0.8125rem;
    font-weight: 550;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .egress.out {
    border-color: var(--ember);
    color: var(--ember-ink);
  }
</style>
