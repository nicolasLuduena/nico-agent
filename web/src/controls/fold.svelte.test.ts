import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fold } from "./fold.svelte";
import { Saves } from "./save.svelte";

/** This browser's localStorage, kept across the test's reloads. */
function storage() {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
}

/** Run `body` as a component would, its effects flushed as the page's are. */
function mounted(body: () => void) {
  const stop = $effect.root(body);
  stop();
}

describe("a folded section of a panel", () => {
  beforeEach(() => vi.stubGlobal("localStorage", storage()));
  afterEach(() => vi.unstubAllGlobals());

  it("starts folded", () => {
    mounted(() => {
      expect(new Fold("repo acme/api", "Room", () => false).open).toBe(false);
    });
  });

  it("stays open across a reload once opened, for that panel only", () => {
    mounted(() => {
      new Fold("repo acme/api", "Room", () => false).toggle(true);
    });
    mounted(() => {
      expect(new Fold("repo acme/api", "Room", () => false).open).toBe(true);
      expect(new Fold("repo acme/api", "Switches", () => false).open).toBe(false);
      expect(new Fold("repo acme/web", "Room", () => false).open).toBe(false);
    });
  });

  it("stays folded across a reload once closed again", () => {
    mounted(() => {
      const room = new Fold("repo acme/api", "Room", () => false);
      room.toggle(true);
      room.toggle(false);
    });
    mounted(() => {
      expect(new Fold("repo acme/api", "Room", () => false).open).toBe(false);
    });
  });

  it("opens by itself on a refusal of one of its fields", async () => {
    const saves = new Saves();
    let room!: Fold;
    const stop = $effect.root(() => {
      room = new Fold("repo acme/api", "Room", () => saves.refused !== null);
    });
    flushSync();
    expect(room.open).toBe(false);

    await saves.run("room", async () => ({ ok: false, error: "room is a whole number of at least 1, not 0", help: [] }));
    flushSync();

    expect(room.open).toBe(true);
    stop();
  });

  it("opens by itself while it shows a failure, without remembering it", () => {
    mounted(() => {
      const install = new Fold("repo acme/api", "Install", () => true);
      flushSync();
      expect(install.open).toBe(true);
    });
    mounted(() => {
      expect(new Fold("repo acme/api", "Install", () => false).open).toBe(false);
    });
  });

  it("opens as it would without remembering, in a browser whose storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("The user denied storage", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("The user denied storage", "SecurityError");
      },
    });
    mounted(() => {
      const room = new Fold("repo acme/api", "Room", () => false);
      room.toggle(true);
      expect(room.open).toBe(true);
    });
  });
});
