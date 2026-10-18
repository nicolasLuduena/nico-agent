import type { Run, Status } from "./status";

/** One notice: what only the user can act on and has no node to flag. What has a node is on its flag (map/layout.ts `needs`). */
export type Need =
  | {
      kind: "Blocked" | "Paused" | "Install";
      /** The Repo of a failed Install or a quality-scan; none for a paused Source or the morning agent. */
      repo: string | null;
      /** The blocked agent's name, the paused Source, or a failed Install's last line of output. */
      text: string;
      /** The command that runs a failed Install again. */
      help?: string;
      /** Since when the agent is blocked, when a failed Install started, or the pause's end. */
      at: string | null;
    }
  | {
      kind: "Check";
      repo: string;
      /** What each of the Repo's failing Readiness checks says: one notice per Repo, not per check. */
      checks: string[];
      /** Where the fix for each is: their helps are in the Repo's Readiness, not here. */
      help: string;
      /** When its Repo's checks last changed. */
      at: string | null;
    };

/** The notices, across Repos, from `/api/status`. */
export function needsYou(status: Status): Need[] {
  // An agent of the loop's own herdr reports blocked holds its Run open till the user takes it over; a faux-nico's flags its Dispatch's node instead.
  const blocked = (run: Run | undefined, repo: string | null): Need[] =>
    run?.blocked_since ? [{ kind: "Blocked", repo, text: run.agent, at: run.blocked_since }] : [];
  return [
    ...status.repos.flatMap((r) => blocked(r.last_scan, r.slug)),
    ...blocked(status.morning, null),
    ...status.repos.flatMap((r): Need[] => {
      const last = r.install?.last;
      if (!last || last.ok) return [];
      const help = `Run \`nico-agent install ${r.slug}\` once it is fixed`;
      return [{ kind: "Install", repo: r.slug, text: last.output.split("\n").at(-1) ?? "", help, at: last.at }];
    }),
    ...status.repos.flatMap((r): Need[] => {
      const failing = (r.checks?.results ?? []).filter((c) => !c.ok).map((c) => c.said);
      return failing.length ? [{ kind: "Check", repo: r.slug, checks: failing, help: "Readiness, under Repos", at: r.checks!.at }] : [];
    }),
    ...(status.sources.github.paused_until
      ? [{ kind: "Paused" as const, repo: null, text: "GitHub", at: status.sources.github.paused_until }]
      : []),
  ];
}
