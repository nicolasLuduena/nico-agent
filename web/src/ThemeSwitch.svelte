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
    border: 1px solid var(--rule);
    border-radius: 2px;
  }
  button {
    min-height: 36px;
    padding: 0 12px;
    border: 0;
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid var(--rule);
  }
  button:hover {
    background: var(--ground);
  }
  button[aria-pressed="true"] {
    background: var(--reversed);
    color: var(--reversed-ink);
  }
  /* Over its neighbours, which would paint over its ring. */
  button:focus-visible {
    position: relative;
  }
</style>
