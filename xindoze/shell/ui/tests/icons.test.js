import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../src/lib/icons/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.svg'));

test('canvas icons are a 24 px currentColor stroke set', () => {
  assert.ok(files.length >= 28);
  for (const name of files) {
    const svg = readFileSync(new URL(name, dir), 'utf8');
    assert.match(svg, /viewBox="0 0 24 24"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    assert.doesNotMatch(svg, /#[0-9A-Fa-f]{3,8}/, name);
  }
});
