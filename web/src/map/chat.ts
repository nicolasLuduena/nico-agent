/** A question an agent waits on, as serve sends it: picked by an option's `value`; opencode's carries the `session` and form `field` its reply goes to. */
export interface Ask {
  id: string;
  header?: string | null;
  question?: string | null;
  options: { label: string; description?: string | null; value: string }[];
  session?: string;
  field?: string | null;
}

/** An entry of an agent's chat, as `/api/agent/<issue>/<role>/transcript` sends it. */
export interface Entry {
  role: string;
  text?: string;
  /** A tool call's, and on its result the call's it answers. */
  id?: string | null;
  name?: string;
  ask?: Ask;
  todos?: { text: string; status: string }[];
  error?: boolean;
  usage?: Record<string, unknown>;
}

export type Part = { kind: "text"; text: string } | { kind: "thinking"; text: string } | { kind: "tool"; call: Entry; result: Entry | null };

/** A turn of the chat: the user's words, or what the agent did and said till the user spoke again. */
export interface Turn {
  from: "user" | "assistant";
  parts: Part[];
}

/** `entries` as turns, each tool call holding its result. */
export function turns(entries: Entry[]): Turn[] {
  const out: Turn[] = [];
  for (const e of entries) {
    if (!e.text) continue;
    const from = e.role === "user" ? "user" : "assistant";
    let turn = out.at(-1);
    if (turn?.from !== from) out.push((turn = { from, parts: [] }));
    if (e.role === "result") {
      const tools = turn.parts.filter((p) => p.kind === "tool" && !p.result) as Extract<Part, { kind: "tool" }>[];
      const call = tools.find((p) => e.id && p.call.id === e.id) ?? tools.at(-1);
      if (call) call.result = e;
      else turn.parts.push({ kind: "tool", call: { role: "tool", text: "Result" }, result: e });
    } else if (e.role === "tool") turn.parts.push({ kind: "tool", call: e, result: null });
    else turn.parts.push(e.role === "thinking" ? { kind: "thinking", text: e.text } : { kind: "text", text: e.text });
  }
  return out;
}

/** The question the chat's last unanswered question tool asks (claude's), else none. */
export function asked(entries: Entry[]): Ask | null {
  const answered = new Set(entries.filter((e) => e.role === "result").map((e) => e.id));
  const open = [...entries].reverse().find((e) => e.ask && !answered.has(e.id));
  return open?.ask ?? null;
}

/** The tokens the agent's context holds, as its last turn's usage says: claude's or opencode's input, cached or not. */
export function context(entries: Entry[]): number | null {
  const u = [...entries].reverse().find((e) => e.usage)?.usage as Record<string, any> | undefined;
  if (!u) return null;
  const sum = (...n: unknown[]) => n.reduce<number>((a, b) => a + (typeof b === "number" ? b : 0), 0);
  return "input_tokens" in u
    ? sum(u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens)
    : sum(u.input, u.cache?.read, u.cache?.write);
}
