/** How many bars the talk button's meter shows. */
export const BARS = 5;

/** The part of the spectrum the bars cover, in Hz: a voice's fundamental up through its sibilants. */
const LOWEST_HZ = 120;
const HIGHEST_HZ = 5000;

/**
 * The bars' levels, from 0 to 1, low to high, for an analyser's byte
 * frequency data (`frequencies`, as `getByteFrequencyData` fills it) at
 * `sampleRate`: each bar the mean of its band, the bands spaced evenly in
 * pitch, as the ear hears them, rather than in Hz.
 */
export function bands(frequencies: Uint8Array, sampleRate: number, count = BARS): number[] {
  const binHz = sampleRate / 2 / frequencies.length;
  const edge = (k: number) => LOWEST_HZ * (HIGHEST_HZ / LOWEST_HZ) ** (k / count);
  return Array.from({ length: count }, (_, k) => {
    const from = Math.floor(edge(k) / binHz);
    const to = Math.min(frequencies.length, Math.max(Math.floor(edge(k + 1) / binHz), from + 1));
    let sum = 0;
    for (let i = from; i < to; i++) sum += frequencies[i]!;
    return sum / (to - from) / 255;
  });
}

/** How fast a bar follows its level, in ms: up at once with a sound, back down more slowly; calm, both slowly. */
const RISE_MS = 30;
const FALL_MS = 160;
const CALM_MS = 600;

/**
 * The bars `ms` after `shown`, heading for `levels`. Calm, for reduced
 * motion, they move together, as the mean, and slowly: a soft swell
 * rather than a dance.
 */
export function settle(shown: number[], levels: number[], ms: number, calm: boolean): number[] {
  const toward = (from: number, to: number, tau: number) => from + (to - from) * (1 - Math.exp(-ms / tau));
  if (calm) {
    const level = toward(mean(shown), mean(levels), CALM_MS);
    return shown.map(() => level);
  }
  return shown.map((from, i) => {
    const to = levels[i] ?? 0;
    return toward(from, to, to > from ? RISE_MS : FALL_MS);
  });
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
