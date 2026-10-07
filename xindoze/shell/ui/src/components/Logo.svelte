<!--
  The Xindoze mark: an X drawn as a chromosome, two chromatids joined at the
  centromere. With `animate`, the chromatids draw in like a cell dividing.
  Decorative: the wordmark beside it carries the name.
-->
<script lang="ts">
  import { entrance } from '../lib/motion';

  let { size = 28, animate = false }: { size?: number; animate?: boolean } = $props();
  const id = $props.id();
  const draw = (delay: number) => ({
    keyframes: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
    duration: 900,
    delay,
  });
</script>

<svg width={size} height={size} viewBox="180 120 664 784" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient
      id="{id}-dna"
      x1="236"
      y1="176"
      x2="788"
      y2="848"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0.12" stop-color="#FF5A1F" />
      <stop offset="0.5" stop-color="#F4B23A" />
      <stop offset="0.88" stop-color="#2BF5C4" />
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#{id}-dna)" stroke-width="112" stroke-linecap="round">
    {#if animate}
      <path
        pathLength="1"
        stroke-dasharray="1"
        d="M236 176 C552 330 552 694 236 848"
        use:entrance={draw(0)}
      />
      <path
        pathLength="1"
        stroke-dasharray="1"
        d="M788 176 C472 330 472 694 788 848"
        use:entrance={draw(120)}
      />
    {:else}
      <path d="M236 176 C552 330 552 694 236 848" />
      <path d="M788 176 C472 330 472 694 788 848" />
    {/if}
  </g>
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
