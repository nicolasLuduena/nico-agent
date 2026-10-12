# Requests from other sites

serve answers only requests on its own host: `127.0.0.1:<port>`, `localhost:<port>`, or the host
of `bucket.url` when it is set (the tunnel's). Any other `Host`, or none, is refused with 403
`{error, help}` before any route runs, so another site's page in the user's browser, or one whose
name rebinds to 127.0.0.1, reads nothing. A POST or PATCH whose `Origin` (`null` too) is not the
request's own host is refused the same way, so such a page cannot refresh, dispatch or flip a
switch. A refused request asks nothing outside and writes nothing. The page on serve or behind
the tunnel, and curl (no `Origin`), are answered as before.

## Sub-features

- `foreign-host` a `Host` not serve's answers 403 `Host <host> is not serve's`, none `the request names no Host`; `help` lists the hosts serve answers.
- `foreign-origin` `POST /api/refresh`, `POST /api/dispatch` and `PATCH /api/repo/<slug>/switches` with another site's or a `null` `Origin` answer 403 `Origin <origin> is not the request's Host`.
- `own-hosts` the same requests on `localhost:<port>` from a page there answer as on `127.0.0.1:<port>`.
- `page` the page on serve, and behind the tunnel once `bucket.url` names it, has its Refresh and switches answered.

## How to get to it (user POV)

- Another site's page in the user's browser sends to `http://127.0.0.1:<port>` (a `no-cors`
  `fetch`), or reads it through a name of its own rebound to 127.0.0.1.
- The user opens the page on serve, on `localhost`, or through the tunnel; or sends with curl.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`.
- `E=.evidence/<issue>/foreign-requests`; `: > "$OUTSIDE_LOG"`; `$C state > "$E/state.before.txt"`.

- **Foreign Host.** Run `$C http --evidence "$E/01-foreign-host" --header "Host: evil.example" GET /api/status`.
  HTTP `403`, `{"error":"Host evil.example is not serve's","help":["Ask serve on 127.0.0.1:<port> or localhost:<port>"]}`.
  `--header "Host: evil.example:$PORT"` (a rebound name, serve's port) answers the same for that host.
- **No Host.** Run `$C http --evidence "$E/03-no-host" --header "Host:" GET /api/status`. HTTP `403`,
  `error` `the request names no Host`.
- **Foreign Origin.** Run `$C http --evidence "$E/04-origin-refresh" --header "Origin: https://evil.example" POST /api/refresh`,
  `$C http --evidence "$E/05-origin-dispatch" --header "Origin: null" POST /api/dispatch '{"issue":"verify/fixture#1"}'`
  and `$C http --evidence "$E/06-origin-switches" --header "Origin: https://evil.example" PATCH /api/repo/verify/fixture/switches '{"review":false}'`.
  Each HTTP `403`, `{"error":"Origin <origin> is not the request's Host","help":["Send it from the app serve answers, or with no Origin"]}`.
  `$C state > "$E/state.refused.txt"`: no diff from `state.before.txt`, and `$OUTSIDE_LOG` is empty.
- **localhost.** Run `$C http --evidence "$E/08-localhost-switches" --header "Host: localhost:$PORT" --header "Origin: http://localhost:$PORT" PATCH /api/repo/verify/fixture/switches '{"review":false}'`.
  HTTP `200`, the Repo's `switches` with `"review":false`; the `state` diff is `config.toml`, now
  with `switches = { review = false }`.
- **The page.** Run `$C page --evidence "$E/09-page-refresh" --click "button=Refresh" --expect "Failed"`.
  `ok` for both steps; `.requests.txt` has `POST /api/refresh -> 200` (the browser sent serve's own `Origin`).
- **Behind the tunnel.** Run `$C tunnel start` and `. "$($C env)"`: `config.toml`'s `[bucket]` now has
  `url = "$TUNNEL_URL"`. Run `$C page --tunnel --evidence "$E/11-tunnel-page" --click "switch=Review" --click "button=Refresh" --expect "Failed"`.
  `ok` for every step; `.requests.txt` and `$TUNNEL_LOG` have `PATCH /api/repo/verify/fixture/switches -> 200`
  and `POST /api/refresh -> 200`. `$C http --evidence "$E/12-tunnel-host-foreign-origin" --header "Host: ${TUNNEL_URL#http://}" --header "Origin: https://evil.example" POST /api/refresh`
  answers `403`: the tunnel's host is serve's, another site's page still is not.
- **Proof.** `$C state > "$E/state.after.txt"`; copy `$OUTSIDE_LOG` to `$E/outside.log` and `$TUNNEL_LOG` to `$E/tunnel.log`.

## Gotchas

- curl sets `Host` from the URL; `--header "Host:"` sends none, `--header "Host: x"` replaces it.
- The tunnel stand-in passes its own host on (`127.0.0.1:<tunnel port>`), as cloudflared passes the
  public hostname: serve answers it only because `tunnel start` sets `bucket.url`, as
  `scripts/setup-tunnel.sh` does. `bucket.url` is read per request, so no restart is needed; a
  config that does not load leaves only `127.0.0.1` and `localhost` answered.
- `GET` is not checked for `Origin`; only `Host` keeps another site from reading.
- `npm run dev` in `web/` is answered because its proxy sends serve's `Host` and, for its own page
  only, serve's `Origin`. A run cannot drive it: the proxy's target is the fixed `127.0.0.1:42069`,
  the user's own serve.
