import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type World, WorldError } from "./world";

/** Something that needs the user, keyed by its condition so it is notified once while it holds. */
export interface Notice {
  key: string;
  title: string;
  body: string;
}

/** The conditions already notified, so a timer running `advance` doesn't repeat them. */
const FILE = "notified.json";

/**
 * Notify each Notice whose condition is new since the last run, and forget
 * the conditions that cleared, so a recurrence notifies again. A notification
 * that fails to send is a warning, retried on the next run.
 */
export async function notifyOnce(world: World, configDir: string, notices: Notice[]): Promise<string[]> {
  const notified = new Set(load(configDir));
  const keep: string[] = [];
  const warnings: string[] = [];
  for (const notice of notices) {
    if (keep.includes(notice.key)) continue;
    if (!notified.has(notice.key)) {
      try {
        await world.notify(notice.title, notice.body);
      } catch (e) {
        if (!(e instanceof WorldError)) throw e;
        warnings.push(`could not notify "${notice.title}": ${e.message}`);
        continue;
      }
    }
    keep.push(notice.key);
  }
  if (keep.length || notified.size) save(configDir, keep);
  return warnings;
}

function load(configDir: string): string[] {
  const file = join(configDir, FILE);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).notified ?? [];
}

/** Atomic replace, so an interrupted run leaves the last state whole. */
function save(configDir: string, keys: string[]) {
  const file = join(configDir, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ notified: keys }, null, 2)}\n`);
  renameSync(tmp, file);
}
