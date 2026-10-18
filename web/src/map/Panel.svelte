<script lang="ts">
  // The open node's inspector (desktop) or bottom sheet (phone): what the map
  // node knows and, for an issue with a Dispatch, /api/node/<issue>, its next
  // useful action first: while it is Asking, a link to its Implementer's agent
  // panel, to answer from; when it Failed, why; then its PR (opened on GitHub
  // to review and merge), its review with "Review now" while it is off, stopped or given up
  // on, and Verdict with findings, and Evidence in the Bucket; then who it is
  // assigned to, with "Assign to me" while no one is, and its restarts, folded.
  import { Button } from "$lib/components/ui/button/index.js";
  import { onMount } from "svelte";
  import Markdown from "../Markdown.svelte";
  import { assignMe, assignable, named } from "../controls/assign";
  import Press from "../controls/Press.svelte";
  import { ticked } from "../controls/Refused.svelte";
  import { watch } from "../live";
  import { selection } from "../selection.svelte";
  import { harnessHue, stageHue } from "../hues";
  import * as review from "../review";
  import { reviewerKeptFailing } from "../failure";
  import { hash } from "../route";
  import { agentsOf, needs } from "./layout";
  import { numbered, type Failure, type Project, type Restart, type Review, type Stage } from "../status";
  import { clock } from "../time";
  import Mark from "./Mark.svelte";
  import { shown } from "./ProjectMap.svelte";

  /** What `GET /api/node/<issue>` answers: the issue's last Dispatch, as /api/status shows it, with its Evidence. */
  interface Node {
    pr: { url: string; draft: boolean; state: string; merged_at: string | null } | null;
    restarts: Restart[];
    verdict: { result: "pass" | "fail"; sha: string; at: string; findings: string | null } | null;
    review: Review | null;
    failure: Failure | null;
    evidence_folder: string;
    evidence: { path: string; url: string }[];
  }

  let { issue, project }: { issue: string; project: Project } = $props();

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

<section class="inspector" aria-labelledby="panel-title" bind:this={panel} style:transform={pulled ? `translateY(${pulled}px)` : null}>
  <!-- The swipe is a pointer's shortcut for Close, which keyboards and screen readers have. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={grab} onpointermove={pull} onpointerup={release} onpointercancel={release}>
    <div class="grip" aria-hidden="true"></div>
    <div class="bar">
      <span class="ref">
        {#if node?.url}<a href={node.url} target="_blank" rel="noreferrer">{numbered(issue, node.repo, project.repos)}</a>{:else}{issue}{/if}
        {#if node && node.kind !== "code"}· {node.kind}{/if}
      </span>
      <Button variant="outline" onclick={close}>Close</Button>
    </div>
    <h2 id="panel-title" tabindex="-1" bind:this={title}>{node?.title ?? issue}</h2>
    {#if node}
      <p class="stage">
        <span class="word" style:color={stageHue(node.stage)}>
          {#if node.stage}<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><Mark stage={node.stage} /></svg>{/if}
          <strong>{node.stage ?? "Blocker"}</strong>
        </span>
        {#if needs(node)}<span class="needs">Needs you</span>{/if}
      </p>
    {/if}
  </header>

  {#if !node}
    <p class="note section">{shown.map ? `${issue} is not on this Project's map.` : "Reading the map…"}</p>
  {:else}
    {#if failure}<div class="section"><p class="errata" role="status"><strong>{failure}</strong></p></div>{/if}

    {#if agentsOf(node).some((a) => a.role === "implementer" && a.state === "asking")}
      <section aria-labelledby="asking-title">
        <h3 id="asking-title">Asking</h3>
        <p class="said">The Implementer is asking you something{node.asking ? `: ${node.asking.question}` : "."}</p>
        <p class="hint"><Button href={hash({ project: project.name, view: "map", issue, agent: "implementer" })}>Answer it in its panel</Button></p>
      </section>
    {/if}

    {#if node.stage === "Waiting" && node.waits}<p class="said section">{node.waits}</p>{/if}

    {#if full?.failure}
      {@const kept = reviewerKeptFailing(full.failure, full.restarts)}
      <section>
        <h3>Failure</h3>
        <div class="errata">
          {#if kept}
            <p><strong>{kept.said}</strong></p>
            <p>{kept.help}</p>
          {:else}
            <p><strong>{@render ticked(full.failure.error)}</strong></p>
            <p>At the {full.failure.step} step.</p>
          {/if}
        </div>
      </section>
    {/if}

    <section>
      <h3>Pull request</h3>
      {#if pr}
        {@const n = pr.url.split("/").pop()}
        <p class="row">
          <Button variant={node.stage === "Verified" ? "default" : "outline"} href={pr.url} target="_blank" rel="noreferrer">Open PR {n}{pr.draft ? " (draft)" : ""}</Button>
          {#if full?.pr?.merged_at}<span class="at">merged {clock(full.pr.merged_at)}</span>{/if}
        </p>
        {#if node.stage === "Verified"}<p class="note hint">Review and merge it on GitHub.</p>{/if}
      {:else}
        <p class="note">No PR yet.</p>
      {/if}
    </section>

    {#if !dispatched}
      <p class="note section">Not dispatched yet: no restarts, Verdict or Evidence.</p>
    {:else if !full}
      {#if !failure}<p class="note section">Reading the Dispatch…</p>{/if}
    {:else}
      <section>
        <h3>Review</h3>
        <!-- A Verdict on the head says it itself, below. -->
        {#if full.review && full.review.state !== "passed" && full.review.state !== "failed"}
          {@const r = full.review}
          <!-- A line naming its Reviewer's Harness carries its dot, as a launch picker does. -->
          {#snippet stands()}
            <p class="said">
              {#if r.harness && ["reviewing", "stopped"].includes(r.state)}<span
                  class="harness"
                  style:--harness={harnessHue(r.harness)}
                  aria-hidden="true"
                ></span>{/if}{@render ticked(review.said(issue, r))}
            </p>
          {/snippet}
          <!-- A start that failed is counted, and the tick tries again: its refusal stays till then. -->
          {@const offered = review.offered(r, full.verdict?.sha)}
          {#if offered || r.state === "retrying"}
            <Press {issue} action={review.reviewNow} {offered}>{@render stands()}</Press>
          {:else}
            {@render stands()}
          {/if}
        {/if}
        {#if full.verdict}
          <p class="row">
            <span>
              <strong class={full.verdict.result}>{full.verdict.result}</strong>
              <span class="sha">{full.verdict.sha.slice(0, 7)}</span>
            </span>
            <span class="at">{clock(full.verdict.at)}</span>
          </p>
          {#if full.verdict.findings}<div class="findings"><Markdown text={full.verdict.findings} /></div>{/if}
        {:else if !full.review}
          <p class="note">No Verdict yet.</p>
        {/if}
      </section>

      <section>
        <h3>Evidence</h3>
        {#if full.evidence.length}
          {@const heads = new Set(full.evidence.map((file) => file.path.split("/")[0])).size}
          <p class="row">
            <Button variant="outline" href={full.evidence_folder} target="_blank" rel="noreferrer">Open Evidence</Button>
            <span class="at">
              {heads} head{heads === 1 ? "" : "s"} · {full.evidence.length} file{full.evidence.length === 1 ? "" : "s"}
            </span>
          </p>
        {:else}
          <p class="note">No Evidence in the Bucket.</p>
        {/if}
      </section>
    {/if}

    {#if node.assignees}
      <section>
        <h3>Assigned</h3>
        {#if assignable(node.assignees, dispatched)}
          <Press {issue} action={assignMe}><span class="note">Unassigned</span></Press>
        {:else}
          <p class:note={!node.assignees.length}>{named(node.assignees).join(", ")}</p>
        {/if}
      </section>
    {/if}

    {#if full}
      <!-- Folded, but open on a Failed Dispatch, whose recovery its restarts tell. -->
      <details class="section" open={node.stage === "Failed"}>
        <summary><h3>Restarts</h3><span class="count">{full.restarts.length}</span></summary>
        {#if full.restarts.length}
          <ol class="restarts">
            {#each full.restarts as r, i (i)}
              <li><span class="at">{clock(r.at)}</span><strong>{r.reason}</strong><span class="by">by {r.by}</span></li>
            {/each}
          </ol>
        {:else}
          <p class="note">No restarts.</p>
        {/if}
      </details>
    {/if}
  {/if}
</section>

<style>
  .stage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-top: 8px;
  }
  .word {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .word svg {
    flex: none;
  }
  .stage .needs {
    margin-left: auto;
  }
  details summary h3 {
    margin: 0;
  }
  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .hint {
    margin-top: 6px;
  }
  .at {
    color: var(--ink-muted);
    text-align: right;
    white-space: nowrap;
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
  .pass {
    color: var(--verified);
  }
  .fail {
    color: var(--failed);
  }
  .said .harness {
    margin: 0 8px 1px 2px;
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
  /* The Reviewer's Markdown, as the Roadmap's Description reads it, at a 70-character measure. */
  .findings {
    display: grid;
    gap: 8px;
    margin-top: 8px;
    max-width: 70ch;
    overflow-wrap: anywhere;
  }
  .findings :global(ul),
  .findings :global(ol) {
    padding-left: 20px;
    list-style: revert;
  }
</style>
