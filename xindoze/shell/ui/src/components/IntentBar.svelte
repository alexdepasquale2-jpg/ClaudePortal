<!--
  The Intent Bar. Focused on load; Ctrl+Alt+Space focuses it from anywhere;
  Enter sends; Up and Down walk through earlier intents.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { shell } from '../lib/shell.svelte';

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  /** Position in history; equal to its length when editing a fresh draft. */
  let cursor = shell.history.length;
  let draft = '';

  onMount(() => input?.focus());

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    value = '';
    void shell.send(text);
    cursor = shell.history.length;
    draft = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const h = shell.history;
    if (e.key === 'ArrowUp' && cursor > 0) {
      if (cursor === h.length) draft = value;
      cursor = Math.min(cursor, h.length) - 1;
      value = h[cursor];
    } else if (e.key === 'ArrowDown' && cursor < h.length) {
      cursor++;
      value = cursor === h.length ? draft : h[cursor];
    } else {
      return;
    }
    e.preventDefault();
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && e.code === 'Space') {
      e.preventDefault();
      input?.focus();
      input?.select();
    }
  }
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<form class="bar" onsubmit={submit}>
  <label class="sr-only" for="intent">Intent</label>
  <span class="prompt" aria-hidden="true">›</span>
  <input
    id="intent"
    bind:this={input}
    bind:value
    oninput={() => (cursor = shell.history.length)}
    onkeydown={onKeydown}
    type="text"
    placeholder="Tell Xindoze what you want"
    autocomplete="off"
    autocapitalize="sentences"
    spellcheck="true"
    enterkeyhint="send"
    aria-describedby="intent-hint"
  />
  <span id="intent-hint" class="sr-only"
    >Enter sends. Up arrow recalls earlier intents. Control Alt Space returns here.</span
  >
  <button class="send" type="submit" aria-label="Send" disabled={!value.trim()}>
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</form>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 16px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--control);
    transition: border-color 120ms ease;
  }

  .bar:focus-within {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 25%, transparent);
  }

  .prompt {
    color: var(--ember-ink);
    font-weight: 700;
    font-size: 1.15rem;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    border: 0;
    background: transparent;
    font-size: 1rem;
  }

  input:focus {
    outline: none;
  }

  input::placeholder {
    color: var(--muted);
    opacity: 1;
  }

  .send {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 0;
    background: var(--ember);
    color: var(--on-fill);
  }

  .send:disabled {
    background: var(--surface-2);
    color: var(--muted);
    opacity: 1;
  }

  @media (pointer: coarse) {
    .send {
      width: var(--tap);
      height: var(--tap);
    }
  }
</style>
