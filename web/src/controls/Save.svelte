<script lang="ts">
  // Beside a field that saves as it changes: Saving… while its PATCH runs,
  // then Saved for a moment, which a screen reader hears politely; between
  // saves, what `children` puts there, such as where the setting comes from.
  import type { Snippet } from "svelte";

  let { state, children }: { state: "saving" | "saved" | null; children?: Snippet } = $props();
</script>

<span class="save" class:saved={state === "saved"} role="status"
  >{#if state === "saving"}<span aria-hidden="true">Saving…</span>{:else if state === "saved"}Saved{/if}</span
>{#if !state}{@render children?.()}{/if}
