/** The `owner/name` a GitHub remote URL points at, or null for other hosts. */
export function slugOfRemote(url: string): string | null {
  const match = url
    .trim()
    .match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match?.[1] ?? null;
}

/** The branch a GitHub issue's Dispatch works on, so its PR is found by branch after the Dispatch is Closed. */
export function githubBranch(slug: string, number: number) {
  return `agent/${slug.split("/")[1]}-${number}`;
}

export function sameSlug(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}
