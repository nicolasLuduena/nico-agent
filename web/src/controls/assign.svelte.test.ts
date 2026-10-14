import { describe, expect, it } from "vitest";
import { asksToAssign, assignMe, assignable, named } from "./assign.svelte";
import { Pressing } from "./press.svelte";
import type { Sent } from "./send";

const you = { name: "nico", you: true };
const colleague = { name: "colleague", you: false };

describe("who an issue is assigned to, in its panel", () => {
  it("names each assignee, the user as you, and none as Unassigned", () => {
    expect(named([colleague, you])).toEqual(["colleague", "you"]);
    expect(named([])).toEqual(["Unassigned"]);
  });

  it("offers Assign to me only on an issue no one has, before it is dispatched", () => {
    expect(assignable([], false)).toBe(true);
    expect(assignable([colleague], false)).toBe(false);
    expect(assignable([you], false)).toBe(false);
    expect(assignable([], true)).toBe(false);
    // A Blocker outside the Sources read: who has it is not known.
    expect(assignable(null, false)).toBe(false);
  });

  it("offers it under a refused Dispatch whose help says to take the issue, and under no other", () => {
    expect(asksToAssign(["Assign it to yourself, or turn `mine` off for acme/api"])).toBe(true);
    expect(asksToAssign(["acme/api#3 is assigned to colleague", "Run `nico-agent status` to see the Ready issues"])).toBe(false);
  });
});

/** An assign still running, answered when the test says. */
function pending() {
  let answer!: (sent: Sent) => void;
  const sent = new Promise<Sent>((resolve) => (answer = resolve));
  const asked: string[] = [];
  return { write: (issue: string) => (asked.push(issue), sent), answer, asked };
}

describe("the Assign to me button", () => {
  it("reads Assigning… and is busy while serve assigns the issue, then is done", async () => {
    const serve = pending();
    const assigning = new Pressing({ ...assignMe, write: serve.write });
    expect([assigning.label, assigning.busy]).toEqual(["Assign to me", false]);

    const assigned = assigning.run("acme/api#1");
    expect([assigning.label, assigning.busy]).toEqual(["Assigning…", true]);
    serve.answer({ ok: true, answer: { assigned: "acme/api#1" } });

    expect((await assigned).ok).toBe(true);
    expect(serve.asked).toEqual(["acme/api#1"]);
    expect([assigning.label, assigning.busy, assigning.refused]).toEqual(["Assign to me", false, null]);
  });

  it("keeps a refusal to show under it, until the next try", async () => {
    const paused = { ok: false as const, error: "could not assign acme/api#1 to you: GitHub is paused", help: ["try again once it answers"] };
    const assigning = new Pressing({ ...assignMe, write: async () => paused });

    await assigning.run("acme/api#1");
    expect(assigning.refused).toEqual({ error: paused.error, help: paused.help });
    expect(assigning.busy).toBe(false);

    const again = pending();
    const retry = new Pressing({ ...assignMe, write: again.write });
    retry.refused = assigning.refused;
    const running = retry.run("acme/api#1");
    expect(retry.refused).toBeNull();
    again.answer({ ok: true, answer: {} });
    await running;
  });
});
