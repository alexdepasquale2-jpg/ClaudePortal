<!--
  An action card: what one intent did. Steps arrive live over `xz://step`; the
  outcome then fills in the reply, the final steps and the Rewind button.
-->
<script lang="ts">
  import type { Json } from '../lib/api';
  import { canRewind, shell, type TaskEntry } from '../lib/shell.svelte';
  import Markdown from './Markdown.svelte';
  import RewindButton from './RewindButton.svelte';
  import Verdict from './Verdict.svelte';

  let { entry }: { entry: TaskEntry } = $props();

  const out = $derived(entry.outcome);
  const pending = $derived(!out && !entry.error);
  const undoable = $derived(out ? canRewind(out.task_id, out.steps) : false);
  const title = $derived(out ? out.organism.replace(/^xindoze\./, '') : 'Working');

  function brief(args: Json): string {
    const text = JSON.stringify(args ?? {});
    return text === '{}' ? '' : text.length > 90 ? `${text.slice(0, 89)}…` : text;
  }
</script>

<article class="task panel" aria-busy={pending} aria-label="{title} task">
  <header>
    {#if pending}
      <span class="pulse" aria-hidden="true"></span>
      <span class="who">Working…</span>
    {:else if out}
      <span class="who">{title}</span>
      {#if out.crystal}<span class="badge good" title="Served by crystal {out.crystal}"
          >crystal</span
        >{/if}
      {#if !out.done}<span class="badge dim">step budget reached</span>{/if}
    {:else}
      <span class="who">Not finished</span>
    {/if}
  </header>

  {#if entry.error}
    <p class="error">Couldn't finish that: {entry.error}</p>
  {/if}

  {#if out?.say}
    <Markdown text={out.say} />
  {/if}

  {#if entry.steps.length}
    <ol class="steps" aria-label="Steps">
      {#each entry.steps as step, i (i)}
        <li class:failed={!step.ok}>
          <Verdict verdict={step.verdict} />
          <span class="body">
            <code class="tool">{step.tool}</code>
            <span class="summary">
              {#if !step.ok}<span class="sr-only">Failed: </span>{/if}{step.summary}
            </span>
            {#if brief(step.args)}<code class="args">{brief(step.args)}</code>{/if}
          </span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if out && (out.ui || undoable)}
    <footer>
      {#if out.ui}
        <button class="btn" type="button" onclick={() => shell.openPane(out.organism)}>
          Show in Canvas
        </button>
      {/if}
      {#if undoable}
        <RewindButton taskId={out.task_id} />
      {/if}
    </footer>
  {/if}
</article>

<style>
  .task {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }

  .who {
    font-weight: 650;
    font-size: 0.875rem;
    color: var(--biolume-ink);
  }

  .pulse {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--biolume);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }

  .error {
    color: var(--ember-ink);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 6px;
    font-size: 0.875rem;
  }

  .steps li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .steps li :global(.badge) {
    min-width: 76px;
    justify-content: center;
  }

  .body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 8px;
    min-width: 0;
  }

  .tool {
    color: var(--fg);
  }

  .summary {
    color: var(--muted);
  }

  .failed .summary {
    color: var(--ember-ink);
  }

  .args {
    flex-basis: 100%;
    color: var(--muted);
    font-size: 0.75rem;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
  }
</style>
