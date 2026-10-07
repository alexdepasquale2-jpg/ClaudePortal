import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_TYPES, countNodes, problem } from '../src/lib/xui.ts';
import { layout, niceTicks, summary } from '../src/lib/chart.ts';

test('all 12 Appendix B types are known', () => {
  assert.equal(KNOWN_TYPES.size, 12);
  assert.ok(!KNOWN_TYPES.has('html'));
});

test('refuses missing accessibility props and remote images', () => {
  assert.match(problem({ type: 'button', label: ' ', action: { intent: 'x' } }, 1), /label/);
  assert.match(problem({ type: 'input', label: '', kind: 'text', bind: 'a' }, 1), /label/);
  assert.match(problem({ type: 'image', src: 'abc', alt: '' }, 1), /alt/);
  assert.match(problem({ type: 'image', src: 'https://evil.example/x.png', alt: 'x' }, 1), /local/);
  assert.match(problem({ type: 'progress', value: 1, max: 2, label: '' }, 1), /label/);
  assert.match(problem({ type: 'heading', text: 'h', level: 7 }, 1), /1-6/);
  assert.match(problem({ type: 'table', columns: ['a', 'b'], rows: [['1']] }, 1), /width/);
  assert.match(
    problem({ type: 'chart', kind: 'bar', x: ['a'], series: [{ name: 's', values: [] }] }, 1),
    /length/,
  );
  assert.match(problem({ type: 'text', text: 'deep' }, 9), /deeper/);
  assert.equal(problem({ type: 'image', src: 'sha256-abc', alt: 'A cat' }, 1), null);
});

test('counts nodes through stacks and cards', () => {
  const tree = {
    type: 'stack',
    children: [
      { type: 'card', title: 't', children: [{ type: 'text', text: 'a' }] },
      { type: 'text', text: 'b' },
    ],
  };
  assert.equal(countNodes(tree), 4);
});

test('nice ticks include zero and cover the data', () => {
  assert.deepEqual(niceTicks(0, 9), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceTicks(-3, 7), [-5, -2.5, 0, 2.5, 5, 7.5]);
  assert.deepEqual(niceTicks(0, 1234), [0, 500, 1000, 1500]);
  assert.deepEqual(niceTicks(0, 0), [0, 0.25, 0.5, 0.75, 1]);
});

const week = {
  type: 'chart',
  kind: 'bar',
  x: ['Mon', 'Tue', 'Wed'],
  series: [{ name: 'Glasses', values: [3, 8, 5] }],
  y: 'glasses',
};

test('bars stay thin and label only the highest value', () => {
  const g = layout(week, 600, 220);
  assert.equal(g.bars.length, 3);
  assert.equal(g.callouts.length, 1);
  assert.equal(g.callouts[0].label, '8');
  for (const b of g.bars) {
    const xs = [...b.d.matchAll(/[MHQ](-?[\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 24, 'bar is at most 24px wide');
  }
});

test('line charts get one path per series and an end label', () => {
  const g = layout(
    { ...week, kind: 'line', series: [...week.series, { name: 'Goal', values: [8, 8, 8] }] },
    400,
    200,
  );
  assert.equal(g.lines.length, 2);
  assert.equal(g.lines[0].points.length, 3);
  assert.equal(g.callouts.length, 2);
});

test('summary names extremes for screen readers', () => {
  assert.equal(
    summary(week),
    'Bar chart of glasses, Mon to Wed. Glasses: highest 8 (Tue), lowest 3 (Mon), latest 5.',
  );
});
