/**
 * The Repo whose tab shows, and the issue whose node is open on its map (the
 * panel, #253). The strip sets both; the tabs set the Repo; the map reads both.
 */
export const selection = $state<{ repo: string | null; issue: string | null }>({ repo: null, issue: null });
