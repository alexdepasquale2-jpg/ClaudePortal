<!--
  A confirm card for `xz://ask`: the Warden is holding an action until the
  user answers. Taint sources are shown first and loudest, because tainted
  arguments are exactly where prompt injection hides.
-->
<script lang="ts">
  import { shell, type PendingAsk } from '../lib/shell.svelte';

  let { pending }: { pending: PendingAsk } = $props();

  const id = $props.id();
  const ask = $derived(pending.ask);
  const sources = $derived(ask.taint?.sources ?? []);
  const args = $derived(JSON.stringify(ask.args ?? {}, null, 2));
</script>

<section
  class="ask"
  class:tainted={sources.length > 0}
  aria-labelledby="{id}-title"
  aria-describedby="{id}-reason"
>
  <header>
    <span class="badge {ask.risk === 'commit' ? 'alert' : ''}">{ask.risk}</span>
    <h2 id="{id}-title">Allow <code>{ask.tool}</code>?</h2>
  </header>
  <p class="who">
    Requested by <strong>{ask.organism}</strong>
  </p>

  {#if sources.length}
    <div class="taint" role="note" aria-label="Untrusted input">
      <p>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 3 2 21h20L12 3Zm0 6v6m0 3v.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <strong>Contains content you didn't write</strong>
      </p>
      <ul>
        {#each sources as source (source)}<li><code>{source}</code></li>{/each}
      </ul>
      <p class="hint">
        Text from these sources can try to give instructions. Check the arguments below.
      </p>
    </div>
  {/if}

  <p id="{id}-reason" class="reason">{ask.reason}</p>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex (long arguments scroll; keyboard users must reach them) -->
  <pre class="args" tabindex="0" aria-label="Arguments">{args}</pre>

  {#if pending.error}
    <p class="error" role="alert">Couldn't send your answer: {pending.error}</p>
  {/if}

  <div class="actions">
    <button
      class="btn"
      type="button"
      disabled={pending.busy}
      onclick={() => shell.reply(pending.id, false)}
    >
      Decline
    </button>
    <button
      class="btn primary"
      type="button"
      disabled={pending.busy}
      onclick={() => shell.reply(pending.id, true)}
    >
      Approve
    </button>
  </div>
</section>

<style>
  .ask {
    display: grid;
    gap: 10px;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--control);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
  }

  .ask.tainted {
    border-color: var(--ember);
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h2 {
    font-size: 1.05rem;
  }

  h2 code {
    font-size: 0.95em;
  }

  .who {
    font-size: 0.875rem;
    color: var(--muted);
  }

  .who strong {
    color: var(--fg);
    font-weight: 600;
  }

  .taint {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border-left: 4px solid var(--ember);
    background: color-mix(in srgb, var(--ember) 12%, var(--surface));
  }

  .taint p {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .taint p:first-child {
    color: var(--ember-ink);
  }

  .taint ul {
    margin: 0;
    padding-left: 1.4em;
    font-weight: 600;
  }

  .hint {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .args {
    margin: 0;
    max-height: 9.5rem;
    overflow: auto;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--line);
    font-size: 0.8rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @media (max-height: 760px) {
    .args {
      max-height: 5.5rem;
    }
  }

  .error {
    color: var(--ember-ink);
    font-size: 0.875rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .actions .btn {
    min-width: 104px;
  }
</style>
