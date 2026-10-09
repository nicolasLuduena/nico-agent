import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeJsonAtomic } from "./state";

/** Present while Voice on (see GLOSSARY.md): the Lead's replies are spoken, and it talks for the ear. */
const FILE = "voice-on.json";

/** Whether Voice is on. */
export function voiceOn(configDir: string): boolean {
  return existsSync(join(configDir, FILE));
}

/** Turn Voice on or off; false when it already was. */
export function setVoiceOn(configDir: string, on: boolean): Promise<boolean> {
  const file = join(configDir, FILE);
  return withFileLock(configDir, FILE, () => {
    if (existsSync(file) === on) return false;
    if (on) writeJsonAtomic(file, { on: true });
    else unlinkSync(file);
    return true;
  });
}
