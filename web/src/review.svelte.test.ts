import { describe, expect, it } from "vitest";
import { Pressing } from "./controls/press.svelte";
import type { Sent } from "./controls/send";
import { offered, reviewNow } from "./review";
import type { Review } from "./status";

const at = (state: Review["state"]): Review => ({ state, sha: "abc1234def", harness: "codex", attempts: 0, cap: 2 });

describe("Review now, in a node's panel", () => {
  it("is offered while the review is off, stopped or given up on, and at no other time", () => {
    const shown = (["off", "stopped", "gave_up", "reviewing", "retrying", "waiting", "passed", "failed"] as const).filter((s) => offered(at(s)));
    expect(shown).toEqual(["off", "stopped", "gave_up"]);
    expect(offered(null)).toBe(false);
  });

  it("reads Starting… and is busy while serve starts the Reviewer, then keeps serve's refusal under it", async () => {
    let answer!: (sent: Sent) => void;
    const asked: string[] = [];
    const starting = new Pressing({ ...reviewNow, write: (issue) => (asked.push(issue), new Promise((resolve) => (answer = resolve))) });
    expect([starting.label, starting.busy]).toEqual(["Review now", false]);

    const started = starting.run("acme/api#7");
    expect([starting.label, starting.busy]).toEqual(["Starting…", true]);
    const failed = "could not start the Reviewer of acme/api#7: agent_name_taken: rev-api-7";
    answer({ ok: false, error: failed, help: [] });

    expect((await started).ok).toBe(false);
    expect(asked).toEqual(["acme/api#7"]);
    expect([starting.label, starting.busy, starting.refused]).toEqual(["Review now", false, { error: failed, help: [] }]);
  });
});
