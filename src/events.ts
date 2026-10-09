/**
 * What the app's SSE stream says changed; the app refetches the matching
 * resource: the Board, the conversation, the Proposals, the Lead's status,
 * or the drawer's Intent, Notes or Standing orders.
 */
export type EventName =
  | "board-changed" | "conversation-entry" | "proposal-changed" | "lead-state"
  | "intent-changed" | "notes-changed" | "orders-changed";

/**
 * The app's one SSE stream, `/api/events`, fanned out to every open page.
 * An event carries no payload to keep in sync: only which resource to refetch.
 */
export class Events {
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly encoder = new TextEncoder();

  /** Send `name` to every open stream. */
  emit(name: EventName) {
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
