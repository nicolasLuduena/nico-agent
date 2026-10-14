<script lang="ts">
  // Answer an Asking Implementer from what its pane shows: in words, by an
  // option's digit, or a key at a time; each `POST /api/answer`, then the
  // pane is read again to show what it did.
  import { reload } from "../live";
  import { selection } from "../selection.svelte";
  import { options } from "./answer";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { issue, pane, error }: { issue: string; pane?: string; error?: string } = $props();
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
  // The screen's padding, its blank margins and the empty rows a terminal leaves
  // between its output and its prompt left out: only what it says is scrolled.
  const shown = $derived(
    (pane ?? "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, ""),
  );
  const picks = $derived(options(shown));

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
      box.focus({ preventScroll: true });
    }
    reload(`/api/node/${encodeURIComponent(issue)}`);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (text.trim()) void answer({ text });
  }

  // The needs-you band opened this node to answer it: the text box takes focus,
  // leaving the panel at its top, where the pane is.
  let box: HTMLInputElement;
  $effect(() => {
    if (selection.answering !== issue) return;
    box.focus({ preventScroll: true });
    selection.answering = null;
  });

  // The dialog is at the foot of the screen: the box starts scrolled to it.
  let screen = $state<HTMLElement>();
  $effect(() => {
    void shown;
    if (screen) screen.scrollTop = screen.scrollHeight;
  });
</script>

<section aria-labelledby="{id}-head">
  <h3 class="label" id="{id}-head">Asking</h3>
  {#if error}
    <Refused {error} help={[]} />
  {:else}
    <!-- Scrolls inside its box, so a keyboard can reach it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre class="pane" tabindex="0" aria-label="The Implementer's pane" bind:this={screen}>{shown}</pre>
  {/if}
  {#if picks.length}
    <div class="picks" role="group" aria-label="Options">
      {#each picks as o (o.key)}
        <button type="button" class="quiet" aria-busy={running} onclick={() => answer({ keys: [o.key] })}
          ><span class="digit">{o.key}</span> {o.label}</button
        >
      {/each}
    </div>
  {/if}
  <div class="keys" role="group" aria-label="Keys">
    {#each KEYS as [face, key, name] (key)}
      <button type="button" class="quiet" aria-label={name} aria-busy={running} onclick={() => answer({ keys: [key] })}>{face}</button>
    {/each}
  </div>
  <form onsubmit={submit}>
    <label class="field">
      <span class="field-name">Answer in words</span>
      <input bind:value={text} bind:this={box} autocomplete="off" />
    </label>
    <button type="submit" class="button" disabled={!text.trim() || running} aria-busy={running}>
      {running ? "Sending…" : "Send"}
    </button>
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
    color: var(--ink-muted);
  }
  /* The screen as herdr reads it: unwrapped, scrolling inside its own box, never the panel. */
  .pane {
    margin: 0;
    max-height: 24em;
    overflow: auto;
    padding: 8px 12px;
    border: 1px solid var(--hairline);
    background: var(--ground);
    color: var(--ink);
    font: 400 14px/1.35 ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
    white-space: pre;
    tab-size: 8;
  }
  .picks {
    display: grid;
    gap: 8px;
  }
  /* An option says what it picks, whole, wrapping under itself. */
  .picks button {
    padding: 8px 12px;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .digit {
    margin-right: 4px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .keys button {
    min-width: 44px;
    padding: 0 12px;
  }
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: end;
    gap: 8px;
  }
  /* On a phone the pane, its options and the keys share the sheet's first screen. */
  @media (width < 720px) {
    .pane {
      max-height: 30vh;
    }
  }
</style>
