import type { Route } from "./route";

/**
 * The Project whose tab shows, its view, the Wiki and Component open in its
 * Wiki view, and the issue whose node is open on its map (the panel, #253).
 * All but the issue live in the URL's hash too (App). The strip sets the
 * Project and the issue; the tabs set the Project; the map reads both.
 */
export const selection = $state<Route & { issue: string | null }>({
  project: null,
  view: "map",
  wiki: null,
  component: null,
  issue: null,
});
