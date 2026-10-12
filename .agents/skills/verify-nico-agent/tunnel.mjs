#!/usr/bin/env node
// tunnel.mjs — a stand-in for the cloudflared tunnel and Cloudflare Access in front of serve.
// Called by `control-nico-agent tunnel start`:
//   tunnel.mjs <serve url> <port> <log file>
// It passes each request on to serve and, like Cloudflare, cuts a response that sends nothing for
// 100 seconds. `PUT /__tunnel/mode` with `pass`, `502` or `signed-out` changes how it answers every
// other request: passed to serve; a 502, as while the tunnel comes back; or Access's redirect to its
// login on another origin, as once the session lapses. Switching to `502` cuts every open stream, as a
// tunnel dropping does; Access checks a request only as it starts, so a lapse leaves open streams be.
// Each answer is a line of the log; a stream's says how long it lived and what it carried.
import { appendFileSync } from "node:fs";
import { createServer, request } from "node:http";

const [upstream, port, log] = process.argv.slice(2);
const IDLE_MS = 100_000;
const MODES = ["pass", "502", "signed-out"];
let mode = "pass";
/** Each open stream's `cut(why)`. */
const streams = new Set();
const say = (line) => appendFileSync(log, `${new Date().toISOString()} ${line}\n`);

createServer((req, res) => {
  const asked = `${req.method} ${req.url}`;
  if (asked === "PUT /__tunnel/mode") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!MODES.includes(body.trim())) return res.writeHead(400).end(`a mode is ${MODES.join(", ")}, not "${body}"\n`);
      mode = body.trim();
      say(mode === "502" ? `mode 502, cutting ${streams.size} open stream(s)` : `mode ${mode}`);
      if (mode === "502") streams.forEach((cut) => cut("cut by mode 502"));
      res.end(`${mode}\n`);
    });
    return;
  }
  // Access's login page, on its own origin (`localhost`, where the page is on `127.0.0.1`).
  if (req.url.startsWith("/cdn-cgi/access/login")) {
    say(`${asked} -> 200 Access login`);
    return res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Sign in (verify-nico-agent stand-in)</h1>\n");
  }
  if (mode === "502") {
    say(`${asked} -> 502`);
    return res.writeHead(502, { "Content-Type": "text/html" }).end("<h1>502 Bad gateway (verify-nico-agent stand-in)</h1>\n");
  }
  if (mode === "signed-out") {
    const login = `http://localhost:${port}/cdn-cgi/access/login/127.0.0.1?redirect_url=${encodeURIComponent(req.url)}`;
    say(`${asked} -> 302 ${login}`);
    return res.writeHead(302, { Location: login }).end();
  }
  const forward = request(upstream + req.url, { method: req.method, headers: req.headers }, (answer) => {
    res.writeHead(answer.statusCode, answer.headers);
    if (answer.headers["content-type"] !== "text/event-stream") {
      say(`${asked} -> ${answer.statusCode}`);
      return answer.pipe(res);
    }
    // A stream's headers go at once, as Cloudflare's do; Node would hold them till the first byte.
    res.flushHeaders();
    say(`${asked} -> ${answer.statusCode} stream opened`);
    const opened = Date.now();
    let keepalives = 0;
    let changed = 0;
    let why = "closed by the page";
    let idle;
    const cut = (because) => {
      why = because;
      res.destroy();
    };
    const rearm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => cut("cut: nothing sent for 100 s"), IDLE_MS);
    };
    streams.add(cut);
    rearm();
    answer.on("data", (chunk) => {
      const text = chunk.toString();
      keepalives += text.split(": keepalive").length - 1;
      changed += text.split("event: changed").length - 1;
      res.write(chunk);
      rearm();
    });
    res.on("close", () => {
      clearTimeout(idle);
      streams.delete(cut);
      forward.destroy();
      const lived = Math.round((Date.now() - opened) / 1000);
      say(`${asked} stream ${why} after ${lived} s: ${keepalives} keepalive(s), ${changed} changed`);
    });
  });
  forward.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502).end();
    say(`${asked} -> serve unreachable: ${e.message}`);
  });
  req.pipe(forward);
}).listen(Number(port), "127.0.0.1", () => say(`tunnel on http://127.0.0.1:${port} to ${upstream}`));
