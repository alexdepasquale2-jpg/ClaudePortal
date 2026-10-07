<!--
  XUI input. The value lives in the pane's binds under `bind`; tool buttons in
  the same pane receive it as an argument of that name.
-->
<script lang="ts">
  import type { InputKind } from '../lib/api';
  import { getXui } from '../lib/xui-context';

  let { node }: { node: { label: string; kind: InputKind; bind: string } } = $props();

  const ctx = getXui();
  const id = $props.id();
  const value = $derived(ctx.pane.binds[node.bind]);

  function set(v: string | number | boolean | null) {
    if (v === null || v === '') delete ctx.pane.binds[node.bind];
    else ctx.pane.binds[node.bind] = v;
  }

  function onInput(e: Event & { currentTarget: HTMLInputElement }) {
    const el = e.currentTarget;
    if (node.kind !== 'number') return set(el.value);
    set(Number.isFinite(el.valueAsNumber) ? el.valueAsNumber : null);
  }
</script>

{#if node.kind === 'toggle'}
  <label class="toggle">
    <input
      type="checkbox"
      role="switch"
      checked={value === true}
      onchange={(e) => set(e.currentTarget.checked)}
    />
    <span>{node.label}</span>
  </label>
{:else}
  <div class="field">
    <label for={id}>{node.label}</label>
    <input
      {id}
      type={node.kind === 'number' ? 'number' : node.kind === 'date' ? 'date' : 'text'}
      inputmode={node.kind === 'number' ? 'decimal' : undefined}
      value={value ?? ''}
      oninput={onInput}
    />
  </div>
{/if}

<style>
  .field {
    display: grid;
    gap: 4px;
    max-width: 360px;
  }

  label {
    font-size: 0.875rem;
  }

  .field input {
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--control);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    cursor: pointer;
  }

  .toggle input {
    width: 20px;
    height: 20px;
    accent-color: var(--meter);
  }
</style>
