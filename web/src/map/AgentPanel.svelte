<script lang="ts">
  // An agent's panel (desktop) or bottom sheet (phone), in place of its issue's:
  // its role and Agent state, then its chat, streamed from /api/agent/<issue>/<role>/transcript while
  // it is open and the page is visible, drawn with the AI Elements; only while there is no chat to read,
  // its last 200 lines (its screen while herdr scrolls it only idle) from /api/agent/<issue>/<role>,
  // read again every 3 s likewise; under an Asking Implementer's, the answer controls, which read the
  // screen too while the chat asks nothing they can pick.
  import { Button } from "$lib/components/ui/button/index.js";
  import { Conversation } from "$lib/components/ai-elements/conversation/index.js";
  import { Message, MessageContent } from "$lib/components/ai-elements/message/index.js";
  import { Reasoning, ReasoningContent, ReasoningTrigger } from "$lib/components/ai-elements/reasoning/index.js";
  import { Response } from "$lib/components/ai-elements/response/index.js";
  import { Task, TaskContent, TaskItem, TaskTrigger } from "$lib/components/ai-elements/task/index.js";
  import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "$lib/components/ai-elements/tool/index.js";
  import { onMount } from "svelte";
  import Answer from "../controls/Answer.svelte";
  import { hash } from "../route";
  import { selection } from "../selection.svelte";
  import { numbered, type Project } from "../status";
  import { clock } from "../time";
  import AgentDot from "./AgentDot.svelte";
  import { asked, context, turns, type Ask, type Entry } from "./chat";
  import { agentsOf, ROLE, SAYS, type Role } from "./layout";
  import { shown } from "./ProjectMap.svelte";

  let { issue, role, project }: { issue: string; role: Role; project: Project } = $props();

  const EVERY = 3000;
  const node = $derived(shown.map?.nodes.find((n) => n.key === issue) ?? null);
  /** As the map last said it; null once herdr no longer lists it. */
  const doing = $derived(node && (agentsOf(node).find((a) => a.role === role)?.state ?? null));

  let entries = $state<Entry[]>([]);
  /** What an opencode Implementer's session waits on, as serve last said; null for claude's, asked in its chat. */
  let served = $state<Ask[] | null>(null);
  /** Why there is no chat to read, while there is none. */
  let missing = $state<string | null>(null);
  let chatOpened = $state(false);
  const chat = $derived(turns(entries));
  const tokens = $derived(context(entries));
  const ask = $derived(served ? (served[0] ?? null) : asked(entries));
  /** The screen stands in only while there is no chat to read. */
  const fallback = $derived(chatOpened && missing !== null && chat.length === 0);
  const asking = $derived(role === "implementer" && doing === "asking");
  /** The screen is read while it stands in, or for the options of a dialog the chat asks none of (a permission prompt, several questions at once). */
  const reads = $derived(fallback || (chatOpened && asking && !ask?.options.length));

  // One stream while the panel is open and the page visible; reopened past the last entry it had.
  $effect(() => {
    const path = `/api/agent/${encodeURIComponent(issue)}/${role}/transcript`;
    entries = [];
    served = missing = null;
    chatOpened = false;
    let session: string | null = null;
    let last: string | null = null;
    let source: EventSource | null = null;
    // What landed, applied once a frame, so the Markdown is drawn again once, not per event, and a
    // session opens with its entries, never empty a frame before them.
    let landed: Entry[] = [];
    let fresh = false;
    let opened = false;
    let frame = 0;
    const land = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        entries = fresh ? landed : [...entries, ...landed];
        if (opened) [chatOpened, missing] = [true, null];
        landed = [];
        fresh = opened = false;
      });
    };
    const open = () => {
      source?.close();
      source = null;
      if (document.hidden) return;
      source = new EventSource(last ? `${path}?after=${encodeURIComponent(last)}` : path);
      source.addEventListener("session", (e) => {
        const now = JSON.parse(e.data).session;
        if (now !== session) [landed, fresh] = [[], true];
        session = now;
        opened = true;
        land();
      });
      source.addEventListener("entries", (e) => {
        landed.push(...JSON.parse(e.data).entries);
        last = e.lastEventId;
        land();
      });
      source.addEventListener("asking", (e) => (served = JSON.parse(e.data).asking));
      source.addEventListener("missing", (e) => {
        missing = JSON.parse(e.data).missing;
        chatOpened = true;
      });
      // Refused (no live Dispatch, no such agent): the browser gives up on it, and the screen stands in.
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) {
          missing ??= "nico-agent serve refused its chat";
          chatOpened = true;
        }
      };
    };
    document.addEventListener("visibilitychange", open);
    open();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", open);
      source?.close();
    };
  });

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

  // While the screen is read: one read in flight at a time, the next 3 s after it lands; none while the page is hidden.
  $effect(() => {
    if (!reads) return;
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
      read = () => {};
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  });

  /** A to-do's status, marked as well as said. */
  const DONE: Record<string, string> = { completed: "✓", in_progress: "▸", cancelled: "✕" };
  /** A tool call's name, and its input past it. */
  const named = (call: Entry) => call.name ?? call.text?.split(" ")[0] ?? "Tool";
  const input = (call: Entry) => (call.text ?? "").slice(named(call).length).trim();

  // The screen pinned to its foot, where the agent writes, unless the user has scrolled up.
  let box = $state<HTMLElement>();
  let pinned = true;
  $effect(() => {
    void text;
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
    {#if !chatOpened}
      <p class="note">Reading its chat…</p>
    {:else if !fallback}
      {#if missing}
        <p class="errata" role="status"><strong>{missing}</strong></p>
      {/if}
      <Conversation class="chat" aria-label="The {ROLE[role]}'s chat">
        {#each chat as turn, i (i)}
          <Message from={turn.from}>
            <MessageContent>
              {#each turn.parts as part, j (j)}
                {#if part.kind === "text"}
                  {#if turn.from === "user"}
                    <p class="said">{part.text}</p>
                  {:else}
                    <Response content={part.text} />
                  {/if}
                {:else if part.kind === "thinking"}
                  <Reasoning>
                    <ReasoningTrigger />
                    <ReasoningContent content={part.text} />
                  </Reasoning>
                {:else if part.call.todos}
                  {@const todos = part.call.todos}
                  <Task>
                    <TaskTrigger title="To do · {todos.filter((t) => t.status === 'completed').length} of {todos.length} done" />
                    <TaskContent>
                      {#each todos as t, k (k)}
                        <TaskItem class={t.status === "in_progress" ? "text-foreground" : ""}>{DONE[t.status] ?? "○"} {t.text}</TaskItem>
                      {/each}
                    </TaskContent>
                  </Task>
                {:else}
                  <Tool>
                    <ToolHeader type={named(part.call)} state={!part.result ? "input-available" : part.result.error ? "output-error" : "output-available"} />
                    <ToolContent>
                      {#if input(part.call)}
                        <ToolInput input={input(part.call)} />
                      {/if}
                      <ToolOutput output={part.result?.error ? undefined : part.result?.text} errorText={part.result?.error ? part.result.text : undefined} />
                    </ToolContent>
                  </Tool>
                {/if}
              {/each}
            </MessageContent>
          </Message>
        {/each}
      </Conversation>
      {#if tokens !== null}
        <p class="note tokens">{tokens.toLocaleString()} tokens in its context</p>
      {/if}
    {:else}
      <p class="note">No chat to read: {missing}. Its screen:</p>
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

  {#if asking}
    <div class="section">
      <Answer {issue} {ask} screen={reads ? text : null} answered={() => read()} />
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
  /* The chat in the screen's frame: each turn wrapped, never a sideways scroll. */
  :global(.chat) {
    max-height: 32em;
    padding: 8px 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--ground);
    color: var(--ink);
    font: 400 13px/1.4 var(--mono);
    overflow-wrap: anywhere;
  }
  :global(.chat p),
  :global(.chat ul),
  :global(.chat ol) {
    margin: 0 0 6px;
  }
  :global(.chat :is(ul, ol)) {
    padding-left: 20px;
  }
  .said {
    white-space: pre-wrap;
  }
  :global(.chat .tool-text) {
    margin: 0;
    max-height: 16em;
    overflow: auto;
    white-space: pre-wrap;
    font: inherit;
  }
  .tokens {
    margin-top: 6px;
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
    :global(.chat) {
      max-height: 40vh;
    }
    .bar .ref {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
  }
</style>
