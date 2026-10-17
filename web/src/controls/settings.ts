import type { Launch, Project, Setting, Settings } from "../status";
import type { Sent } from "./send";

/** The layer a panel of settings writes: a Repo's own, or its Project's defaults. */
export type Own = "repo" | "project";

/** What a panel of settings edits: a Repo's, over its Project's and the defaults, or a Project's, over the defaults. */
export interface Holder {
  own: Own;
  /** The panel showing it, by which this browser remembers which of its sections are open: `repo <slug>`, `project <name>`. */
  panel: string;
  settings: Settings;
  /** The Project a Repo's own value falls back to; none for a Project's. */
  under: Project | undefined;
  /** Write its own settings, `body` as `PATCH /api/repo/<slug>` or `/api/project/<name>` takes it; it answers its settings after. */
  patch: (body: Record<string, unknown>) => Promise<Sent>;
}

/** The Project the Repo `slug` is in, as /api/status lists them: its own, named by its slug, unless it names one. */
export const projectOf = (slug: string, projects: Project[]) => projects.find((p) => p.repos.includes(slug));

/** A setting's chip: where it comes from while the layer `own` does not set it; none once it does. */
export const tag = (setting: Setting<unknown>, own: Own = "repo") =>
  setting.from === own ? null : setting.from === "project" ? "from Project" : "default";

/**
 * The button that removes the `own` layer's value of the setting at `keys`
 * (`["room"]`, `["switches", "review"]`), named for what takes its place;
 * none while that layer does not set it.
 */
export function undoLabel(setting: Setting<unknown>, project: Project | undefined, keys: string[], own: Own = "repo"): string | null {
  if (setting.from !== own) return null;
  const sets = keys.reduce<any>((layer, key) => layer?.[key], project?.defaults) != null;
  return sets ? "Use the Project's" : "Use the default";
}

/** A switch's name as the Glossary says it, capitalised; `mine` as what it does. */
const said: Record<string, string> = {
  mine: "Only issues assigned to me",
  flip: "Flip to ready",
  answer: "Faux-nico answers",
  quality_scan: "Quality-scan",
};
export const switchLabel = (name: string) => said[name] ?? name[0].toUpperCase() + name.slice(1);

/** What the loop does while a switch is on, shown on hovering its name. */
export const SWITCH_TIPS: Record<string, string> = {
  dispatch: "Start a Dispatch on the oldest Ready issue whenever the Room has space.",
  mine: "Only issues assigned to you are Ready; off, unassigned ones are too.",
  stack: "Start a Stackable issue on its Blocker's open PR instead of waiting for that PR to merge.",
  review: "Once a PR opens, start a Reviewer on another Harness to re-run the verification and record a Verdict.",
  restart: "Start a fresh agent in the worktree when the machine rebooted, the agent stalled, the PR conflicts with its Base, the PR below it merged, or the Reviewer failed it.",
  flip: "Mark a PR ready for review once its Verdict passes; off, it stays draft.",
  answer: "When an Implementer is Asking, faux-nico answers what PRODUCT.md, the issue or its parent settles; anything else notifies you.",
  gardening: "When nothing else is Ready or Stackable, dispatch Ready gardening issues.",
  quality_scan: "Weekly, audit for bloat and deepening and file what it finds as issues.",
  wiki: "Update the Wiki each day; off, it stays readable but is no longer built.",
};

/** The PATCH body that removes the own value at `keys`. */
export const unset = (keys: string[]) => keys.reduceRight<unknown>((body, key) => ({ [key]: body }), null) as Record<string, unknown>;

/** `launch` with `field` picked: another Harness starts on its own model and Effort. */
export const picked = (launch: Launch, field: keyof Launch, value: string | null): Launch =>
  field === "harness" ? { harness: value ?? launch.harness, model: null, effort: null } : { ...launch, [field]: value };
