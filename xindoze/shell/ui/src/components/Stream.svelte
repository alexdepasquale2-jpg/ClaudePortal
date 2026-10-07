<!-- The Stream: intents, replies and action cards, newest at the bottom. -->
<script lang="ts">
  import { tick } from 'svelte';
  import streamEmpty from '../../../../assets/canvas/empty/stream.svg';
  import { entrance } from '../lib/motion';
  import { shell } from '../lib/shell.svelte';
  import Logo from './Logo.svelte';
  import TaskCard from './TaskCard.svelte';

  let log: HTMLElement | undefined = $state();
  let pinned = true;

  function onScroll() {
    if (!log) return;
    // Follow new entries only while the reader is at the bottom.
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }

  $effect(() => {
    // Track entry count and the step count of the newest entry.
    const last = shell.entries[shell.entries.length - 1];
    void shell.entries.length;
    void (last?.kind === 'task' ? [last.steps.length, last.outcome, last.error] : null);
    if (!pinned) return;
    tick().then(() => {
      if (!log) return;
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (the Stream scrolls; keyboard users must be able to scroll it) -->
<div class="stream" bind:this={log} onscroll={onScroll} role="log" aria-label="Stream" tabindex="0">
  {#each shell.entries as entry (entry.key)}
    {#if entry.kind === 'boot'}
      <p class="boot">
        <Logo size={40} animate />
        <span
          use:entrance={{
            keyframes: [
              { opacity: 0, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'none' },
            ],
            duration: 900,
            delay: 300,
          }}
          >Xindoze has evolved.</span
        >
      </p>
      {#if shell.entries.length === 1}
        <img class="empty-art" src={streamEmpty} alt="" width="200" height="143" />
      {/if}
    {:else if entry.kind === 'intent'}
      <p class="intent">
        <span class="prompt" aria-hidden="true">›</span>
        <span class="sr-only">You:</span>
        <span class="text">{entry.text}</span>
        {#if entry.organism}<span class="to">to {entry.organism.replace(/^xindoze\./, '')}</span
          >{/if}
      </p>
    {:else}
      <TaskCard {entry} />
    {/if}
  {/each}
</div>

<style>
  .stream {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .stream:focus {
    outline: none;
  }

  .boot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 4px 10px;
    font-family: var(--font-mono);
    font-size: 1.05rem;
    letter-spacing: 0.01em;
  }

  .empty-art {
    align-self: center;
    margin: 12px 0 28px;
    opacity: 0.9;
  }

  .intent {
    align-self: flex-end;
    max-width: min(90%, 560px);
    padding: 8px 14px;
    border-radius: var(--radius) var(--radius) 4px var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .prompt {
    color: var(--ember-ink);
    font-weight: 700;
    margin-right: 6px;
  }

  .to {
    margin-left: 6px;
    font-size: 0.75rem;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
