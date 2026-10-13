/** The page's one `/api/events` stream, open while anything watches. */
let stream: EventSource | null = null;
const watchers = new Set<{ path: string; load: () => void; lost: (why: string) => void }>();
let down = false;
/** The new stream pending after the browser gave up on one, and how many in a row did not open. */
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
/** Access answered with its login: no retry gets past that, only a reload. */
let signedOut = false;
const SIGNED_OUT = "Signed out; reload to sign in again.";

/** How long to wait before reconnect `attempt`, counted from 0: 1 s, doubling to 30 s. */
export function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** Fetch everything watched again now, as a `changed` would, or only `path`: for a change the page itself just made. */
export function reload(path?: string) {
  watchers.forEach((w) => (path === undefined || w.path === path) && w.load());
}

/** `fetch`, not following a redirect: serve never redirects, Access does once the session lapses. */
async function ask(path: string): Promise<Response> {
  const response = await fetch(path, { redirect: "manual" });
  if (response.type === "opaqueredirect") signOut();
  return response;
}

function signOut() {
  signedOut = true;
  stream?.close();
  stream = null;
  clearTimeout(retry);
  watchers.forEach((w) => w.lost(SIGNED_OUT));
}

function connect() {
  retry = undefined;
  const mine = new EventSource("/api/events");
  stream = mine;
  mine.addEventListener("changed", () => reload());
  mine.addEventListener("error", () => void dropped(mine));
  mine.addEventListener("open", () => {
    if (down) reload();
    down = false;
    failures = 0;
  });
}

/**
 * `mine` failed. The browser reconnects by itself after a clean close; after
 * an answer that is no stream (a 502 while the tunnel comes back, Access's
 * login) it closes it for good, so a new one is made later, unless it was
 * Access's.
 */
async function dropped(mine: EventSource) {
  down = true;
  watchers.forEach((w) => w.lost("Lost nico-agent serve; reconnecting."));
  await ask("/api/status").catch(() => null);
  if (stream !== mine || mine.readyState !== EventSource.CLOSED) return;
  stream = null;
  retry = setTimeout(connect, backoff(failures++));
}

/**
 * Fetch `path`'s JSON now, again on every `changed` serve sends, and again
 * on getting serve back after losing it; hand each answer to `got`, and say
 * `failed` when serve can't be reached or refuses. A slower, older answer
 * never overwrites a newer one. Returns the function that stops watching.
 */
export function watch<T>(path: string, got: (data: T) => void, failed: (why: string) => void): () => void {
  let latest = 0;
  const load = async () => {
    if (signedOut) return failed(SIGNED_OUT);
    const mine = ++latest;
    try {
      const response = await ask(path);
      if (signedOut) return;
      const body = await response.json();
      if (mine !== latest) return;
      if (response.ok) got(body as T);
      else failed(body.error ?? `${path} answered ${response.status}`);
    } catch {
      if (mine === latest) failed("Could not reach nico-agent serve; retrying.");
    }
  };
  const watcher = { path, load, lost: failed };
  if (!stream && retry === undefined && !signedOut) connect();
  watchers.add(watcher);
  void load();
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0) {
      stream?.close();
      stream = null;
      clearTimeout(retry);
      retry = undefined;
    }
  };
}
