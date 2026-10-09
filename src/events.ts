/**
 * What the app's SSE stream says changed; the app refetches the matching
 * resource: the Board, the conversation, the Proposals, the Lead's status,
 * the drawer's Intent, Notes or Standing orders, or whether Voice is on.
 */
export type EventName =
  | "board-changed" | "conversation-entry" | "proposal-changed" | "lead-state"
  | "intent-changed" | "notes-changed" | "orders-changed" | "voice-changed";

/** What the SSE stream asks one page to do rather than refetch: `listen` starts its talk button (`nico-agent voice talk`). */
export type PageCommand = "listen";

/**
 * The app's one SSE stream, `/api/events`, fanned out to every open page.
 * An event carries no payload to keep in sync: only which resource to refetch.
 */
export class Events {
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();
  private readonly listeners: { name: EventName; listener: () => void }[] = [];

  /** Call `listener` on every `name` emitted, as `serve`'s speech does on a new entry. */
  on(name: EventName, listener: () => void) {
    this.listeners.push({ name, listener });
  }

  /** Send `name` to every open stream. */
  emit(name: EventName) {
    for (const l of this.listeners) {
      if (l.name !== name) continue;
      // A listener that fails is logged, never left to stop the streams hearing of it.
      try {
        l.listener();
      } catch (e) {
        console.error(`${name} listener failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // `data` must be present and not empty, or a browser drops the event.
    const chunk = this.encoder.encode(`event: ${name}\ndata: {}\n\n`);
    for (const stream of this.streams) {
      try {
        stream.enqueue(chunk);
      } catch {
        // A stream that closed unseen is dropped, not left to stop the others.
        this.streams.delete(stream);
      }
    }
  }

  /**
   * Send `command` to the page opened last, so one microphone listens however
   * many pages are open; false when no page is open to hear it.
   */
  command(command: PageCommand): boolean {
    for (const stream of [...this.streams].reverse()) {
      try {
        stream.enqueue(this.encoder.encode(`event: ${command}\ndata: {}\n\n`));
        return true;
      } catch {
        this.streams.delete(stream);
      }
    }
    return false;
  }

  /** A stream open until the page goes away (`signal`) or stops reading. */
  stream(signal: AbortSignal): Response {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const forget = () => {
      this.streams.delete(controller);
      signal.removeEventListener("abort", close);
    };
    const close = () => {
      forget();
      controller.close();
    };
    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.streams.add(c);
        signal.addEventListener("abort", close);
        // A page that lost serve tries again within a second, then refetches on reopening.
        c.enqueue(this.encoder.encode("retry: 1000\n\n"));
      },
      cancel: forget,
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }
}
