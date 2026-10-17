# Live updates

The page stays current without a reload, through the cloudflared tunnel too. serve's `/api/events`
stream says `changed` when state changes and sends a `: keepalive` comment on every other 10-second
look, so a proxy that closes a silent response (Cloudflare does at 100 seconds) never closes it. When
the stream is lost the page says `Lost nico-agent serve; reconnecting.` and reconnects, 1 s after a
reconnect fails, doubling to 30 s, a 502 while the tunnel comes back included; on the first that opens
it refetches what it shows and the line clears. Once Cloudflare Access's session lapses, the first
request it answers with its login redirect (a reconnect, a refetch, a Refresh) shows `Signed out;
reload to sign in again.`, and the page stops reconnecting.

## Sub-features

- `events-keepalive` with nothing changing, `GET /api/events` sends `: keepalive` every 10 seconds and no `changed`.
- `events-changed` a state change sends `event: changed` at the next look, then keepalives again.
- `quiet-hour` the page left open behind the tunnel on a quiet night keeps its one stream and shows no banner.
- `reconnect` a stream the browser gives up on shows the banner; the page opens new streams, backing off, and the banner clears on the first that opens.
- `signed-out` with the stream still open, a refetch (Refresh) landing on Access's login redirect shows the signed-out line and closes the stream.
- `signed-out-on-reconnect` a reconnect landing on Access's login redirect shows the signed-out line, and no stream is opened after it.

## How to get to it (user POV)

- Leave the page open, locally or through the tunnel, while the loop works or sleeps.
- Read `GET /api/events` as the page does (`curl -N`).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/live-updates`.
- For the page's sub-features: `$C tunnel start`, then `. "$($C env)"` again for
  `$TUNNEL_URL` and `$TUNNEL_LOG`. The stand-in sits where cloudflared and Access do: it cuts a
  response that sends nothing for 100 seconds; `--mode 502` (or `$C tunnel 502`) answers every request
  502 and cuts the open streams, as a dropped tunnel does; `--mode signed-out` answers every new
  request with Access's 302 to its login on another origin and leaves open streams be, as a lapsed
  session does; `--mode pass` passes requests on again. `$TUNNEL_LOG`
  has a line per answer, and per stream how it ended, after how long, with how many keepalives.

- **Keepalive.** Run `curl -sN --max-time 105 "$URL/api/events" > "$E/01-keepalive.events.txt"` (exit
  `28`, the time limit). The file is ten `: keepalive` lines, each followed by a blank one, and no
  `event: changed`.
- **Changed.** Run `curl -sN --max-time 35 "$URL/api/events" > "$E/02-changed.events.txt" &`, then
  `sleep 12; $C seed issues; wait`. The file is a keepalive, `event: changed` with `data: {}`, and a
  keepalive: the look after the seed saw the new cache, the next one nothing new.
- **Quiet hour.** `$C state > "$E/04-quiet-hour.state.before.txt"`, then run `$C page --tunnel
  --evidence "$E/04-quiet-hour" --wait 3600 --gone "Lost nico-agent serve"` (shorter `--wait` for a
  quick check; past 100 is what counts). `ok` for both steps; `.requests.txt` has exactly one `GET
  /api/events -> 200`; `$TUNNEL_LOG` has that stream `closed by the page after 3600 s` (about) with
  360 keepalives, and no `cut: nothing sent for 100 s`. `$C state` after shows no change. Copy
  `$TUNNEL_LOG` to `$E/04-quiet-hour.tunnel.log`.
- **Reconnect.** Run `$C page --tunnel --evidence "$E/05-reconnect" --mode 502 --expect "Lost
  nico-agent serve; reconnecting." --wait 5 --mode pass --gone "Lost nico-agent serve"`. `ok` for
  every step; `.requests.txt` has the first `GET /api/events -> 200`, then three `GET /api/events
  -> 502` lines, each with a `GET /api/status -> 502`, then `GET /api/events -> 200` and the refetches `GET
  /api/status -> 200` and `GET /api/map/verify%2Ffixture -> 200`. `$TUNNEL_LOG` shows the browser's own
  retry about 3 s after the cut, then the page's new streams 1 s, 2 s and 4 s after each 502, the
  last one opening.
- **Signed out.** Run `$C page --tunnel --evidence "$E/06-signed-out" --mode signed-out --click
  "button=Refresh" --expect "Signed out; reload to sign in again." --wait 40 --expect "Signed out;
  reload to sign in again."`. `ok` for every step; under `Refresh` an alert says `Could not reach
  nico-agent serve.`; `.requests.txt` has `POST /api/refresh -> 302`, the refetches `GET
  /api/status -> 302` and `GET /api/map/verify%2Ffixture -> 302`, and no `/api/events` after the first;
  `$TUNNEL_LOG` has that stream `closed by the page`.
- **Signed out on a reconnect.** Run `$C tunnel pass`, then `$C page --tunnel --evidence
  "$E/07-signed-out-on-reconnect" --mode 502 --expect "Lost nico-agent serve; reconnecting." --wait
  5 --mode signed-out --expect "Signed out; reload to sign in again." --wait 40 --expect "Signed out;
  reload to sign in again."`. `.requests.txt` has the 502s, then `GET /api/events -> 302` and `GET
  /api/status -> 302`, and nothing after; `$TUNNEL_LOG` has the reconnect's `GET /api/events -> 302`
  followed to the stand-in's `Access login`.
- **Proof.** `$C state > "$E/state.after.txt"`; copy `$OUTSIDE_LOG` to `$E/outside.log` (empty
  without a live Dispatch).

## Gotchas

- The stream compares each state file's modification time and size, not what it holds: a rewrite
  with the same text still sends `changed`.
- The real tunnel and Access are not driven: the stand-in answers what they answer, from the page's
  side. Through the real tunnel, leave the page open and read the same banner.
- `--mode` reaches only the stand-in; without `--tunnel` the step fails on serve's 404.
- `--mode 502` cuts every open stream of the run, a quiet-hour page's included: drive `quiet-hour`
  alone, in its own run.
- The browser retries a cut stream itself (about 3 s) before the page's own retries start, so the
  first 502 comes about 3 s after the cut; the console lists each 502 and the cut's
  `ERR_EMPTY_RESPONSE`, which are the scenario, not faults.
- After `signed-out` the page stays signed out until a reload, even with `$C tunnel pass`: that is
  the feature.
