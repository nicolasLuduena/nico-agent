import type { Assignee } from "../status";
import { send, type Sent } from "./send";

/** Who an issue is assigned to, as its panel lists them: the user as "you"; no one, "Unassigned". */
export const named = (assignees: Assignee[]) => (assignees.length ? assignees.map((a) => (a.you ? "you" : a.name)) : ["Unassigned"]);

/** The Stages before a Dispatch: only then is an issue offered to the user to take. */
const UNDISPATCHED = ["Ready", "Stackable", "Waiting"];

/**
 * Whether a node offers "Assign to me": an issue no one has, not yet dispatched.
 * Never one someone else has: Linear's assign would take it from them.
 */
export const assignable = (n: { assignees: Assignee[] | null; stage: string | null }) =>
  n.assignees?.length === 0 && UNDISPATCHED.includes(n.stage ?? "");

/** Ask serve to assign the issue `issue` to the user on its Source. */
const assign = (issue: string) => send("POST", "/api/assign", { issue });

/** An "Assign to me" button: busy while serve assigns, then serve's refusal, if any, until the next try. */
export class Assigning {
  busy = $state(false);
  refused = $state<{ error: string; help: string[] } | null>(null);

  constructor(private write: (issue: string) => Promise<Sent> = assign) {}

  get label() {
    return this.busy ? "Assigning…" : "Assign to me";
  }

  async run(issue: string): Promise<Sent> {
    this.busy = true;
    this.refused = null;
    const sent = await this.write(issue);
    this.busy = false;
    if (!sent.ok) this.refused = { error: sent.error, help: sent.help };
    return sent;
  }
}
