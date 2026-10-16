import type { Budget, RateLimits } from "./status";

/** The gauge's colour step: `ink` while calm, `waiting` from NEAR, `failed` from FULL and while GitHub is paused. */
export type Tone = "calm" | "near" | "full" | "paused";

export const NEAR = 0.75;
export const FULL = 0.9;

/** What of `budget` is used at `now`: none once it has reset since it was read. */
function share(budget: Budget, now = new Date()): number {
  if (new Date(budget.reset) <= now || budget.limit === 0) return 0;
  return budget.used / budget.limit;
}

/** The gauge: the most-used share across every identity's budgets, so it shows the tightest one, and its tone. */
export function gauge(limits: RateLimits, pausedUntil: string | null, now = new Date()): { fill: number; tone: Tone } {
  const budgets = Object.values(limits).flatMap((l) => [l.core, l.graphql]);
  const fill = Math.min(1, Math.max(0, ...budgets.map((b) => share(b, now))));
  const tone: Tone = pausedUntil ? "paused" : fill >= FULL ? "full" : fill >= NEAR ? "near" : "calm";
  return { fill, tone };
}

/** How long till `iso`: "in 18 min", "in 1 h 05 min", or "now" once it has passed. */
export function until(iso: string, now = new Date()): string {
  const minutes = Math.ceil((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
