/** The page's one `/api/events` stream, open while anything watches. */
let stream: EventSource | null = null;
const watchers = new Set<{ load: () => void; lost: () => void }>();
let down = false;

/** Fetch everything watched again now, as a `changed` would: for a change the page itself just made. */
export function reload() {
  watchers.forEach((w) => w.load());
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
  const watcher = { load, lost: () => failed("Lost nico-agent serve; reconnecting.") };
  if (!stream) {
    stream = new EventSource("/api/events");
    stream.addEventListener("changed", () => watchers.forEach((w) => w.load()));
    stream.addEventListener("error", () => {
      down = true;
      watchers.forEach((w) => w.lost());
    });
    stream.addEventListener("open", () => {
      if (down) watchers.forEach((w) => w.load());
      down = false;
    });
  }
  watchers.add(watcher);
  void load();
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0) {
      stream?.close();
      stream = null;
    }
  };
}
