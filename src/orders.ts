// Kept apart from config.ts, which reads files, so the app's drawer can name each order too.

/** What the Lead may do without asking; each on or off. */
export const ORDERS = {
  start: { default: false, lets: "the Lead queue and start Specs (the Repo's room still caps it)" },
  answer: { default: false, lets: "the Lead answer an Asking Implementer in its own words" },
  review: { default: true, lets: "the Lead launch Reviewers" },
  close: { default: true, lets: "the Lead Close Dispatches whose PR is ready" },
  write: { default: false, lets: "the Lead write Specs and tickets to a Source" },
} as const;

export type Order = keyof typeof ORDERS;
export type Orders = Record<Order, boolean>;

export const ORDERS_HELP = `Standing orders: ${Object.keys(ORDERS).join(", ")}`;

export function isOrder(name: string): name is Order {
  return Object.hasOwn(ORDERS, name);
}
