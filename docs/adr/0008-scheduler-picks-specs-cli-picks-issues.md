# nico-agent orders the issues of a Spec; the Scheduler only picks Specs

A Scheduler (Hermes, or any agent) dispatches without the user, so we keep its
judgment, and the damage it can do, as small as possible. Everything that can
be decided mechanically lives in nico-agent with tests: a Spec's next issue
(the first unblocked sub-issue, in sub-issue order), the PR it stacks on (the
Spec's newest, so each Spec is one Stack of unlimited height), the cap on
Specs running per Repo, and whether a Spec is Held. The Scheduler decides only
which Spec starts when a Repo has room, which needs reading the Specs and
asking the user. We rejected letting the Scheduler order issues itself or
predict which files they will touch: an LLM guessing is less trustworthy than
a rule, and a Stack per Spec makes overlap within a Spec harmless anyway.

The Scheduler's reach is enforced, not requested: it gets no shell, only an MCP
server from nico-agent with three tools: reading the Board; `advance`, which
dispatches running Specs' next issues and starts a Spec only when its Repo has
room; and `answer`, which relays the user's reply to an Implementer. The worst
a wrong judgment can do is start the wrong Spec.

## Amendment: relaying answers to waiting Implementers

An Implementer sometimes stops to ask the user something, and overnight it
would wait until morning. So the Scheduler's reach grows by one relay: the
Board lists the Implementers waiting on the user (herdr's Agent state
`blocked`) with the question on their screen, and `answer` types text into
one of them. nico-agent refuses `answer` unless that Implementer is `blocked`,
so a working Implementer, or one whose question was already answered, can't
be typed into, and a late or duplicate reply is refused.

What can't be enforced: nico-agent can't prove the text came from the user. A
Scheduler could answer a question itself. The skill's rule covers that ("relay
the user's words verbatim; never answer an Implementer yourself"), and the
`blocked`-only gate limits the damage to one reply to one question an agent
asked. We accepted that over leaving Implementers stuck until the user opens
herdr.
