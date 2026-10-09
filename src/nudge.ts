import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { LEAD_AGENT, leadStatus } from "./lead";
import { withFileLock, writeJsonAtomic } from "./state";
import { voiceOn } from "./voice-on";
import { type World, WorldError } from "./world";

/** The Nudge's fixed text, as the Lead's skill expects it; the local time follows it. */
export const NUDGE = "Read your Inbox";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The Nudge with Voice on, which tells the Lead to talk for the ear. */
export const VOICE_NUDGE = `${NUDGE} (voice on)`;

/**
 * The Nudge at `now`: its text and the local time, so the Lead can tell a new day began (its daily brief).
 * With Voice on it reads as {@link VOICE_NUDGE}.
 */
export function nudgeText(now: Date, voice = false): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${voice ? VOICE_NUDGE : NUDGE} (local time: ${WEEKDAYS[now.getDay()]} ${date} ${pad(now.getHours())}:${pad(now.getMinutes())})`;
}

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
    const now = world.now();
    const { started } = await world.herdrAgentPrompt(LEAD_AGENT, nudgeText(now, voiceOn(configDir)));
    await recordSent(configDir, now);
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

/** When the last Nudges were sent, newest last, for `serve` to time a spoken message by (see voice-timing.ts); whoever sent them. */
const SENT_FILE = "nudges-sent.json";

/** How many Nudges SENT_FILE keeps: enough to outlast the few minutes a spoken message is timed for. */
const SENT_KEPT = 20;

/** When the last Nudges were sent, oldest first. */
export function nudgesSent(configDir: string): Date[] {
  try {
    return (JSON.parse(readFileSync(join(configDir, SENT_FILE), "utf8")) as { sent: string[] }).sent.map((at) => new Date(at));
  } catch {
    return [];
  }
}

async function recordSent(configDir: string, at: Date) {
  await withFileLock(configDir, SENT_FILE, () => {
    const sent = [...nudgesSent(configDir), at].slice(-SENT_KEPT).map((d) => d.toISOString());
    writeJsonAtomic(join(configDir, SENT_FILE), { sent });
  });
}

async function setPending(configDir: string, pending: boolean) {
  const file = join(configDir, FILE);
  await withFileLock(configDir, FILE, () => {
    if (pending) writeJsonAtomic(file, { pending: true });
    else if (existsSync(file)) unlinkSync(file);
  });
}
