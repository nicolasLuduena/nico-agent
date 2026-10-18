<script lang="ts">
  // An agent's panel (desktop) or bottom sheet (phone), in place of its issue's:
  // its role and Agent state, then its last 200 lines (its screen while herdr
  // scrolls it only idle) from /api/agent/<issue>/<role>, read again every 3 s while it is open and the
  // page is visible; under an Asking Implementer's, the answer controls.
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

  // Pinned to its foot, where the agent writes, unless the user has scrolled up.
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
    .screen {
      max-height: 40vh;
    }
    .bar .ref {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
  }
</style>
