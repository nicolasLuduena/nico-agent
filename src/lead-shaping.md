# Shaping new work

The user brings an idea in the conversation; you shape it with them into a Spec and its tickets on the Repo's Source, then start it. Three stages, in order, each ending on its own criterion: grill, write (or propose the write), start.

The shaping skills beside this one carry the method: `grilling`, `to-spec` and `to-tickets`. When your Harness will not load one by name, read its `SKILL.md` in your skills directory and follow it. This page says how to run them as the Lead: through `ask`, in the Repo's clone, under the `write` order.

## 1. Grill

Run the `grilling` skill with the user, through `ask`:

- Each question of a round is its own `ask`: the question with your recommended answer, and the answer's choices when there are a few clear ones, your recommendation first. A round of four questions is four `ask`s, then one `say` that the round is out.
- The user answers on the question's card. Their answers arrive in your Inbox; ask the next round only once every question of this one is answered.
- Every decision is the user's. Your recommendation sits in the question; the answer is theirs alone, so an open question stays open until they answer it, however sure you are.
- Facts are yours to find. Look them up in the Repo's clone (its code, its `GLOSSARY.md`, its `docs/adr/`) and its Source, and ask only what they leave open.

Grilling is done when the frontier is empty and the user has said yes to a last `ask`: "Do we share an understanding of <the idea>?", quoting your one-paragraph summary of it.

## 2. Write the Spec and its tickets

Find the Repo's clone: its `path` in `nico-agent repo list --json`. Change into it, and work there as the user would: read its `AGENTS.md`, its issue tracker doc and its triage labels doc (the `AGENTS.md` names them, under `docs/agents/` by convention), and follow them for every write, the identity and signature rules included.

Write in the Repo's own language: the terms of its `GLOSSARY.md` and the decisions of its `docs/adr/`, both read before you write a line. A Spec that contradicts an ADR says so and why.

Then read `nico-agent orders --json` for the `write` order.

**`write` on** (or the user asked you, in the conversation, to write this one):

1. Run `to-spec`: the Spec as its template lays out, published to the Repo's Source with the `ready-for-agent` label. Its seams check is one `ask`.
2. Run `to-tickets` on that Spec: its breakdown quiz is one `ask` with the numbered breakdown in it, then each ticket published blockers first, as a sub-issue of the Spec, with the tracker's native blocking links, labelled `ready-for-agent`.

Done when the Spec and every ticket are on the Source, labelled, with each ticket's blocking links in place: read them back from the Source to check.

**`write` off**: stop before the first write and propose it.

1. Draft everything you would write: the Spec, as `to-spec` would publish it; then each ticket, in dependency order, numbered from 1, with its title, its body as `to-tickets` would publish it, and "Blocked by" naming the other tickets by number. Run both skills' `ask`s (seams, breakdown) first, as above.
2. Call `propose` with `write`: `repo` the Repo as the Board names it, `text` the whole draft in Markdown, and a `reason` naming the idea and that the `write` order is off.
3. `say` that the draft waits on the user's approval in their Proposals.

The user's `decision` on it arrives in your Inbox, carrying the `write`:

- **Approved**: write exactly that text, through the `write`-on steps above: the Spec first, then the tickets, their "Blocked by" numbers turned into the real issues' native blocking links. Approval is the user's yes for this write alone.
- **Declined**: write nothing. The `text` of the decision is the user's reason; take it back into the conversation, and propose again only a draft the reason no longer applies to.

## 3. Start it

Read `board` again: the new Spec appears in its Repo's `specs` once the Source has it. Then start it as Choosing what continues says: `queue` it, under the `start` order, when the user asked for it to start or the Intent names it; otherwise propose its `queue`, with a reason naming the idea. `say` the Spec, its tickets, and whether it is queued or waits on the user.

The shaping is done when the Spec is queued, or its `queue` is proposed.
