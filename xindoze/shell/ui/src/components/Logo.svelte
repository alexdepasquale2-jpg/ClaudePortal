<!--
  The Xindoze mark: an X drawn as a chromosome, two chromatids joined at the
  centromere. With `animate`, the chromatids draw in like a cell dividing.
  Decorative: the wordmark beside it carries the name.
-->
<script lang="ts">
  import { entrance } from '../lib/motion';

  let { size = 28, animate = false }: { size?: number; animate?: boolean } = $props();
  const draw = (delay: number) => ({
    keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
    duration: 900,
    delay,
  });
</script>

<svg width={size} height={size} viewBox="180 120 664 784" aria-hidden="true" focusable="false">
  <g fill="none" stroke-width="112" stroke-linecap="round">
    {#if animate}
      <path
        stroke="#FF5A1F"
        pathLength="1"
        stroke-dasharray="1"
        d="M236 176 C552 330 552 694 236 848"
        use:entrance={draw(0)}
      />
      <path
        stroke="#2BF5C4"
        pathLength="1"
        stroke-dasharray="1"
        d="M788 176 C472 330 472 694 788 848"
        use:entrance={draw(120)}
      />
    {:else}
      <path stroke="#FF5A1F" d="M236 176 C552 330 552 694 236 848" />
      <path stroke="#2BF5C4" d="M788 176 C472 330 472 694 788 848" />
    {/if}
  </g>
  <circle cx="512" cy="512" r="30" fill="#EDE8DF" />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
