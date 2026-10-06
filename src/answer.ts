import { resolveIssue } from "./dispatch";
import { DispatchError } from "./dispatch-error";
import type { RepoDecision } from "./spec";
import type { InFlightRow } from "./stage";
import { findDispatch } from "./state";
import { type World, worldErrorMessage } from "./world";

/** The Agent state of an agent waiting on the user (herdr's `blocked`). */
const WAITING = "blocked";

/** An Implementer waiting on the user, as the Board lists it. */
export interface Asking {
  issue: string;
  /** The Spec the issue belongs to; unset for an issue that is a Spec of its own. */
  spec?: string;
  /** The tail of the Implementer's screen: what it shows the user. */
  question: string;
  /** Why the screen could not be read; the question is then empty. */
  error?: string;
}

/** The last lines of a screen the Board quotes, enough for a question and its choices. */
const QUESTION_LINES = 20;
/** The longest question the Board quotes, so the Scheduler's `board` stays one tool result. */
const QUESTION_LIMIT = 1000;

/**
 * The Implementers waiting on the user, each with its issue, Spec and the
 * question it shows. Only those Implementers' screens are read, so a quiet
 * Board asks herdr nothing more.
 */
export async function loadAsking(world: World, inFlight: InFlightRow[], specs: RepoDecision[]): Promise<Asking[]> {
  const waiting = inFlight.filter((row) => row.implementerState === WAITING).map((row) => row.dispatch);
  const allSpecs = specs.flatMap((r) => r.specs);
  return Promise.all(waiting.map(async (d) => {
    const spec = allSpecs.find((s) => s.issues.includes(d.issue))?.spec;
    const row = { issue: d.issue, ...(spec && spec !== d.issue && { spec }) };
    try {
      return { ...row, question: screenTail(await world.herdrAgentRead(d.implementer.agent)) };
    } catch (e) {
      return { ...row, question: "", error: worldErrorMessage(e) };
    }
  }));
}

/** A screen, its trailing blank lines dropped, cut to its last lines and characters. */
function screenTail(screen: string) {
  const lines = screen.replace(/\s+$/, "").split("\n").slice(-QUESTION_LINES).join("\n");
  return lines.length > QUESTION_LIMIT ? `…${lines.slice(-(QUESTION_LIMIT - 1))}` : lines;
}

export interface Answered {
  issue: string;
  agent: string;
  /** False when herdr submitted the answer but the Implementer did not start working. */
  started: boolean;
}

/**
 * Relay the user's answer, verbatim, to a Dispatch's Implementer, only while
 * it waits on the user (ADR-0008): one that works, or whose question was
 * already answered, is refused.
 */
export async function answer(world: World, configDir: string, issue: string, text: string): Promise<Answered> {
  const { key } = resolveIssue(configDir, issue);
  const record = findDispatch(configDir, key);
  if (!record) {
    throw new DispatchError(`${key} has no Dispatch (it was never dispatched, or was Closed)`, [
      "Run `nico-agent` to see the Board and which Implementers are waiting on you",
    ]);
  }
  const { agent } = record.implementer;
  const state = (await world.herdrAgents()).find((a) => a.name === agent)?.state ?? "unknown";
  if (state !== WAITING) {
    throw new DispatchError(`${key}'s Implementer is not waiting on the user (it is ${state})`, [
      `Run \`herdr agent read ${agent}\` to see what it is doing`,
      "Run `nico-agent` to see the Board",
    ]);
  }
  const { started } = await world.herdrAgentPrompt(agent, text);
  return { issue: key, agent, started };
}
