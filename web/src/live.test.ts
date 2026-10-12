import { expect, it } from "vitest";
import { backoff } from "./live";

it("waits 1 s before the first reconnect, doubling each failed one up to 30 s", () => {
  const waits = [0, 1, 2, 3, 4, 5, 6, 20].map(backoff);

  expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
