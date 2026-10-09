/** An In-flight Dispatch as `nico-agent board --json` lists it under `dispatches`. */
export interface InFlightDispatch {
  issue: string;
  title: string;
  stage: string;
  pr: string;
  prError?: string;
  implementer: string;
  reviewer: string;
  harness: string;
  model: string;
  effort: string;
  base: string;
  workspace: string;
}

/** The parts of `nico-agent board --json` the app reads. */
export interface BoardJson {
  inFlight?: string;
  dispatches?: InFlightDispatch[];
  errors?: { repo: string; error: string }[];
  error?: string;
}

/** The class a Stage's key takes, by its hue: Implementing, PR ready, Review launched, Failed, or unknown. */
export function stageClass(stage: string) {
  if (stage === "Implementing") return "implementing";
  if (stage === "PR ready") return "pr-ready";
  if (stage === "Review launched") return "review-launched";
  if (stage.startsWith("Failed")) return "failed";
  return "unknown";
}

/** The Agent states the Board draws apart; any other reads as unknown. */
export function agentClass(state: string) {
  return ["working", "idle", "done", "blocked"].includes(state) ? state : "unknown";
}
