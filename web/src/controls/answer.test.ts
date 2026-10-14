import { describe, expect, it } from "vitest";
import { options } from "./answer";

// #365's Implementer asking, as `herdr agent read --source visible` gave it.
const choice = [
  "● Asking once before building.",
  "────────────────────────────────────────",
  "←  ☐ Node tint  ☐ Sections  ✔ Submit  →",
  "",
  "│ Should map nodes carry a tint?",
  "",
  "❯ 1. Faint tint (Recommended)     ┌────┐",
  "     A wash of the Stage's hue.   │ #12 │",
  "  2. No tint                      └────┘",
  "     Keep the fill white.",
  "  3. Type something.",
  "",
  "  Notes: press n to add notes",
  "────────────────────────────────────────",
  "  Chat about this",
  "",
  "Enter to select · ↑/↓ to navigate · n to add notes · Tab to switch questions · Esc to cancel",
].join("\n");

// Claude Code 2.1's, read the same way: its last option past a rule.
const current = [
  "←  ☐ Node tint  ☐ Sections  ✔ Submit  →",
  "",
  "Should map nodes carry a tint of their Stage hue?",
  "",
  "❯ 1. Faint tint",
  "     A wash of the Stage's hue",
  "  2. No tint",
  "     Keep the fill white",
  "  3. Type something.",
  "────────────────────────────────────────",
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

const permission = [
  "╭──────────────────────────────────────────────────────────────╮",
  "│ Bash command                                                 │",
  "│                                                              │",
  "│   rm -rf web/dist                                            │",
  "│   Remove the build output                                    │",
  "│                                                              │",
  "│ Do you want to proceed?                                      │",
  "│ ❯ 1. Yes                                                     │",
  "│   2. Yes, and don't ask again for rm commands in /src/api    │",
  "│   3. No, and tell Claude what to do differently (esc)        │",
  "╰──────────────────────────────────────────────────────────────╯",
].join("\n");

describe("the options read on a pane", () => {
  it("are a Claude choice dialog's, each the digit that picks it, past the marker and the preview beside it", () => {
    expect(options(choice)).toEqual([
      { key: "1", label: "Faint tint (Recommended)" },
      { key: "2", label: "No tint" },
      { key: "3", label: "Type something." },
    ]);
  });

  it("run on past a rule, as Claude Code 2.1 draws its last option", () => {
    expect(options(current).map((o) => o.label)).toEqual(["Faint tint", "No tint", "Type something.", "Chat about this"]);
  });

  it("are a permission prompt's, inside its box", () => {
    expect(options(permission)).toEqual([
      { key: "1", label: "Yes" },
      { key: "2", label: "Yes, and don't ask again for rm commands in /src/api" },
      { key: "3", label: "No, and tell Claude what to do differently (esc)" },
    ]);
  });

  it("are the dialog's under a numbered list the agent wrote above it", () => {
    const plan = "I will:\n1. Read the map\n2. Tint the nodes\n3. Check the phone\n\n";
    expect(options(plan + permission).map((o) => o.key)).toEqual(["1", "2", "3"]);
    expect(options(plan + permission)[0].label).toBe("Yes");
  });

  it("are none on a pane asking in words", () => {
    expect(options("Should I keep the old endpoint?\n\n> ")).toEqual([]);
  });
});
