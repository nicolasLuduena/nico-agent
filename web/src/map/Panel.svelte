<script lang="ts">
  // The open node's panel (desktop) or bottom sheet (phone): what the map
  // node knows, and for an issue with a Dispatch, /api/node/<issue>: its PR,
  // restarts, review and Verdict with findings, and Evidence in the Bucket.
  import { onMount } from "svelte";
  import { ticked } from "../controls/Refused.svelte";
  import { watch } from "../live";
  import { selection } from "../selection.svelte";
  import * as review from "../review";
  import { number, type Review, type Stage } from "../status";
  import { clock } from "../time";
  import Mark, { worded } from "./Mark.svelte";
  import { shown } from "./RepoMap.svelte";

  /** What `GET /api/node/<issue>` answers: the issue's last Dispatch, as /api/status shows it, with its Evidence. */
  interface Node {
    pr: { url: string; draft: boolean; state: string; merged_at: string | null } | null;
    restarts: { at: string; reason: string; by: string }[];
    verdict: { result: "pass" | "fail"; sha: string; at: string; findings: string | null } | null;
    review: Review | null;
    failure: { step: string; error: string } | null;
    evidence_folder: string;
    evidence: { path: string; url: string }[];
  }

  let { issue, slug }: { issue: string; slug: string } = $props();

  /** The Stages only a Dispatch has: any other node has no /api/node (it answers 404). */
  const DISPATCHED: Stage[] = ["Implementing", "PR draft", "Verified", "Merged", "Closed", "Failed"];
  const node = $derived(shown.map?.nodes.find((n) => n.key === issue) ?? null);
  const dispatched = $derived(DISPATCHED.some((stage) => stage === node?.stage));
  let full = $state<Node | null>(null);
  let failure = $state<string | null>(null);

  $effect(() => {
    full = null;
    failure = null;
    if (!dispatched) return;
    return watch<Node>(
      `/api/node/${encodeURIComponent(issue)}`,
      (got) => {
        full = got;
        failure = null;
      },
      (why) => (failure = why),
    );
  });

  const pr = $derived(full?.pr ?? node?.pr ?? null);

  function close() {
    selection.issue = null;
  }

  // Focus moves into the panel as it opens, so a keyboard needn't cross every node to
  // reach it, and back to what opened it as it closes, unless focus has gone elsewhere.
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

  // On a phone the sheet closes on a swipe down its head; the swipe only takes
  // the pointer once it has moved, so the Close button still clicks.
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

<section class="panel" aria-labelledby="panel-title" bind:this={panel} style:transform={pulled ? `translateY(${pulled}px)` : null}>
  <!-- The swipe is a pointer's shortcut for Close, which keyboards and screen readers have. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={grab} onpointermove={pull} onpointerup={release} onpointercancel={release}>
    <div class="grip" aria-hidden="true"></div>
    <div class="line">
      <h2 id="panel-title" tabindex="-1" bind:this={title}>
        {node?.title ?? issue}
        {#if node?.url}<a href={node.url} target="_blank" rel="noreferrer">{number(issue, slug)}</a>{/if}
      </h2>
      <button type="button" class="quiet" onclick={close}>Close</button>
    </div>
    {#if node}
      <p class="stage">
        <svg width="14" height="14" viewBox="0 0 14 14"><Mark stage={node.stage} /></svg>
        <strong class={worded(node.stage)}>{node.stage ?? "Blocker"}</strong>
        <span class="label kind">{node.kind}</span>
      </p>
    {/if}
  </header>

  {#if !node}
    <p class="note">{shown.map ? `${issue} is not on this Repo's map.` : "Reading the map…"}</p>
  {:else}
    {#if failure}<p class="errata"><strong>{failure}</strong></p>{/if}

    <section>
      <h3 class="label">PR</h3>
      {#if pr}
        <p class="row">
          <span>
            <a href={pr.url} target="_blank" rel="noreferrer">PR {pr.url.split("/").pop()}</a>
            {#if pr.draft}<span class="label flag">draft</span>{/if}
          </span>
          {#if full?.pr?.merged_at}<span class="at">merged {clock(full.pr.merged_at)}</span>{/if}
        </p>
      {:else}
        <p class="note">No PR yet.</p>
      {/if}
    </section>

    {#if !dispatched}
      <p class="note section">Not dispatched yet: no restarts, Verdict or Evidence.</p>
    {:else if !full}
      {#if !failure}<p class="note section">Reading the Dispatch…</p>{/if}
    {:else}
      {#if full.failure}
        <section>
          <h3 class="label">Failure</h3>
          <div class="errata">
            <p><strong>{@render ticked(full.failure.error)}</strong></p>
            <p>At the {full.failure.step} step.</p>
          </div>
        </section>
      {/if}

      <section>
        <h3 class="label">Restarts</h3>
        {#if full.restarts.length}
          <ol class="restarts">
            {#each full.restarts as r, i (i)}
              <li><span class="at">{clock(r.at)}</span><strong>{r.reason}</strong><span class="by">by {r.by}</span></li>
            {/each}
          </ol>
        {:else}
          <p class="note">No restarts.</p>
        {/if}
      </section>

      <section>
        <h3 class="label">Review</h3>
        <!-- A Verdict on the head says it itself, below. -->
        {#if full.review && full.review.state !== "passed" && full.review.state !== "failed"}
          <p class="said">{@render ticked(review.said(issue, full.review))}</p>
        {/if}
        {#if full.verdict}
          <p class="row">
            <span>
              <span class="label {full.verdict.result}">{full.verdict.result}</span>
              <span class="sha">{full.verdict.sha.slice(0, 7)}</span>
            </span>
            <span class="at">{clock(full.verdict.at)}</span>
          </p>
          {#if full.verdict.findings}<p class="findings">{full.verdict.findings}</p>{/if}
        {:else if !full.review}
          <p class="note">No Verdict yet.</p>
        {/if}
      </section>

      <section>
        <h3 class="label">Evidence</h3>
        {#if full.evidence.length}
          <ul class="evidence">
            {#each full.evidence as file (file.url)}
              <li><a href={file.url} target="_blank" rel="noreferrer">{file.path}</a></li>
            {/each}
          </ul>
          <p><a href={full.evidence_folder} target="_blank" rel="noreferrer">The whole folder</a></p>
        {:else}
          <p class="note">No Evidence in the Bucket.</p>
        {/if}
      </section>
    {/if}
  {/if}
</section>

<style>
  .panel {
    padding: 0 24px 24px;
    background: var(--surface);
    border-left: 1px solid var(--rule);
    box-shadow: 0 0 0 1px var(--hairline);
    animation: slide 160ms ease-out;
  }
  @keyframes slide {
    from {
      transform: translateX(16px);
    }
  }
  header {
    padding-top: 24px;
  }
  .grip {
    display: none;
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  h2 a {
    font-weight: 700;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }
  .stage svg {
    flex: none;
  }
  .kind {
    margin-left: auto;
    color: var(--ink-muted);
  }
  section > section,
  .section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
  }
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--ink-muted);
  }
  ol,
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .at {
    color: var(--ink-muted);
    text-align: right;
    white-space: nowrap;
  }
  .flag {
    margin-left: 6px;
    color: var(--ink-muted);
  }
  /* Time in a right-aligned column, then the reason and who restarted it. */
  .restarts {
    display: grid;
    grid-template-columns: max-content max-content 1fr;
  }
  .restarts li {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    column-gap: 12px;
    align-items: baseline;
    padding: 4px 0;
  }
  .restarts li + li {
    border-top: 1px solid var(--hairline);
  }
  .by {
    color: var(--ink-muted);
  }
  .pass,
  .verified {
    color: var(--verified);
  }
  .fail,
  .failed {
    color: var(--failed);
  }
  .live {
    color: var(--live);
  }
  .sha {
    margin-left: 8px;
  }
  .said {
    max-width: 70ch;
    overflow-wrap: anywhere;
  }
  .said + .row {
    margin-top: 8px;
  }
  .findings {
    margin-top: 8px;
    max-width: 70ch;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .evidence li {
    padding: 2px 0;
    overflow-wrap: anywhere;
  }
  .evidence + p {
    margin-top: 8px;
  }
  .note {
    color: var(--ink-muted);
  }
  header + .errata {
    margin-top: 16px;
  }
  .quiet {
    flex: none;
    min-height: 36px;
    padding: 0 16px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--surface);
    font-weight: 600;
    cursor: pointer;
  }
  .quiet:hover {
    background: var(--ground);
  }

  /* Beside a map taller than the window, the panel stays in view. */
  @media (width >= 720px) {
    .panel {
      position: sticky;
      top: 0;
      max-height: 100vh;
      overflow-y: auto;
    }
  }

  /* The bottom sheet: up to 85vh, scrolling inside, closed by Close or a swipe down. */
  @media (width < 720px) {
    .panel {
      position: fixed;
      inset: auto 0 0;
      z-index: 10;
      max-height: 85vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 16px 16px;
      border-left: 0;
      border-top: 1px solid var(--rule);
      animation-name: rise;
    }
    @keyframes rise {
      from {
        transform: translateY(100%);
      }
    }
    header {
      position: sticky;
      top: 0;
      padding-top: 8px;
      padding-bottom: 8px;
      background: var(--surface);
      touch-action: none;
    }
    /* A thumb's target, not a line of text. */
    .evidence a,
    .evidence + p a {
      display: block;
      padding: 8px 0;
    }
    .evidence li {
      padding: 0;
    }
    .evidence + p {
      margin-top: 0;
    }
    .grip {
      display: block;
      width: 40px;
      height: 4px;
      margin: 0 auto 8px;
      background: var(--hairline);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
