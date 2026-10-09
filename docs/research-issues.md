# Research issues

A Research issue is an issue labelled `research` as well as
`ready-for-agent`. It is Ready, Stackable and dispatched like any other issue,
by `nico-agent dispatch` and by `advance` in a Spec, but its Implementer is
told to research instead of build. nico-agent sends it the `research` prompt
in place of `implement`:

```
{sigil}research {issueUrl} yourself, not in a background agent, against primary sources; write the findings, with their sources, to one Markdown file in docs/research/ and open it as a draft PR against {baseBranch}
```

The Bot suffix follows it where the GitHub App is installed on the Repo, as it
follows `implement`. A Stacked dispatch adds the same stacking note.

The label is read from the issue nico-agent already fetches to dispatch it, so
research mode costs no extra GitHub or Linear request, and needs no flag. The
Dispatch records it, so a resumed Dispatch sends the `research` prompt again.
The label must be on the issue when it is dispatched; adding it later does not
change a Dispatch already In flight.

`nico-agent board --json` sets `research: true` on Research issues (under
`issues`, `stackable` and `prOpen`) and on their Dispatches (under
`dispatches`).

## Changing the prompt

Set `prompts.research` in `~/.config/nico-agent/config.json`. Like
`implement`, it is filled with `{sigil}`, `{issueUrl}` and `{baseBranch}`;
`{prUrl}` and `{prBaseBranch}` are only filled for `review`, so they are sent
as written. An unknown placeholder is a config error:

```json
{
  "prompts": {
    "research": "{sigil}research {issueUrl} and open the findings as a draft PR against {baseBranch}"
  }
}
```
