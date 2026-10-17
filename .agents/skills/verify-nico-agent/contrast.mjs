#!/usr/bin/env node
// contrast.mjs — check web/src/app.css's colour tokens against WCAG AA, light and dark.
//   node contrast.mjs web/src/app.css
// Prints a line per pair (ok or FAIL, with its ratio), then `all pass` or exits 1.
import { readFileSync } from "node:fs";

const css = readFileSync(process.argv[2], "utf8");
/** The `--name: #hex` tokens of the block that starts at `head`. */
function tokens(head) {
  const at = css.indexOf(head);
  const block = css.slice(at, css.indexOf("\n}", at));
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
}
const light = tokens(":root {");
const themes = { light, dark: { ...light, ...tokens(':root[data-theme="dark"] {') } };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Text on the surfaces it is set on (4.5:1), and the marks and frames a control is found by (3:1).
const TEXT = ["ink", "ink-muted", "accent", "live", "verified", "failed", "ready", "stackable", "waiting", "merged", "closed"];
const pairs = [
  ...TEXT.flatMap((fg) => ["surface", "ground"].map((bg) => [fg, bg, 4.5])),
  ["ink", "raised", 4.5],
  ["ink-muted", "raised", 4.5],
  ["ink", "accent-soft", 4.5],
  ["signal-ink", "signal", 4.5],
  ["accent-ink", "accent", 4.5],
  ["rule", "surface", 3],
];
let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, need] of pairs) {
    const r = ratio(t[fg], t[bg]);
    if (r < need) failed++;
    console.log(`${r < need ? "FAIL" : "ok  "}  ${name}  ${fg} on ${bg}  ${r.toFixed(2)} (needs ${need})`);
  }
}
console.log(failed ? `${failed} fail` : "all pass");
process.exit(failed ? 1 : 0);
