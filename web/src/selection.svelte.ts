import type { Route } from "./route";

/**
 * The Project whose tab shows, its view, the issue whose node is open on its
 * map (the panel, #253), and the issue whose answer's text box takes focus
 * once its panel shows it. The Project and view live in the URL's hash too
 * (App). The strip sets the Project and the issue, and the answering issue
 * for an Asking row; the tabs set the Project; the map and its panel read them.
 */
export const selection = $state<Route & { issue: string | null; answering: string | null }>({
  project: null,
  view: "map",
  issue: null,
  answering: null,
});
