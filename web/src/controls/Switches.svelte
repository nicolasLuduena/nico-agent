<script lang="ts">
  // The switches /api/status shows of a Repo or a Project, each written to
  // config.toml on toggle; one it sets goes back to its Project's or the default.
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import type { Sent } from "./send";
  import { type Holder, unset } from "./settings";

  let { holder }: { holder: Holder } = $props();
  const id = $props.id();

  /** A switch's name as the Glossary says it, capitalised. */
  const said: Record<string, string> = { flip: "Flip to ready", answer: "Faux-nico answers", quality_scan: "Quality-scan" };
  const label = (name: string) => said[name] ?? name[0].toUpperCase() + name.slice(1);

  // The PATCH's answer, until /api/status's next one.
  let switches = $derived(holder.settings.switches);
  const on = $derived(Object.values(switches).filter((s) => s.value).length);
  let saving = $state<Record<string, boolean>>({});
  let refused = $state<Sent | null>(null);

  async function save(name: string, body: Record<string, unknown>, input?: HTMLInputElement) {
    saving[name] = true;
    refused = null;
    const sent = await holder.patch(body);
    saving[name] = false;
    if (sent.ok) switches = sent.answer.switches;
    else {
      refused = sent;
      if (input) input.checked = switches[name].value;
    }
  }
</script>

<!-- Set once and left: folded to how many are on, opened to change one. -->
<section aria-labelledby="{id}-head">
  <details>
    <summary>
      <span class="label" id="{id}-head">Switches</span>
      <span class="on">{on} of {Object.keys(switches).length} on</span>
    </summary>
    <ul>
      {#each Object.keys(switches) as name (name)}
        <li>
          <label for="{id}-{name}">{label(name)}</label>
          <From
            setting={switches[name]}
            {holder}
            keys={["switches", name]}
            name={label(name)}
            busy={saving[name]}
            onundo={() => save(name, unset(["switches", name]))}
          />
          <input
            id="{id}-{name}"
            type="checkbox"
            role="switch"
            checked={switches[name].value}
            disabled={saving[name]}
            aria-busy={saving[name]}
            onchange={(e) => save(name, { switches: { [name]: e.currentTarget.checked } }, e.currentTarget)}
          />
        </li>
      {/each}
    </ul>
    {#if refused && !refused.ok}
      <Refused error={refused.error} help={refused.help} />
    {/if}
  </details>
</section>

<style>
  summary {
    padding-block: 10px;
    cursor: pointer;
  }
  .on {
    float: right;
    color: var(--ink-muted);
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--hairline);
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    min-height: 40px;
  }
  label {
    margin-right: auto;
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
