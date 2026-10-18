import { describe, expect, it } from "vitest";
import { asked, context, turns, type Entry } from "./chat";

const ask = { id: "t2", question: "Keep it?", options: [{ label: "Keep", value: "Keep" }] };

describe("turns", () => {
  it("groups entries by who speaks, each tool call holding its result by id, else the last one waiting", () => {
    const entries: Entry[] = [
      { role: "user", text: "Implement #7" },
      { role: "thinking", text: "Read it." },
      { role: "tool", id: "t1", name: "Bash", text: "Bash {}" },
      { role: "tool", id: "t2", name: "Read", text: "Read {}" },
      { role: "result", id: "t1", text: "one" },
      { role: "result", id: null, text: "two" },
      { role: "progress" },
      { role: "assistant", text: "Done." },
      { role: "user", text: "Thanks" },
    ];
    expect(turns(entries)).toEqual([
      { from: "user", parts: [{ kind: "text", text: "Implement #7" }] },
      {
        from: "assistant",
        parts: [
          { kind: "thinking", text: "Read it." },
          { kind: "tool", call: entries[2], result: entries[4] },
          { kind: "tool", call: entries[3], result: entries[5] },
          { kind: "text", text: "Done." },
        ],
      },
      { from: "user", parts: [{ kind: "text", text: "Thanks" }] },
    ]);
  });
});

describe("asked", () => {
  it("is the last question tool with no result yet", () => {
    const call: Entry = { role: "tool", id: "t2", text: "AskUserQuestion {}", ask };
    expect(asked([call])).toEqual(ask);
    expect(asked([call, { role: "result", id: "t2", text: "Keep" }])).toBeNull();
    expect(asked([{ role: "assistant", text: "Hi" }])).toBeNull();
  });
});

describe("context", () => {
  it("adds up claude's or opencode's input tokens on the last turn that says them", () => {
    const claude = { input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 9 };
    const opencode = { input: 12, output: 5, cache: { read: 1000, write: 0 } };
    expect(context([{ role: "assistant", text: "a", usage: claude }, { role: "user", text: "b" }])).toBe(113);
    expect(context([{ role: "assistant", text: "a", usage: opencode }])).toBe(1012);
    expect(context([{ role: "user", text: "b" }])).toBeNull();
  });
});
