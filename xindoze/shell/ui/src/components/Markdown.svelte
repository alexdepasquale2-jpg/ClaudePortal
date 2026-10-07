<!--
  Renders the Markdown subset (bold, italic, code, links, simple lists) as
  elements. Never {@html}: text stays text. Links are http(s) only and open in
  the system browser, outside the Canvas.
-->
<script lang="ts">
  import { blocks, type Inline } from '../lib/markdown';
  import { openUrl } from '../lib/api';

  let { text, inline: inlineOnly = false }: { text: string; inline?: boolean } = $props();

  const parsed = $derived(blocks(text ?? ''));

  function open(e: MouseEvent, href: string) {
    e.preventDefault();
    openUrl(href).catch(() => {});
  }
</script>

{#snippet run(inlines: Inline[])}
  {#each inlines as t, i (i)}
    {#if t.kind === 'strong'}<strong>{t.text}</strong>
    {:else if t.kind === 'em'}<em>{t.text}</em>
    {:else if t.kind === 'code'}<code>{t.text}</code>
    {:else if t.kind === 'link'}<a
        href={t.href}
        title={t.href}
        target="_blank"
        rel="noopener noreferrer"
        onclick={(e) => open(e, t.href)}>{t.text}</a
      >
    {:else}{t.text}{/if}
  {/each}
{/snippet}

{#if inlineOnly}
  <span class="md"
    >{@render run(parsed.flatMap((b) => (b.kind === 'p' ? b.inlines : b.items.flat())))}</span
  >
{:else}
  <div class="md">
    {#each parsed as b, i (i)}
      {#if b.kind === 'p'}
        <p>{@render run(b.inlines)}</p>
      {:else if b.kind === 'ul'}
        <ul>
          {#each b.items as item, j (j)}<li>{@render run(item)}</li>{/each}
        </ul>
      {:else}
        <ol>
          {#each b.items as item, j (j)}<li>{@render run(item)}</li>{/each}
        </ol>
      {/if}
    {/each}
  </div>
{/if}

<style>
  p,
  span.md {
    white-space: pre-line;
  }

  div.md {
    display: grid;
    gap: 0.6em;
  }

  ul,
  ol {
    margin: 0;
    padding-left: 1.3em;
  }

  code {
    padding: 0.05em 0.35em;
    border-radius: 4px;
    background: var(--surface-2);
    white-space: break-spaces;
  }
</style>
