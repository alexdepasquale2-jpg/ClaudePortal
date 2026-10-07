// Run with `npm test` (Node strips the TypeScript types on import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, inline, safeHref } from '../src/lib/markdown.ts';

test('bold, italic, code and links', () => {
  assert.deepEqual(inline('**41** so *far* in `~/x` see [docs](https://a.dev/p)'), [
    { kind: 'strong', text: '41' },
    { kind: 'text', text: ' so ' },
    { kind: 'em', text: 'far' },
    { kind: 'text', text: ' in ' },
    { kind: 'code', text: '~/x' },
    { kind: 'text', text: ' see ' },
    { kind: 'link', text: 'docs', href: 'https://a.dev/p' },
  ]);
});

test('links other than http(s) keep only their label', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.deepEqual(inline(`[click](${url})`), [{ kind: 'text', text: 'click' }], url);
  }
  assert.equal(safeHref('HTTPS://Example.com'), 'https://example.com/');
  assert.deepEqual(inline('[w](https://en.wikipedia.org/wiki/X_(letter))'), [
    { kind: 'link', text: 'w', href: 'https://en.wikipedia.org/wiki/X_(letter)' },
  ]);
});

test('markup in text stays text', () => {
  const out = inline('<img src=x onerror=alert(1)> & <script>');
  assert.deepEqual(out, [{ kind: 'text', text: '<img src=x onerror=alert(1)> & <script>' }]);
});

test('arithmetic and snake_case are not emphasis', () => {
  assert.deepEqual(inline('2 * 3 * 4'), [{ kind: 'text', text: '2 * 3 * 4' }]);
  assert.deepEqual(inline('my_file_name.txt'), [{ kind: 'text', text: 'my_file_name.txt' }]);
  assert.deepEqual(inline('_yes_'), [{ kind: 'em', text: 'yes' }]);
});

test('escapes and unclosed markers', () => {
  assert.deepEqual(inline('\\*not\\* **open'), [{ kind: 'text', text: '*not* **open' }]);
  assert.deepEqual(inline('`'), [{ kind: 'text', text: '`' }]);
});

test('paragraphs and lists', () => {
  const out = blocks('Done.\n\n- one\n- **two**\n\n1. a\n2. b\n\n1. a\nnot a list');
  assert.deepEqual(
    out.map((b) => b.kind),
    ['p', 'ul', 'ol', 'p'],
  );
  assert.deepEqual(out[1].items[1], [{ kind: 'strong', text: 'two' }]);
  assert.deepEqual(out[3].inlines, [{ kind: 'text', text: '1. a\nnot a list' }]);
});
