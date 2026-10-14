import type { Sent } from "./send";

/** How long "Saved" stays beside a field, in ms. */
export const SAVED_FOR = 2000;

/** A save serve refused, and the field it refused. */
export interface Refusal {
  key: string;
  error: string;
  help: string[];
}

/**
 * The saves of a form whose fields are written as they change: beside each
 * field, "saving" while its PATCH runs, then "saved" for a moment; under the
 * form, the last refusal, which names the field it refused.
 */
export class Saves {
  #states = $state<Record<string, "saving" | "saved">>({});
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  refused = $state<Refusal | null>(null);

  /** How the field `key` stands: saving, just saved, or neither. */
  of(key: string): "saving" | "saved" | null {
    return this.#states[key] ?? null;
  }

  /** Save the field `key` by `write`, and answer what serve said. */
  async run(key: string, write: () => Promise<Sent>): Promise<Sent> {
    clearTimeout(this.#timers.get(key));
    this.#states[key] = "saving";
    this.refused = null;
    const sent = await write();
    if (sent.ok) {
      this.#states[key] = "saved";
      this.#timers.set(
        key,
        setTimeout(() => delete this.#states[key], SAVED_FOR),
      );
    } else {
      delete this.#states[key];
      this.refused = { key, error: sent.error, help: sent.help };
    }
    return sent;
  }
}
