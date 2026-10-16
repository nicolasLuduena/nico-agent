import { describe, expect, it } from "vitest";
import { FULL, NEAR, gauge, until } from "./budget";
import type { RateLimit } from "./status";

const now = new Date("2026-09-30T12:00:00Z");
const later = "2026-09-30T12:40:00Z";
const of = (core: number, graphql: number, reset = later): RateLimit => ({
  core: { limit: 5000, used: core, remaining: 5000 - core, reset },
  graphql: { limit: 5000, used: graphql, remaining: 5000 - graphql, reset },
});

describe("gauge", () => {
  it("fills to the most-used budget across identities", () => {
    expect(gauge({ gh: of(500, 1000), ghbot: of(2000, 0) }, null, now)).toEqual({ fill: 0.4, tone: "calm" });
  });

  it("turns near, then full, at its thresholds", () => {
    expect(gauge({ gh: of(NEAR * 5000 - 1, 0) }, null, now).tone).toBe("calm");
    expect(gauge({ gh: of(NEAR * 5000, 0) }, null, now).tone).toBe("near");
    expect(gauge({ gh: of(0, FULL * 5000) }, null, now).tone).toBe("full");
  });

  it("shows paused while GitHub is, whatever is used", () => {
    expect(gauge({ gh: of(10, 10) }, "2026-09-30T13:00:00Z", now).tone).toBe("paused");
  });

  it("counts a budget that has reset since it was read as empty", () => {
    expect(gauge({ gh: of(4900, 4900, "2026-09-30T11:59:00Z") }, null, now).fill).toBe(0);
  });

  it("is empty with nothing read yet", () => {
    expect(gauge({}, null, now)).toEqual({ fill: 0, tone: "calm" });
  });
});

it("says how long till a reset", () => {
  expect(until(later, now)).toBe("in 40 min");
  expect(until("2026-09-30T13:05:00Z", now)).toBe("in 1 h 05 min");
  expect(until("2026-09-30T11:00:00Z", now)).toBe("now");
});
