import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { DIFF_SIGNS, type DiffFile, type DiffHunk, type DiffLine } from "../diff";
import { PARTNER_NAMES, type PartnerTab } from "../partner-tabs";
import type { ThreadEntry } from "../thread";
import { type Chosen, type HarnessesJson, launchChoice } from "./actions";
import { OutcomeNote, answerOf, post, usePost } from "./forms";
import { followsNewEntries } from "./lead";
import {
  DRAFT_REQUESTS, type PartnerJson, type PrJson, type ThreadCard, type ThreadState,
  handOffArgs, partnerSayArgs, partnerStanding, partnerStartArgs, quoteFile, quoteLines, reduceThread, threadCards, withQuote,
} from "./partner";
import { sendsOnEnter } from "./popover";
import { Agent } from "./repos";
import { useResource } from "./stream";
import { TalkButton, TalkStatus, type useTalk } from "./talk-button";

/** What each tab's Partner is for, under its name. */
const LEDES: Record<PartnerTab, string> = {
  review: "Talk a PR through with an agent in its checkout, its diff beside you. Nothing reaches the Lead until you hand it a summary.",
  idea: "Think a problem through with an agent reading a Repo's code, or any folder of yours. Nothing reaches the Lead until you hand it a summary.",
};

/**
 * A Partner's tab (ADR-0014): its Thread with the composer on the left, or
 * the form that starts one, and on the right what it is for and the Partner
 * itself; a Review partner's PR and its diff, which quotes into the message
 * when clicked. Each tab stays mounted while another shows, so its draft and
 * picks are kept. The page's talk button talks to this tab's Front voice
 * while it shows (ADR-0014).
 */
export function PartnerPanel({ tab, partner, harnesses, repos, hidden, talking }: {
  tab: PartnerTab; partner: PartnerJson | undefined; harnesses: HarnessesJson | null; repos: string[]; hidden: boolean;
  talking: ReturnType<typeof useTalk>;
}) {
  const title = PARTNER_NAMES[tab];
  const standing = partnerStanding(partner);
  const [message, setMessage] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const quote = (text: string) => {
    setMessage((m) => withQuote(m, text));
    composer.current?.focus();
  };
  const pr = partner?.pr;
  return (
    <main className={`shell partner${pr ? " reviewing" : ""}`} hidden={hidden} aria-label={title}>
      <section className="lead-panel thread-panel" aria-label={`Thread with the ${title}`}>
        <div className="lead-bar">
          <h1>{title}</h1>
          {partner && <Agent role={partner.repo} state={standing === "running" ? partner.state : partner.partner} />}
        </div>
        {/* A new Partner starts a new Thread, so its tab starts afresh. */}
        {partner ? <Thread key={partner.startedAt} tab={tab} running={standing === "running"} working={partner.state === "working"} talking={talking} message={message} setMessage={setMessage} composer={composer} /> : (
          <div className="conversation">
            <div className="empty partner-empty">
              <h2>{`Start the ${title}`}</h2>
              <p>{tab === "review" ? "Pick the PR and its launch; its diff shows beside the Thread." : "Pick the Repo or local folder it works in and its launch; its Thread shows here."}</p>
              <StartForm tab={tab} harnesses={harnesses} repos={repos} hidden={hidden} />
            </div>
          </div>
        )}
      </section>
      {partner && pr ? (
        <aside className="side partner-side diff-side" aria-label={`${partner.repo}#${pr.number}`}>
          <header className="pr-head">
            <p className="pr-ref"><a href={pr.url} target="_blank" rel="noreferrer">{`${partner.repo}#${pr.number}`}</a></p>
            <h1>{pr.title}</h1>
            <p className="branches mono"><span>{pr.base}</span><span aria-label="from">←</span><span>{pr.head}</span></p>
          </header>
          <PartnerFacts tab={tab} partner={partner} harnesses={harnesses} />
          {/* A new Partner reads its own checkout's diff. */}
          <Diff key={partner.startedAt} tab={tab} quote={quote} hidden={hidden} />
        </aside>
      ) : (
        <aside className="side partner-side">
          <h1>{title}</h1>
          <p className="lede">{LEDES[tab]}</p>
          {partner && <PartnerFacts tab={tab} partner={partner} harnesses={harnesses} />}
        </aside>
      )}
    </main>
  );
}

/** The Thread of the tab's Partner, refetched on `partner-changed`, with the sends not in it yet. */
function useThread(tab: PartnerTab) {
  const log = useResource<{ entries?: ThreadEntry[] }>(`/api/partner/log?tab=${tab}`, ["partner-changed"]);
  const [state, dispatch] = useReducer(reduceThread, { entries: [], sends: [] } satisfies ThreadState);
  useEffect(() => dispatch({ type: "log", entries: log.data?.entries }), [log.data]);
  const sent = useRef(0);
  const send = async (text: string) => {
    const key = `send-${++sent.current}`;
    dispatch({ type: "send", key, text, at: new Date().toISOString() });
    const json = await post("/api/partner/say", partnerSayArgs(tab, text));
    if (typeof json?.said === "number") dispatch({ type: "sent", key, id: json.said });
    else dispatch({ type: "failed", key, error: answerOf(json).lines[0]?.text ?? "the message was not sent" });
  };
  return { state, send, dismiss: (key: string) => dispatch({ type: "dismiss", key }), failure: log.failure };
}

function Thread({ tab, running, working, talking, message, setMessage, composer }: {
  tab: PartnerTab; running: boolean; working: boolean; talking: ReturnType<typeof useTalk>;
  message: string; setMessage: (text: string) => void; composer: RefObject<HTMLTextAreaElement | null>;
}) {
  const { state, send, dismiss, failure } = useThread(tab);
  const warnings = [failure && { key: "failure", text: failure, help: [] as string[] }, talking.warning && { key: "talk", text: talking.warning.error, help: talking.warning.help }].filter((w) => !!w);
  const cards = threadCards(state);
  const scroller = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const list = scroller.current;
    if (list && atEnd.current) list.scrollTop = list.scrollHeight;
  });
  const sendAndFollow = (text: string) => {
    atEnd.current = true;
    return send(text);
  };
  const drafting = cards.some((c) => c.kind === "draft" && c.status === "open");
  return (
    <>
      {warnings.length > 0 && (
        <div className="notices" role="status">
          {warnings.map((n) => <p key={n.key}>{n.text}{n.help.map((h) => <span key={h} className="help">{h}</span>)}</p>)}
        </div>
      )}
      <ol className="conversation" ref={scroller} aria-live="polite" aria-label="Thread" tabIndex={0} onScroll={(e) => { atEnd.current = followsNewEntries(e.currentTarget); }}>
        {cards.length
          ? cards.map((card) => <ThreadCardView key={card.key} tab={tab} card={card} send={send} dismiss={dismiss} />)
          : (
            <li className="empty">
              <h2>Say hello</h2>
              <p>Write below: your message goes to the Partner, and its replies show here. When you've settled something, ask it for a hand-off.</p>
            </li>
          )}
      </ol>
      <div className="composer">
        <TalkStatus talk={talking} working={working} who={`The ${PARTNER_NAMES[tab]}`} />
        <div className="composer-row">
          <Composer tab={tab} send={sendAndFollow} disabled={!running} text={message} setText={setMessage} field={composer} />
          <button type="button" className="quiet" disabled={!running || drafting} title={drafting ? "Its draft is waiting for you above" : "Ask the Partner for a summary to hand to the Lead"} onClick={() => void sendAndFollow(DRAFT_REQUESTS[tab])}>
            Draft a hand-off
          </button>
          <TalkButton talk={talking} />
        </div>
      </div>
    </>
  );
}

function ThreadCardView({ tab, card, send, dismiss }: { tab: PartnerTab; card: ThreadCard; send: (text: string) => Promise<void>; dismiss: (key: string) => void }) {
  if (card.kind === "draft") return <DraftCard tab={tab} card={card} />;
  const time = new Date(card.at);
  return (
    <li className={`card-message ${card.who === "partner" ? "lead" : card.who}${card.sending ? " sending" : ""}`}>
      <p className="byline">
        <b>{{ user: "You", partner: "Partner", "front-voice": "Front voice" }[card.who]}</b>
        <time dateTime={card.at} title={time.toLocaleString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        {card.sending && <span>sending…</span>}
      </p>
      {card.heard !== undefined && <p className="heard"><span>You said</span>{card.heard}</p>}
      {card.raw === undefined
        ? <p className="text">{card.text}</p>
        : (
          <div className="spoken">
            <p className="text">{card.text}</p>
            <p className="raw"><span>Heard</span>{card.raw}</p>
          </div>
        )}
      {card.error && (
        <div className="send-failure">
          <p className="error">{card.error}</p>
          <button type="button" onClick={() => { dismiss(card.key); void send(card.text); }}>Send again</button>
          <button type="button" onClick={() => dismiss(card.key)}>Dismiss</button>
        </div>
      )}
    </li>
  );
}

/**
 * A Hand-off draft: open, the user edits it in place and hands it to the
 * Lead; replaced by a later draft, or handed, it is only shown.
 */
function DraftCard({ tab, card }: { tab: PartnerTab; card: Extract<ThreadCard, { kind: "draft" }> }) {
  const [text, setText] = useState(card.text);
  const { busy, outcome, act } = usePost();
  const status = { open: "Waiting for you", replaced: "Replaced by a later draft", handed: "Handed to the Lead" }[card.status];
  return (
    <li className={`card-proposal card-draft ${card.status}`}>
      <p className="byline"><b>Hand-off draft</b><span className="status">{status}</span></p>
      {card.status === "open" ? (
        <form className="draft" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void act("/api/partner/hand-off", handOffArgs(tab, card, text)); }}>
          <textarea aria-label="The hand-off, as the Lead will read it" value={text} rows={6} onChange={(e) => setText(e.target.value)} />
          <div className="buttons">
            <button type="submit" className="approve" disabled={busy || !text.trim()}>Hand to the Lead</button>
            {text !== card.text && <button type="button" disabled={busy} onClick={() => setText(card.text)}>Undo my edits</button>}
          </div>
        </form>
      ) : <pre className="write">{card.handed ?? card.text}</pre>}
      {outcome && <OutcomeNote outcome={outcome} />}
    </li>
  );
}

/** Where the user writes to the Partner: Enter sends, Shift+Enter starts a new line; the draft is kept across tabs, and quotes from the diff land in it. */
function Composer({ tab, send, disabled, text, setText, field }: {
  tab: PartnerTab; send: (text: string) => Promise<void>; disabled: boolean;
  text: string; setText: (text: string) => void; field: RefObject<HTMLTextAreaElement | null>;
}) {
  const submit = () => {
    if (!text.trim() || disabled) return;
    void send(text);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendsOnEnter(e)) {
      e.preventDefault();
      submit();
    }
  };
  return (
    // A quote spans lines, which a pill can't hold.
    <form className={`write${text.includes("\n") ? " tall" : ""}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea ref={field} aria-label={`Message to the ${PARTNER_NAMES[tab]}`} placeholder={disabled ? "The Partner is not running" : "Write to the Partner"} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <button type="submit" className="primary" disabled={disabled || !text.trim()}>Send</button>
    </form>
  );
}

/** The Partner's Repo and launch, with End, and Start again when it stopped short. */
function PartnerFacts({ tab, partner, harnesses }: { tab: PartnerTab; partner: PartnerJson; harnesses: HarnessesJson | null }) {
  const { busy, outcome, act } = usePost();
  const stopped = partnerStanding(partner) === "stopped";
  const choice = harnesses && launchChoice(harnesses, partner);
  const target = partner.pr ? { pr: partner.pr.url } : partner.folder ? { folder: partner.folder } : { repo: partner.repo };
  return (
    <>
      <dl className="partner-facts">
        {!partner.pr && (<><dt>{partner.folder ? "Folder" : "Repo"}</dt><dd className="mono">{partner.repo}</dd></>)}
        <dt>Launch</dt><dd className="mono">{`${partner.harness} · ${partner.model} · ${partner.effort}`}</dd>
        <dt>Agent</dt><dd className="mono">{partner.agent}</dd>
        {partner.failure && (<><dt>Failed</dt><dd className="error">{`at ${partner.failure.step}: ${partner.failure.error}`}</dd></>)}
      </dl>
      <div className="buttons">
        {stopped && choice && (
          <button type="button" className="primary" disabled={busy} onClick={() => void act("/api/partner/start", partnerStartArgs(tab, target, choice, window.location.port))}>Start again</button>
        )}
        <button type="button" className="close" disabled={busy} title={partner.folder ? "Stop its agent; the folder and the Thread's file are kept" : "Stop its agent and remove its worktree; the Thread's file is kept"} onClick={() => void act("/api/partner/end", [tab])}>End</button>
      </div>
      {outcome && <OutcomeNote outcome={outcome} />}
    </>
  );
}

/** The Ideas tab's choice, after the Repos, of a local folder instead. */
const LOCAL_FOLDER = "Local folder…";

/**
 * The form that starts the tab's Partner: the PR for a Review partner (one of
 * the Repos' open PRs, or a pasted URL) or, for an Idea partner, a Repo or a
 * local folder under the user's home, then Harness, model and Effort, from
 * the last launch. The open PRs are asked of `serve` only while the tab shows.
 */
function StartForm({ tab, harnesses, repos, hidden }: { tab: PartnerTab; harnesses: HarnessesJson | null; repos: string[]; hidden: boolean }) {
  const [chosen, setChosen] = useState<Chosen & { repo?: string; pr?: string; pasted?: string; folder?: string }>({});
  const { busy, outcome, act } = usePost();
  const choice = harnesses && launchChoice(harnesses, chosen);
  const places = [...repos, LOCAL_FOLDER];
  const repo = chosen.repo && places.includes(chosen.repo) ? chosen.repo : places[0]!;
  const folder = chosen.folder?.trim();
  const pr = chosen.pasted?.trim() || chosen.pr;
  const target = tab === "review" ? pr && { pr } : repo === LOCAL_FOLDER ? folder && { folder } : { repo };
  const select = (name: string, label: string, value: string, options: string[], pick: (value: string) => void) => (
    <label>{label}
      <select name={name} value={value} onChange={(e) => pick(e.target.value)}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
  return (
    <form className="partner-start" onSubmit={(e) => { e.preventDefault(); if (choice && target) void act("/api/partner/start", partnerStartArgs(tab, target, choice, window.location.port)); }}>
      {tab === "review"
        ? !hidden && <PrPick picked={chosen.pr} pasted={chosen.pasted ?? ""} pick={(p) => setChosen({ ...chosen, pr: p })} paste={(p) => setChosen({ ...chosen, pasted: p })} />
        : (
          <>
            {select("repo", "Repo", repo, places, (r) => setChosen({ ...chosen, repo: r }))}
            {repo === LOCAL_FOLDER && (
              <label>Folder, under your home
                <input name="folder" type="text" placeholder="~/ideas/new-thing" value={chosen.folder ?? ""} onChange={(e) => setChosen({ ...chosen, folder: e.target.value })} />
              </label>
            )}
          </>
        )}
      {choice
        ? (
          <>
            {select("harness", "Harness", choice.harness, choice.harnesses, (h) => setChosen({ ...chosen, harness: h, model: undefined, effort: undefined }))}
            {select("model", "Model", choice.model, choice.models, (m) => setChosen({ ...chosen, harness: choice.harness, model: m, effort: undefined }))}
            {select("effort", "Effort", choice.effort, choice.efforts, (f) => setChosen({ ...chosen, harness: choice.harness, model: choice.model, effort: f }))}
          </>
        )
        : <p className="loading">{harnesses ? "No Harness offers a model" : "Loading Harnesses…"}</p>}
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || !choice || !target}>{busy ? "Starting…" : "Start"}</button>
      </div>
      {outcome && <OutcomeNote outcome={outcome} />}
    </form>
  );
}

/** The PR to review: one of the Repos' open PRs, by Repo, or one pasted by its URL, which wins while it is there. */
function PrPick({ picked, pasted, pick, paste }: { picked?: string; pasted: string; pick: (url: string) => void; paste: (url: string) => void }) {
  const listed = useResource<{ prs?: PrJson[]; warnings?: string[] }>("/api/partner/prs", []);
  const prs = listed.data?.prs ?? [];
  const repos = [...new Set(prs.map((p) => p.repo))];
  // The first PR stands picked until the user picks another.
  const first = prs[0]?.url;
  useEffect(() => {
    if (!picked && first) pick(first);
  }, [picked, first, pick]);
  return (
    <>
      <label>Open PR
        <select name="pr" value={picked ?? ""} disabled={!prs.length || Boolean(pasted.trim())} onChange={(e) => pick(e.target.value)}>
          {!prs.length && <option value="">{listed.data ? "No open PR" : "Loading open PRs…"}</option>}
          {repos.map((r) => (
            <optgroup key={r} label={r}>
              {prs.filter((p) => p.repo === r).map((p) => <option key={p.url} value={p.url}>{`#${p.number} ${p.title}${p.draft ? " (draft)" : ""} · ${p.author}`}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {listed.data?.warnings?.map((w) => <p key={w} className="error">{w}</p>)}
      <label>Or paste its URL
        <input name="pr-url" type="text" inputMode="url" placeholder="https://github.com/owner/name/pull/12" value={pasted} onChange={(e) => paste(e.target.value)} />
      </label>
    </>
  );
}

interface DiffJson {
  diff?: string;
  files?: DiffFile[];
  error?: string;
}

/** Where a drag over the diff's lines started: a hunk of a file, and the line in it. */
interface Anchor {
  file: string;
  hunk: number;
  line: number;
}

/**
 * The PR's diff, read from the Partner's checkout: its files, each expandable
 * to its hunks. Clicking a file's path quotes it into the message; clicking a
 * line quotes it, and dragging over lines of a hunk quotes them as a range.
 */
function Diff({ tab, quote, hidden }: { tab: PartnerTab; quote: (text: string) => void; hidden: boolean }) {
  // A partner-changed follows each message, and the checkout may have changed with it.
  const diff = useResource<DiffJson>(`/api/partner/diff?tab=${tab}`, hidden ? [] : ["partner-changed"]);
  const [drag, setDrag] = useState<Anchor & { to: number } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const cancel = () => setDrag(null);
    window.addEventListener("mouseup", cancel);
    return () => window.removeEventListener("mouseup", cancel);
  }, [drag]);
  const files = diff.data?.files;
  if (!files) return <p className={diff.data?.error ? "error" : "loading"}>{diff.data?.error ?? diff.failure ?? "Reading the diff…"}</p>;
  const finish = (file: DiffFile, hunk: DiffHunk, at: Anchor) => {
    if (!drag || drag.file !== at.file || drag.hunk !== at.hunk) return setDrag(null);
    const [from, to] = [Math.min(drag.line, at.line), Math.max(drag.line, at.line)];
    quote(quoteLines(file, hunk.lines.slice(from, to + 1)));
    setDrag(null);
  };
  return (
    <section className="diff" aria-label="The PR's diff">
      <p className="diff-size"><b>Diff</b><span>{diff.data?.diff}</span><span className="hint">Click a file or a line to quote it; drag over lines for a range.</span></p>
      {!files.length && <p className="loading">No change against its base.</p>}
      {files.map((file) => (
        <details key={file.path} className={`diff-file ${file.status}`} open={file.hunks.reduce((n, h) => n + h.lines.length, 0) <= 200}>
          <summary>
            <span className="chevron" aria-hidden="true">›</span>
            <button type="button" className="path" title="Quote this file into your message" onClick={(e) => { e.preventDefault(); quote(quoteFile(file)); }}>
              {file.from ? `${file.from} → ${file.path}` : file.path}
            </button>
            <span className="status">{file.status}</span>
            <span className="counts"><ins>{`+${file.additions}`}</ins><del>{`−${file.deletions}`}</del></span>
          </summary>
          {file.binary && <p className="loading">A binary file: no lines to show.</p>}
          {file.hunks.map((hunk, h) => (
            <div key={h} className="hunk">
              <p className="hunk-head mono">{hunk.header}</p>
              {hunk.lines.map((line, i) => {
                const at = { file: file.path, hunk: h, line: i };
                const inDrag = drag && drag.file === file.path && drag.hunk === h && i >= Math.min(drag.line, drag.to) && i <= Math.max(drag.line, drag.to);
                return (
                  <button
                    type="button"
                    key={i}
                    className={`diff-line ${line.kind}${inDrag ? " picked" : ""}`}
                    title={`Quote ${lineName(file, line)} into your message`}
                    onMouseDown={(e) => { if (e.button === 0) setDrag({ ...at, to: i }); }}
                    onMouseEnter={() => drag && setDrag({ ...drag, to: i })}
                    onMouseUp={() => finish(file, hunk, at)}
                    // A key press (Enter, Space) clicks with no mouse: it quotes the one line.
                    onClick={(e) => { if (e.detail === 0) quote(quoteLines(file, [line])); }}
                  >
                    <span className="num">{line.old ?? ""}</span>
                    <span className="num">{line.new ?? ""}</span>
                    <span className="code">{`${DIFF_SIGNS[line.kind]}${line.text}`}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

/** `src/retry.ts:12`, as a line's title names it. */
function lineName(file: DiffFile, line: DiffLine) {
  return `${file.path}:${line.new ?? line.old}`;
}
