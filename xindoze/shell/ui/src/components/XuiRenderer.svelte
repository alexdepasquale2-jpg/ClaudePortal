<!--
  Renders one XUI node (SPEC Appendix B) and its children with semantic HTML.
  Model output only ever becomes text, attributes we choose, and bound
  actions: no {@html}, no model-supplied URLs or styles.
-->
<script lang="ts">
  import type { Action, XuiNode } from '../lib/api';
  import { fmt } from '../lib/chart';
  import { KNOWN_TYPES, problem } from '../lib/xui';
  import { getXui } from '../lib/xui-context';
  import Markdown from './Markdown.svelte';
  import RewindButton from './RewindButton.svelte';
  import Self from './XuiRenderer.svelte';
  import XuiChart from './XuiChart.svelte';
  import XuiImage from './XuiImage.svelte';
  import XuiInput from './XuiInput.svelte';

  let { node, depth = 1 }: { node: XuiNode; depth?: number } = $props();

  const ctx = getXui();
  const uid = $props.id();
  const type = $derived((node as { type?: unknown }).type);
  const known = $derived(typeof type === 'string' && KNOWN_TYPES.has(type));
  const issue = $derived(known ? problem(node, depth) : null);

  let busy = $state(false);

  async function press(action: Action) {
    busy = true;
    try {
      await ctx.run(action);
    } finally {
      busy = false;
    }
  }

  // XUI h1 sits under the pane's h2.
  const headingTag = (level: number | undefined) => `h${Math.min(6, (level ?? 1) + 2)}`;
  const gapPx = (gap: number | null | undefined) => `${Math.min(48, Math.max(0, gap ?? 12))}px`;
</script>

{#if !known}
  <p class="unsupported">Unsupported element{typeof type === 'string' ? ` “${type}”` : ''}.</p>
{:else if issue}
  <p class="unsupported">Can't show this {type}: {issue}.</p>
{:else if node.type === 'stack'}
  <div class="stack" class:row={node.direction === 'row'} style:gap={gapPx(node.gap)}>
    {#each node.children ?? [] as child, i (i)}
      <Self node={child} depth={depth + 1} />
    {/each}
  </div>
{:else if node.type === 'heading'}
  <svelte:element this={headingTag(node.level)} class="heading">{node.text}</svelte:element>
{:else if node.type === 'text'}
  <Markdown text={node.text} />
{:else if node.type === 'list'}
  {#if node.ordered}
    <ol class="list">
      {#each node.items ?? [] as item, i (i)}<li><Markdown text={item} inline /></li>{/each}
    </ol>
  {:else}
    <ul class="list">
      {#each node.items ?? [] as item, i (i)}<li><Markdown text={item} inline /></li>{/each}
    </ul>
  {/if}
{:else if node.type === 'table'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
  <div class="table-wrap" role="region" aria-label="Table" tabindex="0">
    <table>
      <thead>
        <tr>
          {#each node.columns as column, i (i)}<th scope="col">{column}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each node.rows as row, r (r)}
          <tr>
            {#each row as cell, c (c)}<td class:short={cell.length <= 12}>{cell}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if node.type === 'card'}
  <section class="card" aria-labelledby="{uid}-title">
    <h3 id="{uid}-title">{node.title}</h3>
    {#each node.children ?? [] as child, i (i)}
      <Self node={child} depth={depth + 1} />
    {/each}
  </section>
{:else if node.type === 'button'}
  {@const action = node.action}
  <button
    class="btn xui-button"
    type="button"
    disabled={busy}
    aria-busy={busy}
    onclick={() => press(action)}
  >
    {node.label}
  </button>
{:else if node.type === 'input'}
  <XuiInput {node} />
{:else if node.type === 'image'}
  <XuiImage {node} />
{:else if node.type === 'chart'}
  <XuiChart {node} />
{:else if node.type === 'progress'}
  <div class="progress">
    <label for="{uid}-bar">{node.label}</label>
    <progress id="{uid}-bar" value={Math.max(0, node.value)} max={node.max > 0 ? node.max : 1}
    ></progress>
    <span class="value">{fmt(node.value)} of {fmt(node.max)}</span>
  </div>
{:else if node.type === 'rewind'}
  <RewindButton taskId={node.task_id} />
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .stack.row {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .heading {
    font-size: 1.25rem;
  }

  h4.heading {
    font-size: 1.1rem;
  }

  h5.heading,
  h6.heading {
    font-size: 1rem;
  }

  .list {
    margin: 0;
    padding-left: 1.3em;
    display: grid;
    gap: 2px;
  }

  .table-wrap {
    position: relative;
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  th,
  td {
    padding: 8px 12px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }

  th {
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-2);
    white-space: nowrap;
  }

  /* Sizes, dates and numbers read badly when broken across lines. */
  td.short {
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .card {
    --chart-ring: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--line);
    min-width: 0;
  }

  .card h3 {
    font-size: 1.05rem;
  }

  .xui-button {
    align-self: flex-start;
  }

  .progress {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    align-items: center;
  }

  .progress label {
    font-size: 0.875rem;
  }

  .progress .value {
    font-size: 0.8125rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  progress {
    grid-column: 1 / -1;
    width: 100%;
    height: 10px;
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }

  progress::-webkit-progress-bar {
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    border-radius: 999px;
  }

  progress::-webkit-progress-value {
    background: var(--meter);
    border-radius: 999px;
  }

  progress::-moz-progress-bar {
    background: var(--meter);
    border-radius: 999px;
  }

  .unsupported {
    font-size: 0.8125rem;
    color: var(--muted);
    border: 1px dashed var(--control);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    align-self: flex-start;
  }
</style>
