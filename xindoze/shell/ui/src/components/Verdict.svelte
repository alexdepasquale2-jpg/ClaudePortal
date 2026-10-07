<!-- A Warden verdict as a badge. Words carry the meaning; color only reinforces it. -->
<script lang="ts">
  import type { Verdict } from '../lib/api';

  let { verdict }: { verdict: Verdict } = $props();

  const tone: Record<Verdict, string> = {
    allowed: '',
    confirmed: 'good',
    declined: 'dim',
    denied: 'alert',
  };
</script>

<span class="badge {tone[verdict] ?? ''}">{verdict}</span>
