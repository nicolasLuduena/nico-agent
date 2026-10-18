<script lang="ts">
  // Light, Dark, or what the system prefers (the default), remembered in this
  // browser; index.html's head shows the remembered one before the first paint.
  import Segments from "./Segments.svelte";

  type Choice = "light" | "dark" | "system";
  const KEY = "nico-agent.theme";
  const CHOICES: { value: Choice; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  let choice = $state<Choice>(remembered());

  function remembered(): Choice {
    try {
      const stored = localStorage.getItem(KEY);
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch {
      return "system";
    }
  }

  function pick(next: Choice) {
    choice = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Kept for this visit only.
    }
  }

  $effect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const show = () => {
      const dark = choice === "dark" || (choice === "system" && system.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    show();
    if (choice !== "system") return;
    system.addEventListener("change", show);
    return () => system.removeEventListener("change", show);
  });
</script>

<Segments label="Theme" options={CHOICES} value={choice} {pick} />
