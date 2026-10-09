import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice, shownTheme, themeChoice } from "./theme";

const DARK = "(prefers-color-scheme: dark)";

/**
 * The theme picked, remembered in this browser, shown on the page's root as
 * `data-theme`; while it is System, a change of the system's scheme follows.
 * index.html's head sets the first one, so the page never flashes the wrong theme.
 */
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      return themeChoice(localStorage.getItem(THEME_KEY));
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    const system = matchMedia(DARK);
    const show = () => { document.documentElement.dataset.theme = shownTheme(choice, system.matches); };
    show();
    if (choice !== "system") return;
    system.addEventListener("change", show);
    return () => system.removeEventListener("change", show);
  }, [choice]);
  const pick = (next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Kept for this visit only.
    }
  };
  return { choice, pick };
}

const CHOICES: { choice: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    choice: "light",
    label: "Light",
    icon: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85" /></>,
  },
  { choice: "dark", label: "Dark", icon: <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" /> },
  { choice: "system", label: "System", icon: <><rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11v3" /></> },
];

/** The header's Light, Dark and System toggle: three drawn icons, the picked one raised. */
export function ThemeToggle() {
  const { choice, pick } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {CHOICES.map((c) => (
        <button key={c.choice} type="button" aria-pressed={choice === c.choice} aria-label={c.label} title={c.label} onClick={() => pick(c.choice)}>
          <svg viewBox="0 0 16 16" aria-hidden="true">{c.icon}</svg>
        </button>
      ))}
    </div>
  );
}
