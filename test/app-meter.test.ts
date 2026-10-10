import { describe, expect, test } from "bun:test";
import { BARS, ORDER, bands, settle } from "../src/app/meter";

const RATE = 48_000;
/** An analyser's byte frequency data, 1024 bins of 23.4Hz at RATE: `at` Hz as loud as `value`, the rest silent. */
function spectrum(at: number[], value = 255) {
  const data = new Uint8Array(1024);
  for (const hz of at) data[Math.round(hz / (RATE / 2048))] = value;
  return data;
}

describe("the talk button's meter", () => {
  test("silence is every bar down, and all the spectrum loud is every bar up", () => {
    expect(bands(new Uint8Array(1024), RATE)).toEqual(Array(BARS).fill(0));
    expect(bands(new Uint8Array(1024).fill(255), RATE)).toEqual(Array(BARS).fill(1));
  });

  test("a low voice lights the low bars, and a hiss the high ones", () => {
    const low = bands(spectrum([150, 160, 170]), RATE);
    expect(low[0]).toBeGreaterThan(0);
    expect(low.slice(2).every((b) => b === 0)).toBe(true);
    const high = bands(spectrum([4000, 4200, 4400]), RATE);
    expect(high[BARS - 1]).toBeGreaterThan(0);
    expect(high.slice(0, BARS - 2).every((b) => b === 0)).toBe(true);
  });

  test("on screen, the lowest band sits in the middle and higher ones spread outward on both sides", () => {
    expect(ORDER).toEqual([3, 1, 0, 2, 4]);
  });

  test("a bar jumps up with a sound and falls back more slowly", () => {
    const up = settle([0, 0, 0, 0, 0], [1, 1, 1, 1, 1], 16, false);
    const down = settle([1, 1, 1, 1, 1], [0, 0, 0, 0, 0], 16, false);
    expect(up[0]).toBeGreaterThan(0.25);
    expect(1 - down[0]!).toBeLessThan(up[0]!);
    expect(down[0]).toBeLessThan(1);
  });

  test("calm, for reduced motion, the bars move together and slowly", () => {
    const calm = settle([0, 0, 0, 0, 0], [1, 0, 0, 0, 0], 16, true);
    expect(new Set(calm).size).toBe(1);
    expect(calm[0]).toBeGreaterThan(0);
    expect(calm[0]).toBeLessThan(settle([0, 0, 0, 0, 0], [1, 0, 0, 0, 0], 16, false)[0]! / 5);
  });
});
