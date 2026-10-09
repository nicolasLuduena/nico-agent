import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeJsonAtomic } from "./state";

/** Where a Proposal stands: undecided, or how the user decided it and how that went. */
export type ProposalStatus = "open" | "approved" | "declined" | "failed";

/** Markdown the Lead would write to a Repo's Source: a Spec and its tickets. */
export interface SourceWrite {
  /** The Repo whose Source it goes to, as `owner/name`. */
  repo: string;
  text: string;
}

/**
 * What approving a Proposal does: run `action`, the CLI command without
 * `nico-agent` and `--json`, in nico-agent; or let the Lead `write` the text
 * to a Source with its own shell (ADR-0010: nico-agent never writes it).
 */
export type Proposed = { action: string[] } | { write: SourceWrite };

/**
 * An action the Lead may not take under its Standing orders, held until the
 * user decides (ADR-0010); `failed` is an approval whose action turned out
 * impossible.
 */
export type Proposal = Proposed & {
  id: number;
  at: string;
  /** Why the Lead proposes it. */
  reason: string;
  status: ProposalStatus;
  decidedAt?: string;
  /** Why the user declined it, when they said. */
  declineReason?: string;
  /** What the action printed with `--json`, its help left out. */
  outcome?: Record<string, unknown>;
};

const FILE = "proposals.json";

/** Why a decision was refused: no Proposal has the id, or it was decided already. */
export class ProposalRefused extends Error {
  constructor(
    message: string,
    readonly open: number[],
  ) {
    super(message);
  }
}

/** Every Proposal, oldest first. */
export function loadProposals(dir: string): Proposal[] {
  const file = join(dir, FILE);
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as { proposals: Proposal[] }).proposals;
}

/** The Proposals the user has not decided yet, oldest first. */
export function openProposals(dir: string): Proposal[] {
  return loadProposals(dir).filter(isOpen);
}

const isOpen = (p: Proposal) => p.status === "open";

/** Record what approving would do as the next open Proposal. */
export function addProposal(dir: string, proposed: Proposed, reason: string, at: Date): Promise<Proposal> {
  return withFileLock(dir, FILE, () => {
    const proposals = loadProposals(dir);
    const proposal: Proposal = { id: (proposals.at(-1)?.id ?? 0) + 1, at: at.toISOString(), ...proposed, reason, status: "open" };
    save(dir, [...proposals, proposal]);
    return proposal;
  });
}

/**
 * Decide the open Proposal with id `id`: decline it, or claim it as approved
 * before its action runs, so a second approval is refused while it does. A
 * Proposal already decided, or an id that names none, is refused.
 */
export function decide(dir: string, id: string, status: "approved" | "declined", at: Date, declineReason?: string): Promise<Proposal> {
  return withFileLock(dir, FILE, () => {
    const proposals = loadProposals(dir);
    const proposal = proposals.find((p) => String(p.id) === id);
    const open = proposals.filter(isOpen).map((p) => p.id);
    if (!proposal) throw new ProposalRefused(`no Proposal has id ${id}`, open);
    if (proposal.status !== "open") throw new ProposalRefused(`Proposal ${id} was already ${proposal.status}`, open);
    const decided: Proposal = { ...proposal, status, decidedAt: at.toISOString(), ...(declineReason && { declineReason }) };
    save(dir, proposals.map((p) => (p === proposal ? decided : p)));
    return decided;
  });
}

/** Record what an approved Proposal's action did; one that turned out impossible is `failed`. */
export function settle(dir: string, id: number, outcome: Record<string, unknown>, failed: boolean): Promise<Proposal> {
  return withFileLock(dir, FILE, () => {
    const proposals = loadProposals(dir);
    const settled = { ...proposals.find((p) => p.id === id)!, outcome, ...(failed && { status: "failed" as const }) };
    save(dir, proposals.map((p) => (p.id === id ? settled : p)));
    return settled;
  });
}

/**
 * What approving does, every way it is shown: `proposed` alone, as a
 * decision carries it; `line`, a sentence; `summary`, a field naming the
 * command line or the Repo; `shown`, as `proposals` lists it, the write whole
 * to read before approving.
 */
export function describeProposed(proposal: Proposed) {
  if ("action" in proposal) {
    const action = commandLine(proposal.action);
    return { proposed: { action: proposal.action }, line: action, summary: { action }, shown: { action } };
  }
  const { write } = proposal;
  return { proposed: { write }, line: `write a Spec to ${write.repo}'s Source`, summary: { write: write.repo }, shown: { write } };
}

/** `action` as the command line the user would type. */
export function commandLine(action: string[]): string {
  return ["nico-agent", ...action].map((token) => (/^[\w@#%+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`)).join(" ");
}

function save(dir: string, proposals: Proposal[]) {
  writeJsonAtomic(join(dir, FILE), { proposals });
}
