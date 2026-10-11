import { describe, expect, test } from "bun:test";
import { namedParts, repoSlugs, syncLine } from "../src/app/sync";

const NOW = new Date("2026-09-30T12:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const repos = [{ repo: "acme/api", at: ago(120) }, { repo: "acme/web", at: ago(120) }];

describe("the header's sync line", () => {
  test("says how long ago the last Sync ended, in words", () => {
    expect(syncLine({ syncing: false, at: ago(10), repos }, NOW).text).toBe("Synced just now");
    expect(syncLine({ syncing: false, at: ago(130), repos }, NOW).text).toBe("Synced 2 min ago");
    expect(syncLine({ syncing: false, at: ago(3 * 3600 + 100), repos }, NOW).text).toBe("Synced 3 h ago");
    expect(syncLine({ syncing: false, at: "2026-09-27T08:00:00Z", repos }, NOW).text).toBe("Synced Sep 27");
  });

  test("says so before any Sync ever ended, and before serve answers", () => {
    expect(syncLine({ syncing: true, repos: [] }, NOW)).toMatchObject({ text: "Syncing…", syncing: true });
    expect(syncLine(null, NOW)).toMatchObject({ text: "Not synced yet", syncing: false });
  });

  test("keeps the last Sync's time while the next runs", () => {
    expect(syncLine({ syncing: true, at: ago(130), repos }, NOW)).toMatchObject({ text: "Synced 2 min ago", syncing: true });
  });

  test("warns in one line, naming the Repo, when the last Sync failed for it", () => {
    const failed = { repo: "acme/api", at: ago(600), error: "ssh: connect to host github.com port 22: Connection timed out", failedAt: ago(130) };
    const line = syncLine({ syncing: false, at: ago(130), repos: [failed, repos[1]!] }, NOW);
    expect(line.warning).toBe("acme/api didn't sync");
    expect(line.detail).toBe("acme/api: ssh: connect to host github.com port 22: Connection timed out");

    const both = syncLine({ syncing: false, at: ago(130), repos: [failed, { ...repos[1]!, error: "rate limited", failedAt: ago(130) }] }, NOW);
    expect(both.warning).toBe("acme/api and acme/web didn't sync");
    expect(both.detail).toBe("acme/api: ssh: connect to host github.com port 22: Connection timed out\nacme/web: rate limited");

    expect(syncLine({ syncing: false, at: ago(130), repos }, NOW).warning).toBeUndefined();
  });
});

describe("the parts a state-changed event names", () => {
  test("are the ones the page listens for", () => {
    expect(namedParts('{"parts":["board"]}', ["board"])).toBe(true);
    expect(namedParts('{"parts":["stats","sync"]}', ["board", "sync"])).toBe(true);
    expect(namedParts('{"parts":["board"]}', ["repos"])).toBe(false);
    expect(namedParts("not json", ["board"])).toBe(false);
  });
});

describe("the Repos to pick from", () => {
  test("are /api/repos' slugs, in config order, or none", () => {
    expect(repoSlugs({ count: 2, repos: [{ slug: "acme/api", path: "/src/api" }, { slug: "acme/web", path: "/src/web" }] })).toEqual(["acme/api", "acme/web"]);
    expect(repoSlugs({ repos: "0 configured" })).toEqual([]);
    expect(repoSlugs(undefined)).toEqual([]);
  });
});
