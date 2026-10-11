<script lang="ts">
  // The switches /api/status shows of the Repo, each written to config.toml on toggle.
  import type { Repo } from "../status";
  import Refused from "./Refused.svelte";
  import { send, type Sent } from "./send";

  let { repo }: { repo: Repo } = $props();

  /** A switch's name as the Glossary says it, capitalised. */
  const said: Record<string, string> = { flip: "Flip to ready", answer: "Faux-nico answers", quality_scan: "Quality-scan" };
  const label = (name: string) => said[name] ?? name[0].toUpperCase() + name.slice(1);

  // The PATCH's answer, until /api/status's next one.
  let switches = $derived(repo.switches);
  let saving = $state<Record<string, boolean>>({});
  let refused = $state<Sent | null>(null);

  async function toggle(name: string, input: HTMLInputElement) {
    saving[name] = true;
    refused = null;
    const sent = await send("PATCH", `/api/repo/${repo.slug}/switches`, { [name]: input.checked });
    saving[name] = false;
    if (sent.ok) switches = sent.answer.switches;
    else {
      refused = sent;
      input.checked = switches[name];
    }
  }
</script>

<section aria-labelledby="switches-head">
  <h2 class="label" id="switches-head">Switches</h2>
  <ul>
    {#each Object.keys(switches) as name (name)}
      <li>
        <label>
          <span>{label(name)}</span>
          <input
            type="checkbox"
            role="switch"
            checked={switches[name]}
            disabled={saving[name]}
            aria-busy={saving[name]}
            onchange={(e) => toggle(name, e.currentTarget)}
          />
        </label>
      </li>
    {/each}
  </ul>
  {#if refused && !refused.ok}
    <Refused error={refused.error} help={refused.help} />
  {/if}
</section>

<style>
  section {
    display: grid;
    gap: 8px;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--hairline);
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    font-weight: 600;
    cursor: pointer;
  }
  /* A standard toggle: live when on, a hairline track when off. */
  input {
    appearance: none;
    position: relative;
    flex: none;
    width: 40px;
    height: 22px;
    margin: 0;
    border: 1px solid var(--ink-muted);
    border-radius: 2px;
    background: var(--hairline);
    cursor: pointer;
    transition: background-color 120ms ease-out;
  }
  input::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 1px;
    background: var(--ink-muted);
    transition: transform 120ms ease-out;
  }
  input:checked {
    border-color: var(--live);
    background: var(--live);
  }
  input:checked::before {
    background: var(--surface);
    transform: translateX(18px);
  }
  input:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  @media (prefers-reduced-motion: reduce) {
    input,
    input::before {
      transition: none;
    }
  }
</style>
