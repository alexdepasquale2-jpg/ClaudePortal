<!-- The Charter: the user's policy as plain-language rules. -->
<script lang="ts">
  import type { RuleDecision } from '../lib/api';
  import { shell } from '../lib/shell.svelte';

  const tone: Record<RuleDecision, string> = { allow: 'good', ask: '', deny: 'alert' };
</script>

<section class="panel block" aria-labelledby="charter-title">
  <h2 id="charter-title" class="eyebrow">Charter</h2>
  {#if shell.rules.length === 0}
    <p class="muted small">
      No rules yet. Defaults apply: reads are allowed, changes are journaled, and anything
      irreversible asks first.
    </p>
  {:else}
    <ul class="rows">
      {#each shell.rules as rule (rule.id)}
        <li>
          <span class="text">{rule.text}</span>
          <span class="badge {tone[rule.decision] ?? ''}">{rule.decision}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  li {
    align-items: flex-start;
  }

  .text {
    flex: 1;
    font-size: 0.875rem;
  }
</style>
