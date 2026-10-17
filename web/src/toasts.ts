import type { Run, Status } from "./status";

/** One toast: what only the user can act on and has no node to flag. What has a node is on its flag (map/layout.ts `needs`). */
export interface Need {
  kind: "Blocked" | "Paused" | "Install" | "Check";
  /** The Repo of a failing check, a failed Install or a quality-scan; none for a paused Source or the morning agent. */
  repo: string | null;
  /** The blocked agent's name, the paused Source, a failed Install's last line of output, or what a failing check says. */
  text: string;
  /** The help of a failed Install or a failing check. */
  help?: string | null;
  /** Since when the agent is blocked, when a failed Install started, when its Repo's checks last changed, or the pause's end. */
  at: string | null;
}

/** The toasts, across Repos, from `/api/status`. */
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
    ...status.repos.flatMap((r) =>
      (r.checks?.results ?? [])
        .filter((c) => !c.ok)
        .map((c): Need => ({ kind: "Check", repo: r.slug, text: c.said, help: c.help, at: r.checks!.at })),
    ),
    ...(status.sources.github.paused_until
      ? [{ kind: "Paused" as const, repo: null, text: "GitHub", at: status.sources.github.paused_until }]
      : []),
  ];
}
