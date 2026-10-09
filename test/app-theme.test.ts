import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SYSTEM_DARK, THEME_KEY, shownTheme, themeChoice } from "../src/app/theme";

describe("the theme the header's toggle picks", () => {
  test("Light until the user picks otherwise; a remembered Dark or System is kept, anything else is Light", () => {
    expect(themeChoice(null)).toBe("light");
    expect(themeChoice("dark")).toBe("dark");
    expect(themeChoice("system")).toBe("system");
    expect(themeChoice("light")).toBe("light");
    expect(themeChoice("purple")).toBe("light");
  });

  test("System shows what the system prefers; Light and Dark ignore it", () => {
    expect(shownTheme("system", true)).toBe("dark");
    expect(shownTheme("system", false)).toBe("light");
    expect(shownTheme("light", true)).toBe("light");
    expect(shownTheme("dark", false)).toBe("dark");
  });
});

/** Run index.html's head script, as the browser does before the first paint, and say what theme it set. */
function headTheme(stored: string | null | Error, systemDark: boolean): string | undefined {
  const html = readFileSync(join(import.meta.dir, "../src/app/index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("index.html has no inline head script");
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const localStorage = {
    getItem: (key: string) => {
      if (stored instanceof Error) throw stored;
      return key === THEME_KEY ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({ matches: query === SYSTEM_DARK && systemDark });
  new Function("document", "localStorage", "matchMedia", script)({ documentElement: root }, localStorage, matchMedia);
  return root.dataset.theme;
}

describe("the page's first paint", () => {
  test("shows the remembered theme before the app loads, so it never flashes the wrong one", () => {
    expect(headTheme(null, true)).toBe("light");
    expect(headTheme("dark", false)).toBe("dark");
    expect(headTheme("system", true)).toBe("dark");
    expect(headTheme("system", false)).toBe("light");
    expect(headTheme("purple", true)).toBe("light");
  });

  test("agrees with the toggle on every remembered choice and system scheme", () => {
    for (const stored of [null, "light", "dark", "system", "purple"]) {
      for (const systemDark of [true, false]) expect(headTheme(stored, systemDark)).toBe(shownTheme(themeChoice(stored), systemDark));
    }
  });

  test("storage that cannot be read shows Light", () => {
    expect(headTheme(new Error("blocked"), true)).toBe("light");
  });
});
