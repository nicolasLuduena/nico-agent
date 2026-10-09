import { describe, expect, test } from "bun:test";
import { meaningfulLine } from "../src/screen-line";

describe("an agent's last meaningful screen line", () => {
  test("is the last line with something on it, trimmed", () => {
    expect(meaningfulLine("$ bun test\n 3 pass\n 1 fail  \n\n   \n")).toBe("1 fail");
  });

  test("skips an empty prompt and the box drawn around it", () => {
    const claude = [
      "⏺ Update(src/peek.ts)",
      "  ⎿  Updated src/peek.ts with 4 additions",
      "",
      "╭──────────────────────────────────────────╮",
      "│ >                                        │",
      "╰──────────────────────────────────────────╯",
      "  ? for shortcuts",
    ].join("\n");
    expect(meaningfulLine(claude)).toBe("⎿  Updated src/peek.ts with 4 additions");
    expect(meaningfulLine("Wrote 3 files\n› \n")).toBe("Wrote 3 files");
    expect(meaningfulLine("All tests pass\n$\n❯ ")).toBe("All tests pass");
  });

  test("skips a spinner, whatever it says beside it", () => {
    expect(meaningfulLine("⏺ Running the tests\n\n✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)\n")).toBe("⏺ Running the tests");
    expect(meaningfulLine("Edited src/web.ts\n⠹ Working (3s • esc to interrupt)")).toBe("Edited src/web.ts");
    expect(meaningfulLine("Reading files\n· Pondering…")).toBe("Reading files");
  });

  test("skips the harness's mode line and hints under its input box", () => {
    expect(meaningfulLine("Edited src/web.ts\n╭─╮\n│ > │\n╰─╯\n  ⏵⏵ accept edits on (shift+tab to cycle)")).toBe("Edited src/web.ts");
    expect(meaningfulLine("Ran bun test\n  Context left until auto-compact: 12%")).toBe("Ran bun test");
  });

  test("keeps a middle-dot bullet that is not a spinner's word", () => {
    expect(meaningfulLine("Changed:\n· src/web.ts and src/peek.ts")).toBe("· src/web.ts and src/peek.ts");
  });

  test("is none for a screen of nothing but chrome", () => {
    expect(meaningfulLine("\n╭───╮\n│ > │\n╰───╯\n✳ Booping…\n")).toBeUndefined();
    expect(meaningfulLine("")).toBeUndefined();
  });

  test("keeps a bullet, which is not a spinner", () => {
    expect(meaningfulLine("Plan:\n- add the route\n* test it")).toBe("* test it");
  });

  test("keeps the text of a line drawn inside a box, without the box", () => {
    expect(meaningfulLine("│ Do you want to make this edit to peek.ts? │\n╰────╯")).toBe("Do you want to make this edit to peek.ts?");
  });
});
