<!--
  XUI image. `src` is a local blob ref that the runtime resolves to a data URL;
  the model's string never reaches the <img> element directly.
-->
<script lang="ts">
  import { blob } from '../lib/api';

  let { node }: { node: { src: string; alt: string } } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);

  $effect(() => {
    const ref = node.src;
    let live = true;
    url = null;
    failed = false;
    blob(ref)
      .then((u) => {
        if (!live) return;
        url = u;
        failed = !u;
      })
      .catch(() => live && (failed = true));
    return () => (live = false);
  });
</script>

{#if url}
  <img src={url} alt={node.alt} />
{:else}
  <div class="placeholder" role="img" aria-label={node.alt}>
    {failed ? `Image unavailable: ${node.alt}` : 'Loading image…'}
  </div>
{/if}

<style>
  img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    height: auto;
    border-radius: var(--radius-sm);
    align-self: flex-start;
  }

  .placeholder {
    padding: 16px;
    border: 1px dashed var(--control);
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    color: var(--muted);
  }
</style>
