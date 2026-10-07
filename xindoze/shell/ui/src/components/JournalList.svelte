<!-- The newest Journal events: every tool call, allowed or not. -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';
  import Verdict from './Verdict.svelte';

  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
</script>

<section class="panel block" aria-labelledby="journal-title">
  <h2 id="journal-title" class="eyebrow">Journal</h2>
  {#if shell.journal.length === 0}
    <p class="muted small">No actions yet.</p>
  {:else}
    <ol class="events">
      {#each shell.journal as e (e.device + e.seq)}
        <li class:rewound={e.rewound}>
          <span class="when mono">{time(e.ts_ms)}</span>
          <code class="tool">{e.tool}</code>
          <Verdict verdict={e.verdict} />
          {#if e.rewound}<span class="badge dim">rewound</span>{/if}
          <span class="summary">{e.summary}</span>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .events {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.8125rem;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }

  li:last-child {
    border-bottom: 0;
  }

  .when {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .summary {
    flex-basis: 100%;
    color: var(--muted);
  }

  .rewound .summary,
  .rewound .tool {
    text-decoration: line-through;
  }
</style>
