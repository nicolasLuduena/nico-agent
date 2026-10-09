import { PARTNER_NAMES, type PartnerTab } from "../partner-tabs";
import type { ThreadEntry } from "../thread";
import type { LaunchChoice } from "./actions";

/** The app's pages: the Lead's, its Stats, and a tab per Partner. */
export type Page = "lead" | "stats" | PartnerTab;

/** Each page with its address, in the header's order. */
export const PAGES: { page: Page; label: string; href: string }[] = [
  { page: "lead", label: "Lead", href: "#/" },
  { page: "review", label: "Review", href: "#/review" },
  { page: "idea", label: "Ideas", href: "#/ideas" },
  { page: "stats", label: "Stats", href: "#/stats" },
];

/** The page an address names; anything unknown is the Lead's. */
export function pageOf(hash: string): Page {
  return PAGES.find((p) => p.page !== "lead" && p.href === hash)?.page ?? "lead";
}

/** What each tab's Partner is called, as the glossary names it. */
export const PARTNER_TITLES = PARTNER_NAMES;

/** A Partner as `nico-agent partner list --json` lists it. */
export interface PartnerJson {
  tab: PartnerTab;
  /** `running`, `starting`, `Failed at <step>`, `interrupted before <step>`, or `gone from herdr`. */
  partner: string;
  /** Its Agent state as herdr reports it. */
  state: string;
  repo: string;
  agent: string;
  harness: string;
  model: string;
  effort: string;
  workspace?: string;
  failure?: { step: string; error: string };
  startedAt: string;
}

/** Where a tab's Partner stands: none yet, starting, running, or stopped short (failed or gone), to start again or end. */
export function partnerStanding(partner: PartnerJson | undefined): "none" | "starting" | "running" | "stopped" {
  if (!partner) return "none";
  if (partner.partner === "running" || partner.partner === "starting") return partner.partner;
  return "stopped";
}

/** A message to the Partner shown before `serve` has it. */
export interface ThreadSend {
  key: string;
  text: string;
  at: string;
  /** The entry `partner say` wrote, once it answered. */
  id?: number;
  /** Why it was not sent; it stays until sent again or dismissed. */
  error?: string;
}

/** What a Partner's tab holds: its Thread as last fetched, and the sends not in it yet. */
export interface ThreadState {
  entries: ThreadEntry[];
  sends: ThreadSend[];
}

export type ThreadEvent =
  | { type: "log"; entries: ThreadEntry[] | undefined }
  | { type: "send"; key: string; text: string; at: string }
  | { type: "sent"; key: string; id: number }
  | { type: "failed"; key: string; error: string }
  | { type: "dismiss"; key: string };

/** The tab's state after `event`; a send is kept until the fetched Thread holds its entry, as the Lead panel's are. */
export function reduceThread(state: ThreadState, event: ThreadEvent): ThreadState {
  const sends = (f: (s: ThreadSend) => ThreadSend | null) => state.sends.flatMap((s) => f(s) ?? []);
  switch (event.type) {
    case "log": {
      if (!event.entries) return state;
      const ids = new Set(event.entries.map((e) => e.id));
      return { entries: event.entries, sends: sends((s) => (s.id !== undefined && ids.has(s.id) ? null : s)) };
    }
    case "send": {
      const { type: _, ...send } = event;
      return { ...state, sends: [...sends((s) => (s.key === event.key ? null : s)), send] };
    }
    case "sent": {
      const logged = state.entries.some((e) => e.id === event.id);
      return { ...state, sends: sends((s) => (s.key !== event.key ? s : logged ? null : { ...s, id: event.id })) };
    }
    case "failed":
      return { ...state, sends: sends((s) => (s.key === event.key ? { ...s, error: event.error } : s)) };
    case "dismiss":
      return { ...state, sends: sends((s) => (s.key === event.key ? null : s)) };
  }
}

/** One card of a Thread, as the tab draws it. */
export type ThreadCard =
  | { kind: "message"; key: string; who: "user" | "partner"; text: string; at: string; sending?: boolean; error?: string }
  | {
    kind: "draft"; key: string; id: number; text: string; at: string;
    /** Open to hand, replaced by a later draft, or handed to the Lead. */
    status: "open" | "replaced" | "handed";
    /** The text the Lead got, as the user approved it. */
    handed?: string;
  };

/**
 * The Thread as cards, oldest first: messages, and each Hand-off draft with
 * where it stands; a Hand-off shows on its draft, never as a card of its
 * own. Sends not in the Thread yet come last.
 */
export function threadCards({ entries, sends }: ThreadState): ThreadCard[] {
  const handed = new Map(entries.flatMap((e) => (e.type === "handoff" ? [[e.draft, e.text] as const] : [])));
  const lastDraft = entries.findLast((e) => e.type === "draft")?.id;
  const cards = entries.flatMap((e): ThreadCard[] => {
    const key = `entry-${e.id}`;
    switch (e.type) {
      case "user":
      case "partner":
        return [{ kind: "message", key, who: e.type, text: e.text, at: e.at }];
      case "draft": {
        const sent = handed.get(e.id);
        const status = sent !== undefined ? "handed" : e.id === lastDraft ? "open" : "replaced";
        return [{ kind: "draft", key, id: e.id, text: e.text, at: e.at, status, ...(sent !== undefined && { handed: sent }) }];
      }
      case "handoff":
        return [];
    }
  });
  for (const s of sends) {
    cards.push({ kind: "message", key: s.key, who: "user", text: s.text, at: s.at, ...(s.error ? { error: s.error } : { sending: true }) });
  }
  return cards;
}

/** `partner start`'s arguments: the tab, the Repo, the launch picked, and the page's port, so the Partner reaches this `serve`. */
export function partnerStartArgs(tab: PartnerTab, repo: string, { harness, model, effort }: LaunchChoice, port: string): string[] {
  return [tab, "--repo", repo, "--harness", harness, "--model", model, "--effort", effort, ...(port ? ["--port", port] : [])];
}

/** `partner say`'s arguments: the text after `--`, so it is never read as a flag. */
export function partnerSayArgs(tab: PartnerTab, text: string): string[] {
  return [tab, "--", text];
}

/** `partner hand-off`'s arguments: the draft, with the user's text only when they edited it. */
export function handOffArgs(tab: PartnerTab, draft: { id: number; text: string }, text: string): string[] {
  return [tab, String(draft.id), ...(text === draft.text ? [] : ["--text", text])];
}

/** What the "Draft a hand-off" button asks the Partner, as the user's message. */
export const DRAFT_REQUEST = "Draft the hand-off for the Lead: what we settled, what the Lead should do with it, and what is still open.";
