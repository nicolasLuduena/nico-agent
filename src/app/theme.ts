/** The header's theme toggle: Light, Dark, or whatever the system prefers. */
export type ThemeChoice = "light" | "dark" | "system";

/** Where the choice is remembered, in this browser only; index.html's head reads it too, before the first paint. */
export const THEME_KEY = "nico-agent.theme";

/** The system preferring dark, as a media query. */
export const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/** The remembered choice: Light until the user picks otherwise, and for anything not a choice. */
export function themeChoice(stored: string | null): ThemeChoice {
  return stored === "dark" || stored === "system" ? stored : "light";
}

/** The theme the page shows for `choice`, when the system prefers dark or not. */
export function shownTheme(choice: ThemeChoice, systemDark: boolean): "light" | "dark" {
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}
