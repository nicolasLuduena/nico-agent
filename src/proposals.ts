import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock, writeJsonAtomic } from "./state";

/**
 * An action the Lead may not take under its Standing orders, held until the
 * user decides (ADR-0010). Approving runs `action` through the CLI in
 * nico-agent; `failed` is an approval whose action turned out impossible.
 */
export interface Proposal {
  id: number;
  at: string;
  /** The CLI command it runs, without `nico-agent` and `--json`. */
  action: string[];
  /** Why the Lead proposes it. */
  reason: string;
  status: "open" | "approved" | "declined" | "failed";
  decidedAt?: string;
  /** Why the user declined it, when they said. */
  declined?: string;
  /** What the action printed with `--json`, its help left out. */
  outcome?: Record<string, unknown>;
}

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

/** Record `action` as the next open Proposal. */
export function addProposal(dir: string, action: string[], reason: string, at: Date): Promise<Proposal> {
  return withFileLock(dir, FILE, () => {
    const proposals = loadProposals(dir);
    const proposal: Proposal = { id: (proposals.at(-1)?.id ?? 0) + 1, at: at.toISOString(), action, reason, status: "open" };
    save(dir, [...proposals, proposal]);
    return proposal;
  });
}

/**
 * Decide the open Proposal with id `id`: decline it, or claim it as approved
 * before its action runs, so a second approval is refused while it does. A
 * Proposal already decided, or an id that names none, is refused.
 */
export function decide(dir: string, id: string, status: "approved" | "declined", at: Date, declined?: string): Promise<Proposal> {
  return withFileLock(dir, FILE, () => {
    const proposals = loadProposals(dir);
    const proposal = proposals.find((p) => String(p.id) === id);
    const open = proposals.filter((p) => p.status === "open").map((p) => p.id);
    if (!proposal) throw new ProposalRefused(`no Proposal has id ${id}`, open);
    if (proposal.status !== "open") throw new ProposalRefused(`Proposal ${id} was already ${proposal.status}`, open);
    const decided: Proposal = { ...proposal, status, decidedAt: at.toISOString(), ...(declined && { declined }) };
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

/** `action` as the command line the user would type. */
export function commandLine(action: string[]): string {
  return ["nico-agent", ...action].map((token) => (/^[\w@#%+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`)).join(" ");
}

function save(dir: string, proposals: Proposal[]) {
  writeJsonAtomic(join(dir, FILE), { proposals });
}
