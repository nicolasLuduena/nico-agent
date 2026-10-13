# Requests from other sites

serve answers only requests on its own host: `127.0.0.1:<port>`, `localhost:<port>`, or the host
of `bucket.url` when it is set (the tunnel's). Any other `Host`, or none, is refused with 403
`{error, help}` on every path, so another site's page in the user's browser, or one whose name
rebinds to 127.0.0.1, reads nothing. A POST, PATCH or DELETE whose `Origin` (`null` too) is not the
request's own host is refused the same way, whatever its Content-Type, so such a page cannot
refresh, dispatch, turn a Switch off or remove a Repo. A refused request asks nothing outside and writes nothing. The page on serve or behind
the tunnel, and curl (no `Origin`), are answered as before.

## Sub-features

- `foreign-host` a `Host` not serve's answers 403 `Host <host> is not serve's`, none `the request names no Host`; `help` names the hosts serve answers, the tunnel's only as `bucket.url's host`.
- `foreign-origin` `POST /api/refresh`, `POST /api/dispatch`, `DELETE /api/repo/<slug>` and `PATCH /api/repo/<slug>/switches` with another site's or a `null` `Origin` answer 403 `Origin <origin> is not the request's Host`.
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
  HTTP `403`, `{"error":"Host evil.example is not serve's","help":["Ask serve on 127.0.0.1:<port>, localhost:<port> or bucket.url's host"]}`.
- **Rebound name.** Run `$C http --evidence "$E/02-rebound-host" --header "Host: evil.example:$PORT" GET /api/status`.
  HTTP `403`, `error` `Host evil.example:<port> is not serve's`.
- **No Host.** Run `$C http --evidence "$E/03-no-host" --header "Host:" GET /api/status`. HTTP `403`,
  `error` `the request names no Host`.
- **Foreign Origin.** Run `$C http --evidence "$E/04-origin-refresh" --header "Origin: https://evil.example" POST /api/refresh`,
  `$C http --evidence "$E/05-origin-dispatch" --header "Origin: null" POST /api/dispatch '{"issue":"verify/fixture#1"}'`
  `$C http --evidence "$E/06-origin-switches" --header "Origin: https://evil.example" PATCH /api/repo/verify/fixture/switches '{"review":false}'`
  and `$C http --evidence "$E/06-origin-delete" --header "Origin: https://evil.example" DELETE /api/repo/verify/fixture`.
  Each HTTP `403`, `{"error":"Origin <origin> is not the request's Host","help":["Send it from the app serve answers, or with no Origin"]}`.
  `$C http --evidence "$E/07-text-plain-dispatch" --header "Origin: http://evil.example" --header "Content-Type: text/plain" POST /api/dispatch '{"issue":"verify/fixture#1"}'`,
  the body a `no-cors` `fetch` sends, answers the same `403`.
  `$C state > "$E/state.refused.txt"`: no diff from `state.before.txt`, and `$OUTSIDE_LOG` is empty.
- **localhost.** Run `$C http --evidence "$E/08-localhost-switches" --header "Host: localhost:$PORT" --header "Origin: http://localhost:$PORT" PATCH /api/repo/verify/fixture/switches '{"review":false}'`.
  HTTP `200`, the Repo's `switches` with `"review":false`. `$C state > "$E/state.localhost.txt"`:
  its diff from `state.refused.txt` is `config.toml` alone, now with `switches = { review = false }`.
- **The page.** Run `$C page --evidence "$E/09-page-refresh" --click "button=Refresh" --expect "Failed"`.
  `ok` for both steps; `.requests.txt` has `POST /api/refresh -> 200` (the browser sent serve's own `Origin`).
- **Behind the tunnel.** Run `$C tunnel start`, `. "$($C env)"` and
  `grep -A2 '^\[bucket\]' "$CONFIG_DIR/config.toml" > "$E/10-tunnel.config.txt"`: `[bucket]` now has
  `url = "$TUNNEL_URL"`. Run `$C page --tunnel --evidence "$E/11-tunnel-page" --click "region=Switches" --click "switch=Review" --click "button=Refresh" --expect "Failed"`.
  `ok` for every step; `.requests.txt` and `$TUNNEL_LOG` have `PATCH /api/repo/verify/fixture -> 200`
  and `POST /api/refresh -> 200`. `$C http --evidence "$E/12-tunnel-host-foreign-origin" --header "Host: ${TUNNEL_URL#http://}" --header "Origin: https://evil.example" POST /api/refresh`
  answers `403`: the tunnel's host is serve's, another site's page still is not.
- **Proof.** `$C state > "$E/state.after.txt"`; copy `$OUTSIDE_LOG` to `$E/outside.log` and `$TUNNEL_LOG` to `$E/tunnel.log`.

## Gotchas

- curl sets `Host` from the URL; `--header "Host:"` sends none, `--header "Host: x"` replaces it.
- The tunnel stand-in passes its own host on (`127.0.0.1:<tunnel port>`), as cloudflared passes the
  public hostname: serve answers it only because `tunnel start` sets `bucket.url`, as
  `scripts/setup-tunnel.sh` does. serve answers the new host without a restart; while the config
  does not load, only `127.0.0.1` and `localhost` are answered.
- `GET` is not checked for `Origin`; only `Host` keeps another site from reading.
- `npm run dev` in `web/` is answered from its own page only: a page on another origin is refused
  through it too. A run cannot drive it: its target is the fixed `127.0.0.1:42069`, the user's own
  serve.
