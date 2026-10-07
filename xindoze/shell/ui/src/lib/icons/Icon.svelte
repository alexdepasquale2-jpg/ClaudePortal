<script lang="ts">
  import { iconNames, type IconName } from './names';

  const raw = import.meta.glob('./*.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const byName: Record<string, string> = {};
  for (const [path, svg] of Object.entries(raw)) {
    byName[path.slice(path.lastIndexOf('/') + 1, -4)] = svg;
  }

  let { name, size = 24 }: { name: IconName; size?: number } = $props();

  const markup = $derived.by(() => {
    const svg = byName[name];
    if (!svg) return '';
    return svg.replace(
      '<svg ',
      `<svg width="${size}" height="${size}" aria-hidden="true" focusable="false" style="flex:none;display:block" `,
    );
  });
</script>

<!-- Local SVG files only. Names are the closed iconNames list. -->
{#if iconNames.includes(name)}
  {@html markup}
{/if}
