/** A coding-agent CLI nico-agent can launch through herdr's native agent kind. */
export interface Harness {
  name: string;
  kind: string;
  sigil: string;
  models: string[];
  efforts: string[];
  /** The question the Harness asks before working in a new folder, and the keys that answer yes. */
  trustPrompt?: { text: string; keys: string[] };
  args(model: string, effort: string): string[];
}

/** Static until Harness config lands; claude's models are its aliases. */
export const HARNESSES: Harness[] = [
  {
    name: "claude",
    kind: "claude",
    sigil: "/",
    models: ["fable", "opus", "sonnet", "haiku"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    trustPrompt: { text: "Yes, I trust this folder", keys: ["down", "enter"] },
    args: (model, effort) => ["--model", model, "--effort", effort],
  },
];
