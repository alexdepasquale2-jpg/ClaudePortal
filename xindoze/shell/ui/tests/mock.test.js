import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMock } from '../src/lib/mock.ts';

test('a water intent returns a chart UI and streams its steps', async () => {
  const rt = createMock({ delayMs: 0 });
  const steps = [];
  await rt.listen('xz://step', (e) => steps.push(e));
  const out = await rt.invoke('intent', { text: 'show my water this week' });
  assert.equal(out.organism, 'xindoze.hydrate');
  assert.ok(JSON.stringify(out.ui).includes('"type":"chart"'));
  assert.equal(steps.length, out.steps.length);
  assert.equal(steps[0].task_id, out.task_id);
});

test('a commit intent waits for an ask and records the answer', async () => {
  const rt = createMock({ delayMs: 0 });
  const asks = [];
  await rt.listen('xz://ask', (e) => {
    asks.push(e);
    void rt.invoke('confirm_reply', { id: e.id, approve: false });
  });
  const out = await rt.invoke('intent', { text: 'post my notes summary to the forum' });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].ask.tool, 'net.post');
  assert.ok(asks[0].ask.taint.sources.includes('web:forum.example.org'));
  assert.equal(out.steps.at(-1).verdict, 'declined');
  const pulse = await rt.invoke('pulse');
  assert.equal(pulse.egress.length, 0, 'declined post leaves zero egress');
});

test('approving a post shows up as egress', async () => {
  const rt = createMock({ delayMs: 0 });
  await rt.listen('xz://ask', (e) => void rt.invoke('confirm_reply', { id: e.id, approve: true }));
  const out = await rt.invoke('intent', { text: 'send it to the forum' });
  assert.equal(out.steps.at(-1).verdict, 'confirmed');
  assert.equal((await rt.invoke('pulse')).egress[0].host, 'forum.example.org');
});

test('rewind undoes moves once and skips nothing reversible', async () => {
  const rt = createMock({ delayMs: 0 });
  const out = await rt.invoke('intent', {
    text: 'make a folder Taxes 2026 and move every invoice into it',
  });
  const first = await rt.invoke('rewind', { taskId: out.task_id });
  assert.equal(first.undone.length, 4);
  assert.deepEqual(first.failed, []);
  const again = await rt.invoke('rewind', { taskId: out.task_id });
  assert.equal(again.undone.length, 0);
  const journal = await rt.invoke('journal', { limit: 10 });
  assert.ok(
    journal.filter((e) => e.task_id === out.task_id && e.effects.length).every((e) => e.rewound),
  );
});

test('unknown asks and tools are errors', async () => {
  const rt = createMock({ delayMs: 0 });
  await assert.rejects(rt.invoke('confirm_reply', { id: 'nope', approve: true }));
  await assert.rejects(
    rt.invoke('tool_call', { organism: 'x', tool: 'fs.delete_permanent', args: {} }),
  );
});
