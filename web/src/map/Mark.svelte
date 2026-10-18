<svelte:options namespace="svg" />

<script lang="ts">
  // A Stage's mark, DESIGN.md's table: an icon beside the Stage's word, in its
  // hue. A 14px cell; the caller places it. Nothing for no Stage.
  import { stageHue } from "../hues";

  let { stage }: { stage: string | null } = $props();
</script>

<g class="mark" style:--hue={stageHue(stage)} aria-hidden="true">
  {#if stage === "Waiting"}
    <circle cx="7" cy="7" r="5.75" class="ring" stroke-dasharray="2.5 2" />
  {:else if stage === "Ready" || stage === "Stackable"}
    <circle cx="7" cy="7" r="5.75" class="ring" />
    {#if stage === "Stackable"}<circle cx="7" cy="7" r="2" class="disc" />{/if}
  {:else if stage === "Implementing"}
    <circle cx="7" cy="7" r="5.75" class="ring" />
    <path d="M7 1.25 A5.75 5.75 0 0 0 7 12.75 Z" class="disc" />
  {:else if stage === "PR draft" || stage === "Merged"}
    <circle cx="7" cy="7" r="6.5" class="disc" />
  {:else if stage === "Verified"}
    <circle cx="7" cy="7" r="6" class="ring" />
    <circle cx="7" cy="7" r="2.75" class="ring" />
  {:else if stage === "Closed"}
    <circle cx="7" cy="7" r="5.75" class="ring" />
    <path d="M2 12 L12 2" class="ring" />
  {:else if stage === "Failed"}
    <path d="M2 2 L12 12 M12 2 L2 12" class="ring strike" />
  {/if}
</g>

<style>
  .mark {
    color: var(--hue, var(--ink));
  }
  .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  .strike {
    stroke-width: 2.25;
  }
  .disc {
    fill: currentColor;
  }
</style>
