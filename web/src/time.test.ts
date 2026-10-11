import { expect, it } from "vitest";
import { clock } from "./time";

it("sets a time as HH:MM, with its date when it is not today", () => {
  const now = new Date(2026, 9, 11, 9, 30);

  expect(clock(new Date(2026, 9, 11, 7, 5).toISOString(), now)).toBe("07:05");
  expect(clock(new Date(2026, 9, 10, 23, 41).toISOString(), now)).toBe("10 Oct 23:41");
});
