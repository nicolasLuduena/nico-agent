import type { Assignee } from "../status";
import { send, type Sent } from "./send";

/** Who an issue is assigned to, as its panel lists them: the user as "you"; no one, "Unassigned". */
export const named = (assignees: Assignee[]) => (assignees.length ? assignees.map((a) => (a.you ? "you" : a.name)) : ["Unassigned"]);

/**
 * Whether an issue offers "Assign to me": no one has it, and it is not yet dispatched.
 * Never one someone else has: Linear's assign would take it from them.
 */
export const assignable = (assignees: Assignee[] | null, dispatched: boolean) => !dispatched && assignees?.length === 0;

/** Whether a refused Dispatch's help says to take the issue: one no one has, in a Repo with `mine` on. */
export const asksToAssign = (help: string[]) => help.some((line) => line.startsWith("Assign it to yourself, or turn `mine` off"));

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
