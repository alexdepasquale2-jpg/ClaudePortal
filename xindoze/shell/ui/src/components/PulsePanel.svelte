<!-- Pulse: models loaded, tokens per second, Hive peers and egress (SPEC §3.11). -->
<script lang="ts">
  import { shell } from '../lib/shell.svelte';

  const p = $derived(shell.pulse);
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<section class="panel block" aria-labelledby="pulse-title">
  <h2 id="pulse-title" class="eyebrow">Pulse</h2>
  {#if !p}
    <p class="muted">Reading the runtime…</p>
  {:else}
    <div class="zero" class:out={p.egress.length > 0}>
      <span class="dot {p.egress.length ? 'alert' : 'good'}" aria-hidden="true"></span>
      <div>
        <p class="big">{p.egress.length ? 'Data left this device' : 'Zero egress'}</p>
        <p class="muted small">
          {p.egress.length
            ? `${p.egress.length} outbound ${p.egress.length === 1 ? 'request' : 'requests'} recently`
            : 'Nothing has left this device.'}
        </p>
      </div>
    </div>
    {#if p.egress.length}
      <ul class="rows egress">
        {#each [...p.egress].reverse() as e, i (i)}
          <li>
            <span class="mono" title={e.host}>{e.host}</span>
            <span class="muted small">{time(e.ts_ms)}</span>
            <span class="badge {e.allowed ? '' : 'alert'}">{e.allowed ? 'allowed' : 'blocked'}</span
            >
          </li>
        {/each}
      </ul>
    {/if}

    <dl class="stats">
      <div>
        <dt>Tokens/s</dt>
        <dd>{p.tokens_per_sec.toFixed(1)}</dd>
      </div>
      <div>
        <dt>Requests</dt>
        <dd>{p.requests}</dd>
      </div>
      <div>
        <dt>Journal</dt>
        <dd>{p.journal_count}</dd>
      </div>
    </dl>
    <p class="muted small">{p.host} · {p.tier} tier</p>

    <h3 class="sub">Models</h3>
    <ul class="rows">
      {#each p.models as m (m.role + m.model)}
        <li>
          <span class="role">{m.role}</span>
          <span class="mono name">{m.model}</span>
          <span class="state small" class:on={m.loaded}>
            <span class="dot {m.loaded ? 'good' : ''}" aria-hidden="true"></span>{m.loaded
              ? 'loaded'
              : 'idle'}
          </span>
        </li>
      {/each}
    </ul>

    <h3 class="sub">Hive</h3>
    {#if p.peers.length}
      <ul class="rows">
        {#each p.peers as peer (peer.name)}
          <li>
            <span class="name">{peer.name}</span>
            <span class="state small" class:on={peer.online}>
              <span class="dot {peer.online ? 'good' : ''}" aria-hidden="true"></span>{peer.online
                ? 'online'
                : 'offline'}
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">No paired devices.</p>
    {/if}
  {/if}
</section>

<style>
  .zero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--biolume) 10%, var(--surface));
  }

  .zero.out {
    background: color-mix(in srgb, var(--ember) 14%, var(--surface));
  }

  .zero .dot {
    width: 14px;
    height: 14px;
    box-shadow: 0 0 12px currentColor;
  }

  .zero:not(.out) .dot {
    color: var(--biolume);
  }

  .zero.out .dot {
    color: var(--ember);
  }

  .big {
    font-weight: 650;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0;
  }

  .stats div {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  dt {
    font-size: 0.75rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .role {
    text-transform: capitalize;
    font-weight: 600;
    min-width: 56px;
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  .state.on {
    color: var(--fg);
  }

  .egress .mono {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
