/**
 * The Project whose tab shows, and the issue whose node is open on its map
 * (the panel, #253). The strip sets both; the tabs set the Project; the map
 * reads both.
 */
export const selection = $state<{ project: string | null; issue: string | null }>({ project: null, issue: null });
