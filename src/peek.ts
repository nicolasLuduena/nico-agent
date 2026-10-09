import { resolveIssue } from "./dispatch";
import { DispatchError } from "./dispatch-error";
import { LEAD_AGENT } from "./lead";
import { meaningfulLine } from "./screen-line";
import { findDispatch } from "./state";
import type { World } from "./world";

/** What an agent's pane shows right now, and whose it is. */
export interface Peeked {
  /** The In-flight issue the agent works on; unset for the Lead. */
  issue?: string;
  agent: string;
  /** The visible text of its pane, trailing blank lines dropped. */
  screen: string;
  /** Its last line that says what the agent is doing; unset when none does. */
  line?: string;
}

/**
 * The screen of an In-flight issue's Implementer, or its Reviewer with
 * `reviewer`, through herdr's read; with no issue, the Lead's own. An issue
 * not In flight, or a Reviewer that was never launched, is refused.
 */
export async function peek(world: World, configDir: string, issue: string | undefined, reviewer: boolean): Promise<Peeked> {
  if (issue === undefined) return { agent: LEAD_AGENT, ...read(await world.herdrAgentRead(LEAD_AGENT)) };
  const { key } = resolveIssue(configDir, issue);
  const record = findDispatch(configDir, key);
  if (!record) {
    throw new DispatchError(`${key} is not In flight`, [
      "Run `nico-agent` to see the Board and what is In flight",
      "Run `nico-agent peek` with no issue for the Lead's own screen",
    ]);
  }
  if (reviewer && !record.reviewer) {
    throw new DispatchError(`${key} has no Reviewer`, [
      `Run \`nico-agent review ${key} --harness <harness> --model <model> --effort <effort>\` to start one`,
      `Run \`nico-agent peek ${key}\` for its Implementer`,
    ]);
  }
  const { agent } = reviewer ? record.reviewer! : record.implementer;
  return { issue: key, agent, ...read(await world.herdrAgentRead(agent)) };
}

/** A screen as peeked: trailing blank lines dropped, and its meaningful line. */
function read(screen: string) {
  const line = meaningfulLine(screen);
  return { screen: screen.replace(/\s+$/, ""), ...(line !== undefined && { line }) };
}
