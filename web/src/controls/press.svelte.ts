import type { Sent } from "./send";

/** What a button asks serve of an issue, and what it reads before and while serve runs it. */
export interface Action {
  write: (issue: string) => Promise<Sent>;
  idle: string;
  running: string;
}

/** A button asking serve one thing of an issue: busy while serve runs it, then serve's refusal, if any, until the next try. */
export class Pressing {
  busy = $state(false);
  refused = $state<{ error: string; help: string[] } | null>(null);

  constructor(private action: Action) {}

  get label() {
    return this.busy ? this.action.running : this.action.idle;
  }

  async run(issue: string): Promise<Sent> {
    this.busy = true;
    this.refused = null;
    const sent = await this.action.write(issue);
    this.busy = false;
    if (!sent.ok) this.refused = { error: sent.error, help: sent.help };
    return sent;
  }
}
