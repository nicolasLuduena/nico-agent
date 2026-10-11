import { useEffect, useRef, useState } from "react";
import type { EventName, PageCommand } from "../events";
import type { PartName } from "../local-state";
import { namedParts } from "./sync";

/** What the page hears from `serve`: an `/api/events` event or command, its stream (re)opening, or losing it. */
type Heard = EventName | PageCommand | "open" | "error";

/** The page's one `/api/events` stream, open while anything listens, shared by every resource. */
let source: EventSource | null = null;
let listening = 0;

/** Call `listener` on each of `names`, with the event's data; the returned function stops it. */
function listen(names: Heard[], listener: (name: Heard, data: string) => void): () => void {
  source ??= new EventSource("/api/events");
  const stream = source;
  listening++;
  const handlers = names.map((name) => [name, (e: Event) => listener(name, e instanceof MessageEvent ? String(e.data) : "")] as const);
  for (const [name, handler] of handlers) stream.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of handlers) stream.removeEventListener(name, handler);
    if (--listening === 0) {
      stream.close();
      source = null;
    }
  };
}

const UNREACHABLE = "Could not reach nico-agent serve; retrying.";
const LOST = "Lost nico-agent serve; reconnecting.";

/**
 * The JSON at `path`, fetched on load, on each of `events`, on a
 * `state-changed` naming any of `parts` of Local state (ADR-0015), and on
 * reconnecting to `serve` (`open` fires on the first connection and after
 * each reconnection, such as a restarted serve), with when it was sampled.
 */
export function useResource<T>(path: string, events: EventName[], parts: PartName[] = []) {
  const [loaded, setLoaded] = useState<{ data: T; sampled: Date } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const load = useRef<() => void>(() => {});
  const names = [...events, ...(parts.length ? ["state-changed"] : [])].join(" ");
  const named = parts.join(" ");
  useEffect(() => {
    let latest = 0;
    load.current = async () => {
      // A slow answer must not overwrite a newer one.
      const request = ++latest;
      try {
        const data = (await (await fetch(path)).json()) as T;
        if (request !== latest) return;
        setLoaded({ data, sampled: new Date() });
        setFailure(null);
      } catch {
        if (request === latest) setFailure(UNREACHABLE);
      }
    };
    const wanted = named.split(" ") as PartName[];
    const stop = listen(["open", "error", ...(names.split(" ").filter(Boolean) as EventName[])], (name, data) => {
      if (name === "error") setFailure(LOST);
      else if (name !== "state-changed" || namedParts(data, wanted)) void load.current();
    });
    // A resource that comes after the stream opened hears no `open`.
    if (source?.readyState === EventSource.OPEN) void load.current();
    return stop;
  }, [path, names, named]);
  return { ...loaded, failure };
}

/** Call `run` each time `serve` sends this page `command`, such as `listen` from `nico-agent voice talk`. */
export function usePageCommand(command: PageCommand, run: () => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => listen([command], () => latest.current()), [command]);
}
