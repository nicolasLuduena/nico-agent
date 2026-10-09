# The Lead

The Lead is the one agent nico-agent keeps running to manage the work with
you (ADR-0010). This page covers what it may do without asking.

## Standing orders

Standing orders say what the Lead may do unasked. Each is on or off:

| Order    | Lets the Lead                                              | Default |
| -------- | ---------------------------------------------------------- | ------- |
| `start`  | queue and start Specs (the Repo's room still caps it)      | off     |
| `answer` | answer an Asking Implementer in its own words              | off     |
| `review` | launch Reviewers                                           | on      |
| `close`  | Close Dispatches whose PR is ready                         | on      |
| `write`  | write Specs and tickets to a Source                        | off     |

By default the Lead does only the safe housekeeping: reviewing and Closing
finished work. Anything an order does not allow, it proposes instead.

See and change them from the CLI:

```bash
nico-agent orders                 # each order, what it lets the Lead do, on or off
nico-agent orders --json          # {"orders": {"start": false, ...}}
nico-agent orders set start on
nico-agent orders set close off
```

They live in `~/.config/nico-agent/config.json` under `orders`, holding only
the ones you set; the rest keep their default:

```json
{
  "repos": [],
  "orders": { "start": true, "close": false }
}
```

Orders are read from config every time they are used, never cached. A change,
from `orders set` or by hand, applies to the Lead's next action without
restarting `nico-agent serve`.

nico-agent enforces the orders that pass through its own tools. `write` is
the exception: the Lead writes to a Source with its own shell, so that order
is a rule of the Lead's skill rather than something nico-agent can check.
