import type { Launch, Project, Setting } from "../status";

/** The Project the Repo `slug` is in, as /api/status lists them: its own, named by its slug, unless it names one. */
export const projectOf = (slug: string, projects: Project[]) => projects.find((p) => p.repos.includes(slug));

/** A setting's tag: where it comes from while the Repo does not set it; none once it does. */
export const tag = (setting: Setting<unknown>) => (setting.from === "repo" ? null : setting.from);

/**
 * The button that removes the Repo's own value of the setting at `keys`
 * (`["room"]`, `["switches", "review"]`), named for what takes its place;
 * none while the Repo does not set it.
 */
export function undo(setting: Setting<unknown>, project: Project | undefined, keys: string[]): string | null {
  if (setting.from !== "repo") return null;
  const sets = keys.reduce<any>((layer, key) => layer?.[key], project?.defaults) != null;
  return sets ? "Use the Project's" : "Use the default";
}

/** The `PATCH /api/repo/<slug>` body that removes the Repo's own value at `keys`. */
export const unset = (keys: string[]) => keys.reduceRight<unknown>((body, key) => ({ [key]: body }), null) as Record<string, unknown>;

/** `launch` with `field` picked: another Harness starts on its own model and Effort. */
export const picked = (launch: Launch, field: keyof Launch, value: string | null): Launch =>
  field === "harness" ? { harness: value ?? launch.harness, model: null, effort: null } : { ...launch, [field]: value };
