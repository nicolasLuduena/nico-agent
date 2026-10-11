#!/usr/bin/env node
// page.mjs — open serve's page in headless Chromium, act on it as a user does, capture what it shows.
// Called by `control-nico-agent page`, which passes the run's URL first and sets VERIFY_PLAYWRIGHT:
//   page.mjs <url> [--evidence PREFIX] [--width PX] [--click ROLE=NAME | --click ROLE~NAME | --press KEY | --expect TEXT
//            | --gone TEXT | --wait SECONDS | --mode pass|502|signed-out]...
// Steps run in the order given; `--mode` asks the tunnel stand-in at <url> (tunnel.mjs) to answer so.
// With --evidence it writes PREFIX.aria.txt (the ARIA snapshot after the last step), PREFIX.png,
// PREFIX.requests.txt (each /api request the page made, with its status; each /api/events stream as
// it is answered) and PREFIX.console.txt (console errors). It exits 1 when a step fails, after capturing.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.VERIFY_PLAYWRIGHT);

const [url, ...argv] = process.argv.slice(2);
let evidence = null;
let width = 1280;
const steps = [];
for (let i = 0; i < argv.length; i++) {
  const [flag, value] = [argv[i], argv[i + 1]];
  if (value === undefined) usage(`${flag} needs a value`);
  i++;
  if (flag === "--evidence") evidence = value;
  else if (flag === "--width") width = Number(value);
  else if (flag === "--click" && /^[a-z]+[=~]/.test(value)) steps.push({ click: value });
  else if (flag === "--press") steps.push({ press: value });
  else if (flag === "--expect") steps.push({ expect: value });
  else if (flag === "--gone") steps.push({ gone: value });
  else if (flag === "--wait" && Number(value) >= 0) steps.push({ wait: Number(value) });
  else if (flag === "--mode") steps.push({ mode: value });
  else usage(`unknown argument ${flag} ${value}`);
}

function usage(why) {
  console.error(`page: ${why}\nusage: page [--evidence PREFIX] [--width PX] [--click ROLE=NAME | --click ROLE~NAME | --press KEY | --expect TEXT | --gone TEXT | --wait SECONDS | --mode pass|502|signed-out]...`);
  process.exit(2);
}

// Playwright's own browser when it is downloaded, else the system Chromium the control script found.
const browser = await chromium.launch().catch((e) => {
  if (!process.env.VERIFY_CHROMIUM || !e.message.includes("Executable doesn't exist")) throw e;
  return chromium.launch({ executablePath: process.env.VERIFY_CHROMIUM });
});
const requests = [];
const errors = [];
let failed = null;
try {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  let inFlight = 0;
  const api = (r) => new URL(r.url()).pathname.startsWith("/api/") && !r.url().endsWith("/api/events");
  page.on("request", (r) => api(r) && inFlight++);
  page.on("requestfinished", async (r) => {
    if (!api(r)) return;
    const response = await r.response();
    requests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.postData() ?? ""} -> ${response?.status()}`.replace("  ", " "));
    inFlight--;
  });
  page.on("requestfailed", (r) => api(r) && (requests.push(`${r.method()} ${r.url()} -> failed`), inFlight--));
  // A stream never finishes: it is listed as it is answered, a reconnect being another line.
  page.on("response", (r) => r.url().endsWith("/api/events") && requests.push(`GET /api/events -> ${r.status()}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  // Settled: no /api request in flight for half a second (the event stream stays open, so never "network idle").
  const settle = async () => {
    for (let quiet = 0, waited = 0; quiet < 5 && waited < 150; waited++) {
      await page.waitForTimeout(100);
      quiet = inFlight === 0 ? quiet + 1 : 0;
    }
  };

  await page.goto(url);
  await page.waitForFunction(() => !document.body.innerText.includes("Reading nico-agent"), null, { timeout: 15000 });
  await settle();
  for (const step of steps) {
    try {
      if (step.click) {
        // ROLE=NAME: the accessible name is NAME; ROLE~NAME: it contains NAME (a strip row's ends in its time).
        const [, role, how, name] = step.click.match(/^([a-z]+)([=~])(.*)$/s);
        await page.getByRole(role, { name, exact: how === "=" }).first().click({ timeout: 10000 });
      } else if (step.press) {
        await page.keyboard.press(step.press);
      } else if (step.gone) {
        // Long enough for a reconnect's backoff.
        await page.getByText(step.gone, { exact: false }).first().waitFor({ state: "hidden", timeout: 60000 });
      } else if (step.wait !== undefined) {
        await page.waitForTimeout(step.wait * 1000);
      } else if (step.mode) {
        const set = await fetch(new URL("/__tunnel/mode", url), { method: "PUT", body: step.mode });
        if (!set.ok) throw new Error(`the tunnel stand-in answered ${set.status}: ${await set.text()}`);
      } else {
        await page.getByText(step.expect, { exact: false }).first().waitFor({ timeout: 10000 });
      }
      await settle();
      console.log(`ok    ${Object.entries(step)[0].join(" ")}`);
    } catch (e) {
      failed = `${Object.entries(step)[0].join(" ")}: ${e.message.split("\n")[0]}`;
      console.log(`FAIL  ${failed}`);
      break;
    }
  }
  const aria = await page.locator("body").ariaSnapshot();
  console.log(aria);
  if (evidence) {
    mkdirSync(dirname(evidence), { recursive: true });
    writeFileSync(`${evidence}.aria.txt`, `${aria}\n`);
    await page.screenshot({ path: `${evidence}.png`, fullPage: true });
    writeFileSync(`${evidence}.requests.txt`, requests.map((r) => `${r}\n`).join(""));
    writeFileSync(`${evidence}.console.txt`, errors.map((e) => `${e}\n`).join(""));
    const quoted = argv.map((a) => (/[\s"'#]/.test(a) ? JSON.stringify(a) : a));
    writeFileSync(`${evidence}.cmd`, `page ${url} ${quoted.join(" ")}\n`);
  }
} finally {
  await browser.close();
}
if (errors.length) console.error(`console errors:\n${errors.join("\n")}`);
process.exit(failed ? 1 : 0);
