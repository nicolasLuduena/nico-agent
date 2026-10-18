<script lang="ts">
  // Answer an Asking Implementer under its screen, in its agent panel: in
  // words, by an option the screen shows, or a key at a time; each
  // `POST /api/answer`, then `answered`, which reads the screen again.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { options } from "./answer";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { issue, screen, answered }: { issue: string; screen: string; answered: () => void } = $props();
  const id = $props.id();

  /** The keys any dialog takes: what each shows, herdr's name for it, and what it is called. */
  const KEYS = [
    ["↑", "up", "Up"],
    ["↓", "down", "Down"],
    ["Tab", "tab", "Tab"],
    ["Enter", "enter", "Enter"],
    ["Esc", "esc", "Esc"],
  ] as const;

  let text = $state("");
  let running = $state(false);
  let sent = $state<Sent | null>(null);
  const picks = $derived(options(screen));

  async function answer(body: { text: string } | { keys: string[] }) {
    // One at a time; a key stays enabled, so focus stays on it for the next press.
    if (running) return;
    running = true;
    sent = null;
    sent = await send("POST", "/api/answer", { issue, ...body });
    running = false;
    // Sent, the box empties and Send disables: focus goes back to the box for the next answer.
    if (sent.ok && "text" in body) {
      text = "";
      box?.focus({ preventScroll: true });
    }
    answered();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (text.trim()) void answer({ text });
  }

  let box = $state<HTMLInputElement | null>(null);
</script>

<section aria-labelledby="{id}-head">
  <h3 id="{id}-head">Answer</h3>
  {#if picks.length}
    <div class="picks" role="group" aria-label="Options">
      {#each picks as o (o.key)}
        <Button variant="outline" class="px-3 py-2 text-left wrap-anywhere" aria-busy={running} onclick={() => answer({ keys: [o.key] })}
          ><span class="digit">{o.key}</span> {o.label}</Button
        >
      {/each}
    </div>
  {/if}
  <div class="keys" role="group" aria-label="Keys">
    {#each KEYS as [face, key, name] (key)}
      <Button variant="outline" class="min-w-11 px-3" aria-label={name} aria-busy={running} onclick={() => answer({ keys: [key] })}>{face}</Button>
    {/each}
  </div>
  <form onsubmit={submit}>
    <label class="field">
      <span class="field-name">Answer in words</span>
      <Input bind:value={text} bind:ref={box} autocomplete="off" />
    </label>
    <Button type="submit" disabled={!text.trim() || running} aria-busy={running}>
      {running ? "Sending…" : "Send"}
    </Button>
  </form>
  {#if sent && !sent.ok}
    <Refused error={sent.error} help={sent.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .picks {
    display: grid;
    gap: 8px;
  }
  .digit {
    margin-right: 4px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: end;
    gap: 8px;
  }
</style>
