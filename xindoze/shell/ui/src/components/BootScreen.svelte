<!-- Dark boot: the cell divides into the X, then "Xindoze has evolved."
     The SVG holds the motion. Reduced motion shows the finished mark and leaves sooner.
     The hold starts once the desktop window is on screen, so a slow webview
     load cannot spend the animation before the window is mapped. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import bootSvg from '../../../../assets/canvas/boot/boot.svg?raw';

  function stripBlock(source: string, marker: string): string {
    const start = source.indexOf(marker);
    if (start < 0) return source;
    const open = source.indexOf('{', start);
    if (open < 0) return source;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(0, start) + source.slice(i + 1);
      }
    }
    return source;
  }

  const markup = stripBlock(
    stripBlock(bootSvg.replace(/<\?xml[^?]*\?>/, ''), '@font-face'),
    '@media (prefers-color-scheme: light)',
  );

  let up = $state(true);

  /** Cover the desktop window even when an ancestor is a clipping grid. */
  function cover(el: HTMLElement) {
    document.body.appendChild(el);
    return {
      destroy() {
        el.remove();
      },
    };
  }

  onMount(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduce ? 900 : 2600;
    let timer = 0;
    let dead = false;

    const arm = () => {
      if (dead || timer) return;
      timer = window.setTimeout(() => (up = false), ms);
    };

    const wait = async () => {
      const started = performance.now();
      while (!dead && !timer) {
        let shown = document.visibilityState === 'visible';
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          shown = await getCurrentWindow().isVisible();
        } catch {
          /* Browser preview has no Tauri window. */
        }
        if (shown || performance.now() - started > 1500) {
          arm();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
    };
    void wait();

    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  });
</script>

{#if up}
  <div class="boot" role="img" aria-label="Xindoze has evolved." use:cover>
    {@html markup}
  </div>
{/if}

<style>
  .boot {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: #0b0d10;
  }

  .boot :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
