import type { Route } from "./route";

/**
 * The Project that shows, its view, the issue whose node is open on its map
 * (the panel, #253), and the agent of it whose panel is open instead (#435).
 * All live in the URL's hash too (App). The Project select sets the Project;
 * the map sets the issue and agent, and the panels read them.
 */
export const selection = $state<Route>({
  project: null,
  view: "map",
  issue: null,
  agent: null,
});
