<script lang="ts">
  // The switches /api/status shows of a Repo or a Project, folded under how
  // many are on, each written to config.toml as it is toggled; one it sets
  // goes back to its Project's or the default.
  import Fold from "./Fold.svelte";
  import From from "./From.svelte";
  import Refused from "./Refused.svelte";
  import Save from "./Save.svelte";
  import { Saves } from "./saves.svelte";
  import { type Holder, SWITCH_TIPS, switchLabel as label, unset } from "./settings";

  let { holder }: { holder: Holder } = $props();
  const id = $props.id();

  // The PATCH's answer, until /api/status's next one.
  let switches = $derived(holder.settings.switches);
  const on = $derived(Object.values(switches).filter((s) => s.value).length);
  const saves = new Saves();

  async function save(name: string, body: Record<string, unknown>, input?: HTMLInputElement) {
    const sent = await saves.run(name, () => holder.patch(body));
    if (sent.ok) switches = sent.answer.switches;
    else if (input) input.checked = switches[name].value;
  }
</script>

<!-- Set once and left: folded to how many are on, opened to change one. -->
<Fold panel={holder.panel} title="Switches" summary="{on} of {Object.keys(switches).length} on" alarm={saves.refused !== null}>
  <ul>
    {#each Object.keys(switches) as name (name)}
      <li class="setting">
        <span>
          <label class="field-name" for="{id}-{name}" data-tip={SWITCH_TIPS[name]}>{label(name)}</label>
          <Save state={saves.of(name)}>
            <From setting={switches[name]} {holder} keys={["switches", name]} name={label(name)} onundo={() => save(name, unset(["switches", name]))} />
          </Save>
        </span>
        <input
          id="{id}-{name}"
          type="checkbox"
          role="switch"
          checked={switches[name].value}
          aria-invalid={saves.invalid(name)}
          aria-busy={saves.busy(name)}
          onchange={(e) => save(name, { switches: { [name]: e.currentTarget.checked } }, e.currentTarget)}
        />
      </li>
    {/each}
  </ul>
  {#if saves.refused}
    <Refused error={saves.refused.error} help={saves.refused.help} />
  {/if}
</Fold>

<style>
  ul {
    padding: 0;
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--hairline);
  }
  /* A long name wraps, its chip under it, and leaves the toggle on its right. */
  li > span {
    flex: 1 1 0;
  }
  label {
    cursor: pointer;
  }
</style>
