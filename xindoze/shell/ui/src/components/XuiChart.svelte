<!--
  XUI chart: bar or line as inline SVG, sized to its container in CSS pixels
  so text stays legible on phones. A text summary labels the graphic and a
  data table carries every value.
-->
<script lang="ts">
  import { MAX_SERIES, fmt, layout, summary, type ChartNode } from '../lib/chart';

  let { node }: { node: ChartNode } = $props();

  const id = $props.id();
  const HEIGHT = 220;
  let width = $state(0);

  const geo = $derived(width > 0 ? layout(node, width, HEIGHT) : null);
  const caption = $derived(summary(node));
  const shown = $derived(node.series.slice(0, MAX_SERIES));
  const color = (i: number) => `var(--series-${i + 1})`;
  // 1px lines land on whole pixels.
  const crisp = (v: number) => Math.round(v) + 0.5;
</script>

<div class="chart">
  <figure>
    {#if shown.length > 1}
      <ul class="legend">
        {#each shown as s, i (i)}
          <li><span class="swatch" style:background={color(i)}></span>{s.name}</li>
        {/each}
      </ul>
    {/if}

    <div class="plot" bind:clientWidth={width}>
      {#if geo}
        <svg
          width={geo.width}
          height={geo.height}
          viewBox="0 0 {geo.width} {geo.height}"
          role="img"
          aria-labelledby="{id}-summary"
        >
          <g class="axis">
            {#each geo.ticks as t, i (i)}
              <line
                class:zero={t.label === '0'}
                x1={geo.left}
                x2={geo.width - geo.right}
                y1={crisp(t.y)}
                y2={crisp(t.y)}
              />
              <text x={geo.left - 8} y={t.y} dy="0.32em" text-anchor="end">{t.label}</text>
            {/each}
            {#each geo.xLabels as l, i (i)}
              <text x={l.x} y={geo.height - 8} text-anchor="middle">{l.label}</text>
            {/each}
          </g>
          {#each geo.bars as b, i (i)}
            <path d={b.d} fill={color(b.series)}><title>{b.title}</title></path>
          {/each}
          {#each geo.lines as line (line.series)}
            <path class="line" d={line.d} stroke={color(line.series)} />
            {#each line.points as p, i (i)}
              <circle cx={p.x} cy={p.y} r="4" fill={color(line.series)}
                ><title>{p.title}</title></circle
              >
            {/each}
          {/each}
          {#each geo.callouts as c, i (i)}
            <text
              class="callout"
              x={c.x}
              y={c.y}
              dy={c.anchor === 'start' ? '0.32em' : '0'}
              text-anchor={c.anchor}
            >
              {c.label}
            </text>
          {/each}
        </svg>
      {/if}
    </div>

    <figcaption id="{id}-summary">{caption}</figcaption>
  </figure>

  <details>
    <summary>Show data</summary>
    <div class="data">
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">Label</span></th>
            {#each node.series as s, i (i)}<th scope="col">{s.name}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each node.x as label, r (r)}
            <tr>
              <th scope="row">{label}</th>
              {#each node.series as s, i (i)}<td>{fmt(s.values[r])}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</div>

<style>
  .chart,
  figure {
    margin: 0;
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 0.8125rem;
    color: var(--muted);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .plot {
    min-width: 0;
    min-height: 220px;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .axis line {
    stroke: var(--grid);
    stroke-width: 1;
  }

  .axis line.zero {
    stroke: var(--control);
  }

  text {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .callout {
    fill: var(--fg);
    font-weight: 600;
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  circle {
    /* A ring in the surface color keeps overlapping points apart. */
    stroke: var(--chart-ring, var(--surface));
    stroke-width: 2;
  }

  figcaption {
    font-size: 0.8125rem;
    color: var(--muted);
  }

  summary {
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--muted);
    width: fit-content;
  }

  .data {
    position: relative;
    margin-top: 6px;
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 4px 12px 4px 0;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }

  th {
    font-weight: 600;
  }

  @media (forced-colors: active) {
    path,
    circle {
      forced-color-adjust: none;
    }
  }
</style>
