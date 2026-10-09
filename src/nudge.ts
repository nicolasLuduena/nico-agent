import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LEAD_AGENT, leadStatus } from "./lead";
import { withFileLock, writeJsonAtomic } from "./state";
import { voiceOn } from "./voice-on";
import { type World, WorldError } from "./world";

/** The Nudge's fixed text, as the Lead's skill expects it. */
export const NUDGE = "Read your Inbox";

/** The Nudge with Voice on, which tells the Lead to talk for the ear. */
export const VOICE_NUDGE = `${NUDGE} (voice on)`;

/** How often `serve` looks for an idle Lead to send a pending Nudge to. */
export const NUDGE_INTERVAL_MS = 10_000;

/** Present while a Nudge waits for the Lead to be idle; one at most, so Nudges never pile up. */
const FILE = "nudge.json";

/** The Agent states in which the Lead waits for input: idle, or `done` with a finished turn. */
const READY = ["idle", "done"];

/**
 * Nudge the Lead because something arrived for it: prompt it to read its
 * Inbox if herdr reports it idle, else record a pending Nudge for `serve` to
 * send. A Lead that isn't running gets none; its Inbox waits for its start.
 * A Nudge that fails to send is a warning, kept pending to be retried.
 */
export async function nudgeLead(world: World, configDir: string): Promise<string[]> {
  let lead;
  try {
    lead = await leadStatus(world, configDir);
  } catch (e) {
    return failed(configDir, e);
  }
  if (lead?.lead !== "running") {
    await setPending(configDir, false);
    return [];
  }
  if (!READY.includes(lead.state)) {
    await setPending(configDir, true);
    return [];
  }
  // Cleared first, so a message arriving while the prompt is sent records a Nudge of its own.
  await setPending(configDir, false);
  try {
    const { started } = await world.herdrAgentPrompt(LEAD_AGENT, voiceOn(configDir) ? VOICE_NUDGE : NUDGE);
    return started ? [] : [`the Lead was Nudged, but has not started working; run \`herdr agent read ${LEAD_AGENT}\` to see its screen`];
  } catch (e) {
    return failed(configDir, e);
  }
}

/** Send the pending Nudge, if any, once the Lead is idle; `serve` calls this every `NUDGE_INTERVAL_MS`. */
export async function sendPendingNudge(world: World, configDir: string): Promise<string[]> {
  return existsSync(join(configDir, FILE)) ? nudgeLead(world, configDir) : [];
}

/** A Nudge herdr could not take stays pending, as a warning. */
async function failed(configDir: string, e: unknown): Promise<string[]> {
  if (!(e instanceof WorldError)) throw e;
  await setPending(configDir, true);
  return [`could not Nudge the Lead: ${e.message}`];
}

async function setPending(configDir: string, pending: boolean) {
  const file = join(configDir, FILE);
  await withFileLock(configDir, FILE, () => {
    if (pending) writeJsonAtomic(file, { pending: true });
    else if (existsSync(file)) unlinkSync(file);
  });
}
