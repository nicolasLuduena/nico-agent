import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Saves } from "./save.svelte";
import type { Sent } from "./send";

/** A PATCH still running, answered when the test says. */
function pending() {
  let answer!: (sent: Sent) => void;
  const sent = new Promise<Sent>((resolve) => (answer = resolve));
  return { write: () => sent, answer };
}

describe("a field that saves as it changes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads Saving… while its PATCH runs, then Saved for a moment, then nothing", async () => {
    const saves = new Saves();
    const patch = pending();

    const saved = saves.run("room", patch.write);
    expect(saves.of("room")).toBe("saving");
    expect(saves.of("base")).toBeNull();

    patch.answer({ ok: true, answer: { room: { value: 4, from: "repo" } } });
    await saved;
    expect(saves.of("room")).toBe("saved");

    vi.advanceTimersByTime(1999);
    expect(saves.of("room")).toBe("saved");
    vi.advanceTimersByTime(1);
    expect(saves.of("room")).toBeNull();
  });

  it("shows a refusal on the field it refused, and no Saved", async () => {
    const saves = new Saves();

    await saves.run("room", async () => ({ ok: false, error: "room is a whole number of at least 1, not 0", help: ["room is how many"] }));

    expect(saves.of("room")).toBeNull();
    expect(saves.refused).toEqual({ key: "room", error: "room is a whole number of at least 1, not 0", help: ["room is how many"] });
  });

  it("clears the refusal once another save starts", async () => {
    const saves = new Saves();
    await saves.run("room", async () => ({ ok: false, error: "no", help: [] }));

    const patch = pending();
    const saved = saves.run("base", patch.write);
    expect(saves.refused).toBeNull();
    patch.answer({ ok: true, answer: {} });
    await saved;
    expect(saves.of("base")).toBe("saved");
  });

  it("keeps Saved for the whole moment after a second save of the same field", async () => {
    const saves = new Saves();
    await saves.run("room", async () => ({ ok: true, answer: {} }));
    vi.advanceTimersByTime(1500);

    await saves.run("room", async () => ({ ok: true, answer: {} }));
    vi.advanceTimersByTime(1500);
    expect(saves.of("room")).toBe("saved");
  });
});
