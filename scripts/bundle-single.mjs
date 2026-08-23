// Inlines the vite build into one self-contained HTML file (no external requests at all),
// suitable for hosting anywhere that serves a single page.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter(f => f.endsWith('.css')).map(f => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const js = assets.filter(f => f.endsWith('.js')).map(f => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');

// The host page supplies doctype/head/body, so emit only what goes inside them.
const html = `<title>Azeroth-Lite</title>
<style>
${css}
</style>
<canvas id="game"></canvas>
<script type="module">
${js}
</script>
`;

const out = join(dist, 'azeroth-lite.html');
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB`);
