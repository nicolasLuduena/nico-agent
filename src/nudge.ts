import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LEAD_AGENT, leadStatus } from "./lead";
import { withFileLock, writeJsonAtomic } from "./state";
import { type World, WorldError } from "./world";

/** The Nudge's fixed text, as the Lead's skill expects it. */
export const NUDGE = "Read your Inbox";

/** How often `serve` looks for an idle Lead to send a pending Nudge to. */
export const NUDGE_INTERVAL_MS = 10_000;

/** Present while a Nudge waits for the Lead to be idle; one at most, so Nudges never pile up. */
const FILE = "nudge.json";

/**
 * Nudge the Lead because something arrived for it: prompt it to read its
 * Inbox if herdr reports it idle, else record a pending Nudge for `serve` to
 * send. A Lead that isn't running gets none; its Inbox waits for its start.
 * A Nudge that fails to send is a warning, kept pending to be retried.
 */
export async function nudgeLead(world: World, configDir: string): Promise<string[]> {
  return send(world, configDir, true);
}

/** Send the pending Nudge, if any, once the Lead is idle; `serve` calls this every `NUDGE_INTERVAL_MS`. */
export async function sendPendingNudge(world: World, configDir: string): Promise<string[]> {
  if (!existsSync(join(configDir, FILE))) return [];
  return send(world, configDir, false);
}

async function send(world: World, configDir: string, arrived: boolean): Promise<string[]> {
  let status;
  try {
    status = await leadStatus(world, configDir);
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    if (arrived) await setPending(configDir, true);
    return [`could not Nudge the Lead: ${e.message}`];
  }
  if (status?.lead !== "running") {
    await setPending(configDir, false);
    return [];
  }
  if (status.state !== "idle") {
    await setPending(configDir, true);
    return [];
  }
  // Cleared first, so a message arriving while the prompt is sent records a Nudge of its own.
  await setPending(configDir, false);
  try {
    const { started } = await world.herdrAgentPrompt(LEAD_AGENT, NUDGE);
    return started ? [] : ["the Lead was Nudged, but has not started working; run `herdr agent read lead` to see its screen"];
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    await setPending(configDir, true);
    return [`could not Nudge the Lead: ${e.message}`];
  }
}

async function setPending(configDir: string, pending: boolean) {
  const file = join(configDir, FILE);
  if (existsSync(file) === pending) return;
  await withFileLock(configDir, FILE, () => {
    if (pending) writeJsonAtomic(file, { pending: true });
    else if (existsSync(file)) unlinkSync(file);
  });
}
