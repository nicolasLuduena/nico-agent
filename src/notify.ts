import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeJsonAtomic } from "./state";
import { type World, WorldError } from "./world";

/**
 * Something that needs the user, keyed by its condition so it is notified once
 * while it holds. `scope` names what must be observed to tell the condition
 * cleared: a Repo's Specs, or one Implementer's Agent state.
 */
export interface Notice {
  key: string;
  scope: string;
  title: string;
  body: string;
}

/** The scope of open Proposals' Notices: only `propose` observes it. */
export const PROPOSALS_SCOPE = "proposals";

/** The conditions already notified, so a timer running `advance` doesn't repeat them. */
const FILE = "notified.json";

interface Notified {
  key: string;
  scope: string;
}

/**
 * Notify each Notice whose condition is new since the last run, and forget
 * the conditions that cleared, so a recurrence notifies again. A condition in
 * a scope this run does not observe (one it could not see, or another
 * caller's) is neither cleared nor notified anew. A notification that fails to
 * send is a warning, retried on the next run.
 */
export async function notifyOnce(world: World, configDir: string, notices: Notice[], observed: (scope: string) => boolean = () => true): Promise<string[]> {
  const notified = load(configDir);
  const keep: Notified[] = notified.filter((n) => !observed(n.scope));
  const warnings: string[] = [];
  for (const notice of notices) {
    if (keep.some((n) => n.key === notice.key)) continue;
    if (!notified.some((n) => n.key === notice.key)) {
      try {
        await world.notify(notice.title, notice.body);
      } catch (e) {
        if (!(e instanceof WorldError)) throw e;
        warnings.push(`could not notify "${notice.title}": ${e.message}`);
        continue;
      }
    }
    keep.push({ key: notice.key, scope: notice.scope });
  }
  if (keep.length || notified.length) await withFileLock(configDir, FILE, () => writeJsonAtomic(join(configDir, FILE), { notified: keep }));
  return warnings;
}

/** What was notified; a key written before scopes existed has none, so it is never kept unobserved. */
function load(configDir: string): Notified[] {
  const file = join(configDir, FILE);
  if (!existsSync(file)) return [];
  const notified: (string | Notified)[] = JSON.parse(readFileSync(file, "utf8")).notified ?? [];
  return notified.map((n) => (typeof n === "string" ? { key: n, scope: "" } : n));
}
