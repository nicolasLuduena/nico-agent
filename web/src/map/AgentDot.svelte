<script lang="ts">
  // An agent's Agent state as a 10px dot: its hue, and a shape of its own so
  // colour is never the only sign. The caller says it in words beside it.
  import type { AgentState } from "./layout";

  let { state }: { state: AgentState } = $props();
</script>

<span class="dot {state}" aria-hidden="true"></span>

<style>
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--rule);
    border-radius: 50%;
  }
  /* Working: a solid green disc. */
  .working {
    border-color: var(--verified);
    background: var(--verified);
  }
  /* Asking: Needs you's amber disc, ringed in its ink, a size up. */
  .asking {
    width: 12px;
    height: 12px;
    border-color: var(--signal-ink);
    background: var(--signal-edge);
  }
  /* Idle: a grey ring; done, the ring with a dot in it; unknown, the ring dashed. */
  .done {
    background: radial-gradient(circle, var(--rule) 0 2px, transparent 2.5px);
  }
  .unknown {
    border-style: dashed;
  }
</style>
