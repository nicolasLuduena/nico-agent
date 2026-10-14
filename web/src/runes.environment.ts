import type { Environment } from "vitest/runtime";

/** Node, with modules compiled as the browser gets them, so a `.svelte.test.ts` runs its runes' effects as the page does. */
export default {
  name: "runes",
  viteEnvironment: "client",
  setup: () => ({ teardown: () => {} }),
} satisfies Environment;
