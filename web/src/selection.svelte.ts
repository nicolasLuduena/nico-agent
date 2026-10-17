import type { Route } from "./route";

/**
 * The Project whose tab shows, its view, and the issue whose node is open on
 * its map (the panel, #253). The Project and view live in the URL's hash too
 * (App). The Project select sets the Project; the map sets the issue, and its panel reads
 * them.
 */
export const selection = $state<Route & { issue: string | null }>({
  project: null,
  view: "map",
  issue: null,
});
