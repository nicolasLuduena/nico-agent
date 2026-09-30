/** The `owner/name` a GitHub remote URL points at, or null for other hosts. */
export function slugOfRemote(url: string): string | null {
  const match = url
    .trim()
    .match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match?.[1] ?? null;
}

export function sameSlug(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}
