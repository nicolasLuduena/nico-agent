<script lang="ts">
  // An agent's panel (desktop) or bottom sheet (phone), in place of its issue's:
  // its role and Agent state, then its chat, streamed from /api/agent/<issue>/<role>/transcript while
  // it is open and the page is visible, or beside it its last 200 lines (its screen while herdr
  // scrolls it only idle) from /api/agent/<issue>/<role>, read again every 3 s likewise, shown in the
  // chat's place while there is none to read; under an Asking Implementer's, the answer controls.
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount } from "svelte";
  import Answer from "../controls/Answer.svelte";
  import { hash } from "../route";
  import { selection } from "../selection.svelte";
  import { numbered, type Project } from "../status";
  import { clock } from "../time";
  import AgentDot from "./AgentDot.svelte";
  import { agentsOf, ROLE, SAYS, type Role } from "./layout";
  import { shown } from "./ProjectMap.svelte";

  let { issue, role, project }: { issue: string; role: Role; project: Project } = $props();

  const EVERY = 3000;
  const node = $derived(shown.map?.nodes.find((n) => n.key === issue) ?? null);
  /** As the map last said it; null once herdr no longer lists it. */
  const doing = $derived(node && (agentsOf(node).find((a) => a.role === role)?.state ?? null));

  let screen = $state<string | null>(null);
  // Its padding, blank margins and the empty rows a terminal leaves between its output and its prompt left out.
  const text = $derived(
    screen
      ?.replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "") ?? null,
  );
  let readAt = $state<string | null>(null);
  /** Why the last read failed: herdr's reason, a refusal, or serve out of reach. */
  let unread = $state<string | null>(null);
  let read: () => void = () => {};

  // One read in flight at a time, the next 3 s after it lands; none while the page is hidden.
  $effect(() => {
    const path = `/api/agent/${encodeURIComponent(issue)}/${role}`;
    screen = readAt = unread = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;
    let stopped = false;
    read = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      const mine = ++latest;
      try {
        const response = await fetch(path, { redirect: "manual" });
        const body = await response.json();
        if (stopped || mine !== latest) return;
        if (typeof body.screen === "string") {
          screen = body.screen;
          readAt = new Date().toISOString();
          unread = null;
        } else unread = body.unread ?? body.error ?? `${path} answered ${response.status}`;
      } catch {
        if (stopped || mine !== latest) return;
        unread = "Could not reach nico-agent serve";
      }
      timer = setTimeout(read, EVERY);
    };
    const visible = () => (document.hidden ? clearTimeout(timer) : read());
    document.addEventListener("visibilitychange", visible);
    read();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  });

  type Entry = { role: string; text?: string };
  let entries = $state<Entry[]>([]);
  /** Why there is no chat to read, while there is none. */
  let missing = $state<string | null>(null);
  let chatOpened = $state(false);
  let view = $state<"chat" | "screen">("chat");
  const said = $derived(entries.filter((e) => e.text));
  /** The chat is shown unless asked for the screen, or there is none to read. */
  const chatting = $derived(view === "chat" && !(missing !== null && said.length === 0));

  // One stream while the panel is open and the page visible; reopened past the last entry it had.
  $effect(() => {
    const path = `/api/agent/${encodeURIComponent(issue)}/${role}/transcript`;
    entries = [];
    missing = null;
    chatOpened = false;
    let session: string | null = null;
    let last: string | null = null;
    let source: EventSource | null = null;
    const open = () => {
      source?.close();
      source = null;
      if (document.hidden) return;
      source = new EventSource(last ? `${path}?after=${encodeURIComponent(last)}` : path);
      source.addEventListener("session", (e) => {
        const now = JSON.parse(e.data).session;
        if (now !== session) entries = [];
        session = now;
        chatOpened = true;
        missing = null;
      });
      source.addEventListener("entries", (e) => {
        entries = [...entries, ...JSON.parse(e.data).entries];
        last = e.lastEventId;
      });
      source.addEventListener("missing", (e) => {
        missing = JSON.parse(e.data).missing;
        chatOpened = true;
      });
      // Refused (no live Dispatch, no such agent): the browser gives up on it, and the screen stands in.
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) missing ??= "nico-agent serve refused its chat";
      };
    };
    document.addEventListener("visibilitychange", open);
    open();
    return () => {
      document.removeEventListener("visibilitychange", open);
      source?.close();
    };
  });

  const PREFIX: Record<string, string> = { user: "› ", tool: "▸ ", result: "  ⎿ " };

  // Pinned to its foot, where the agent writes, unless the user has scrolled up.
  let box = $state<HTMLElement>();
  let pinned = true;
  $effect(() => {
    void text;
    void said.length;
    void chatting;
    if (box && pinned) box.scrollTop = box.scrollHeight;
  });
  function scrolled() {
    if (box) pinned = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  }

  function close() {
    Object.assign(selection, { issue: null, agent: null });
  }

  // Focus moves into the panel as it opens and back to what opened it as it closes, as the issue's panel does.
  let panel: HTMLElement;
  let title: HTMLElement;
  onMount(() => {
    const opener = document.activeElement as HTMLElement | SVGElement | null;
    title.focus();
    return () => {
      const at = document.activeElement;
      if (!at || at === document.body || panel.contains(at)) opener?.focus();
    };
  });

  // On a phone the sheet closes on a swipe down its head, as the issue's does.
  let pulled = $state(0);
  let from: number | null = null;
  function grab(e: PointerEvent) {
    if (matchMedia("(width < 720px)").matches) from = e.clientY;
  }
  function pull(e: PointerEvent) {
    if (from === null) return;
    const head = e.currentTarget as Element;
    if (!head.hasPointerCapture(e.pointerId) && Math.abs(e.clientY - from) > 4) head.setPointerCapture(e.pointerId);
    pulled = Math.max(0, e.clientY - from);
  }
  function release() {
    if (pulled > 64) close();
    pulled = 0;
    from = null;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<section class="inspector" aria-labelledby="agent-title" bind:this={panel} style:transform={pulled ? `translateY(${pulled}px)` : null}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={grab} onpointermove={pull} onpointerup={release} onpointercancel={release}>
    <div class="grip" aria-hidden="true"></div>
    <div class="bar">
      <a class="ref" href={hash({ project: project.name, view: "map", issue })}>{numbered(issue, node?.repo ?? null, project.repos)}{node?.title ? ` ${node.title}` : ""}</a>
      <Button variant="outline" onclick={close}>Close</Button>
    </div>
    <h2 id="agent-title" tabindex="-1" bind:this={title}>{ROLE[role]}</h2>
    <p class="state">
      {#if doing}
        <AgentDot state={doing} />
        <strong>{SAYS[doing]}</strong>
      {:else}
        <span class="gone">{node ? "No longer in herdr" : "Not on this Project's map"}</span>
      {/if}
    </p>
  </header>

  <div class="section">
    <div class="switch" role="group" aria-label="Show">
      <button type="button" aria-pressed={view === "chat"} onclick={() => (view = "chat")}>Chat</button>
      <button type="button" aria-pressed={view === "screen"} onclick={() => (view = "screen")}>Screen</button>
    </div>
    {#if chatting}
      {#if !chatOpened}
        <p class="note">Reading its chat…</p>
      {:else}
        {#if missing}
          <p class="errata" role="status"><strong>{missing}</strong></p>
        {/if}
        <!-- Scrolls inside its box, so a keyboard can reach it. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="chat" role="log" tabindex="0" aria-label="The {ROLE[role]}'s chat" bind:this={box} onscroll={scrolled}>
          {#each said as e, i (i)}
            <p class={e.role}>{PREFIX[e.role] ?? ""}{e.text}</p>
          {/each}
        </div>
      {/if}
    {:else}
    {#if view === "chat" && missing}
      <p class="note">No chat to read: {missing}. Its screen:</p>
    {/if}
    {#if unread}
      <p class="errata" role="status"><strong>{readAt ? `Last read ${clock(readAt)}` : "Not read yet"} · {unread}</strong></p>
    {:else if screen === null}
      <p class="note">Reading its screen…</p>
    {/if}
    {#if text !== null}
      <!-- Scrolls inside its box, so a keyboard can reach it. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <pre class="screen" tabindex="0" aria-label="The {ROLE[role]}'s screen" bind:this={box} onscroll={scrolled}>{text}</pre>
    {/if}
    {/if}
  </div>

  {#if role === "implementer" && doing === "asking"}
    <div class="section">
      <Answer {issue} screen={text ?? ""} answered={() => read()} />
    </div>
  {/if}
</section>

<style>
  .bar .ref {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .gone {
    color: var(--ink-muted);
  }
  .errata {
    margin-bottom: 8px;
  }
  /* Chat | Screen, the theme switch's segments. */
  .switch {
    display: inline-flex;
    margin-bottom: 8px;
    padding: 2px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--raised);
  }
  .switch button {
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .switch button:hover {
    color: var(--ink);
  }
  .switch button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow), 0 0 0 1px var(--hairline);
  }
  .switch button:focus-visible {
    position: relative;
  }
  /* The chat, plain text as the screen is, but each entry wrapped: never a sideways scroll. */
  .chat {
    max-height: 32em;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--ground);
    color: var(--ink);
    font: 400 13px/1.4 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .chat p {
    margin: 0 0 8px;
  }
  .chat .thinking,
  .chat .tool,
  .chat .result {
    color: var(--ink-muted);
  }
  /* The screen as herdr reads it, plain: unwrapped, scrolling inside its own box, never the panel or the page. */
  .screen {
    margin: 0;
    max-height: 32em;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--ground);
    color: var(--ink);
    font: 400 13px/1.4 var(--mono);
    white-space: pre;
    tab-size: 8;
  }
  @media (width < 720px) {
    .screen,
    .chat {
      max-height: 40vh;
    }
    .switch button {
      min-height: 44px;
    }
    .bar .ref {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
  }
</style>
