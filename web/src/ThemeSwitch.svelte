<script lang="ts">
  // Light, Dark, or what the system prefers (the default), remembered in this
  // browser; index.html's head shows the remembered one before the first paint.
  type Choice = "light" | "dark" | "system";
  const KEY = "nico-agent.theme";
  const CHOICES: { choice: Choice; label: string }[] = [
    { choice: "light", label: "Light" },
    { choice: "dark", label: "Dark" },
    { choice: "system", label: "System" },
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

<div class="switch" role="group" aria-label="Theme">
  {#each CHOICES as c (c.choice)}
    <button type="button" aria-pressed={choice === c.choice} onclick={() => pick(c.choice)}>{c.label}</button>
  {/each}
</div>

<style>
  .switch {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-control);
    background: var(--raised);
  }
  button {
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    color: var(--ink);
  }
  button[aria-pressed="true"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow), 0 0 0 1px var(--hairline);
  }
  /* Over its neighbours, which would paint over its ring. */
  button:focus-visible {
    position: relative;
  }
  @media (width < 720px) {
    button {
      min-height: 44px;
    }
  }
</style>
