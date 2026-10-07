<!--
  The Canvas shell. Wide screens show Stream, Canvas and System side by side;
  below 1100px one view shows at a time, picked from the header. The ask dock
  and Intent Bar stay visible in every view.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { shell, type View } from './lib/shell.svelte';
  import AskDock from './components/AskDock.svelte';
  import BootScreen from './components/BootScreen.svelte';
  import CanvasPane from './components/CanvasPane.svelte';
  import CharterList from './components/CharterList.svelte';
  import EgressBadge from './components/EgressBadge.svelte';
  import GenomesList from './components/GenomesList.svelte';
  import IntentBar from './components/IntentBar.svelte';
  import JournalList from './components/JournalList.svelte';
  import Logo from './components/Logo.svelte';
  import ConquestPanel from './components/ConquestPanel.svelte';
  import PulsePanel from './components/PulsePanel.svelte';
  import Stream from './components/Stream.svelte';

  onMount(() => shell.start());

  const views: { id: View; label: string }[] = [
    { id: 'stream', label: 'Stream' },
    { id: 'canvas', label: 'Canvas' },
    { id: 'system', label: 'System' },
  ];
</script>

<div class="app" data-view={shell.view}>
  <header class="top">
    <div class="brand">
      <Logo size={26} />
      <span class="word">Xindoze</span>
    </div>
    <nav class="views" aria-label="Views">
      {#each views as v (v.id)}
        <button
          type="button"
          class="view-btn"
          aria-pressed={shell.view === v.id}
          onclick={() => (shell.view = v.id)}
        >
          {v.label}
          {#if v.id === 'system' && shell.asks.length}<span class="sr-only">(approval waiting)</span
            >{/if}
        </button>
      {/each}
    </nav>
    <EgressBadge />
  </header>

  <main class="stream-col" class:active={shell.view === 'stream'}>
    <Stream />
  </main>

  <div class="canvas-col" class:active={shell.view === 'canvas'}>
    <CanvasPane />
  </div>

  <aside class="system-col" class:active={shell.view === 'system'} aria-label="System">
    <PulsePanel />
    <ConquestPanel />
    <GenomesList />
    <CharterList />
    <JournalList />
  </aside>

  <div class="dock">
    <AskDock />
    <IntentBar />
  </div>

  <p class="sr-only" role="status" aria-live="polite">{shell.announcement}</p>
  <BootScreen />
</div>

<style>
  .app {
    /* Contain absolutely positioned descendants (.sr-only) and never scroll the document. */
    position: relative;
    overflow: clip;
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top'
      'view'
      'dock';
  }

  .top {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: max(10px, env(safe-area-inset-top)) 16px 10px;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .word {
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: 0.01em;
  }

  .views {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--line);
    margin-left: auto;
  }

  .view-btn {
    min-height: 32px;
    padding: 4px 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 550;
  }

  .view-btn[aria-pressed='true'] {
    background: var(--surface-2);
    color: var(--fg);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .stream-col,
  .canvas-col,
  .system-col {
    grid-area: view;
    min-height: 0;
    display: none;
  }

  .stream-col.active,
  .canvas-col.active,
  .system-col.active {
    display: block;
  }

  .canvas-col,
  .system-col {
    position: relative;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .system-col.active {
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 16px;
  }

  .dock {
    grid-area: dock;
    padding: 8px 12px max(12px, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    background: var(--bg);
  }

  /* Phones: the brand shrinks to the mark so the view switch and egress fit. */
  @media (max-width: 520px) {
    .word {
      display: none;
    }

    .top {
      gap: 8px;
      padding-inline: 12px;
    }

    .views {
      margin-left: 0;
    }

    .view-btn {
      padding: 4px 10px;
    }

    .top :global(.egress) {
      margin-left: auto;
      padding: 4px 8px;
    }
  }

  @media (max-width: 400px) {
    .top :global(.egress) {
      font-size: 0;
      gap: 0;
      padding: 8px;
    }
  }

  /* Wide: everything at once (keep in sync with NARROW in shell.svelte.ts). */
  @media (min-width: 1100px) {
    .app {
      grid-template-columns: minmax(380px, 1fr) minmax(0, 1.25fr) 320px;
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'top top top'
        'stream canvas system'
        'dock canvas system';
    }

    .views {
      display: none;
    }

    .top :global(.egress) {
      margin-left: auto;
    }

    .stream-col,
    .canvas-col,
    .system-col {
      display: block;
    }

    .stream-col {
      grid-area: stream;
    }

    .canvas-col {
      grid-area: canvas;
      border-left: 1px solid var(--line);
      border-right: 1px solid var(--line);
      background: var(--surface);
    }

    .system-col,
    .system-col.active {
      grid-area: system;
      display: grid;
      align-content: start;
      gap: 12px;
      padding: 16px;
    }

    .dock {
      border-top: 0;
      padding: 8px 16px 16px;
    }
  }
</style>
