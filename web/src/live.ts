/** The page's one `/api/events` stream, open while anything watches. */
let stream: EventSource | null = null;
const watchers = new Set<{ load: () => void; lost: (why: string) => void }>();
let down = false;
/** The new stream pending after the browser gave up on one, and how many in a row did not open. */
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;

/** How long to wait before reconnect `attempt`, counted from 0: 1 s, doubling to 30 s. */
export function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/** Fetch everything watched again now, as a `changed` would: for a change the page itself just made. */
export function reload() {
  watchers.forEach((w) => w.load());
}

function connect() {
  retry = undefined;
  const mine = new EventSource("/api/events");
  stream = mine;
  mine.addEventListener("changed", reload);
  mine.addEventListener("error", () => void lost(mine));
  mine.addEventListener("open", () => {
    if (down) reload();
    down = false;
    failures = 0;
  });
}

/**
 * `mine` failed. The browser reconnects by itself after a clean close; after
 * an answer that is no stream (a 502 while the tunnel comes back) it closes
 * it for good, so a new one is made later. Access's login redirect, once the
 * session lapses, is one no retry gets past.
 */
async function lost(mine: EventSource) {
  down = true;
  watchers.forEach((w) => w.lost("Lost nico-agent serve; reconnecting."));
  const answer = await fetch("/api/status", { redirect: "manual" }).catch(() => null);
  if (stream !== mine) return;
  if (answer?.type === "opaqueredirect") {
    mine.close();
    stream = null;
    watchers.forEach((w) => w.lost("Signed out; reload to sign in again"));
  } else if (mine.readyState === EventSource.CLOSED) {
    stream = null;
    retry = setTimeout(connect, backoff(failures++));
  }
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
    const mine = ++latest;
    try {
      const response = await fetch(path);
      const body = await response.json();
      if (mine !== latest) return;
      if (response.ok) got(body as T);
      else failed(body.error ?? `${path} answered ${response.status}`);
    } catch {
      if (mine === latest) failed("Could not reach nico-agent serve; retrying.");
    }
  };
  const watcher = { load, lost: failed };
  if (!stream && retry === undefined) connect();
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
