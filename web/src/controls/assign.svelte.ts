import type { Assignee } from "../status";
import type { Action } from "./press.svelte";
import { send } from "./send";

/** Who an issue is assigned to, as its panel lists them: the user as "you"; no one, "Unassigned". */
export const named = (assignees: Assignee[]) => (assignees.length ? assignees.map((a) => (a.you ? "you" : a.name)) : ["Unassigned"]);

/**
 * Whether an issue offers "Assign to me": no one has it, and it is not yet dispatched.
 * Never one someone else has: Linear's assign would take it from them.
 */
export const assignable = (assignees: Assignee[] | null, dispatched: boolean) => !dispatched && assignees?.length === 0;

/** Whether a refused Dispatch's help says to take the issue: one no one has, in a Repo with `mine` on. */
export const asksToAssign = (help: string[]) => help.some((line) => line.startsWith("Assign it to yourself, or turn `mine` off"));

/** "Assign to me": serve assigns the issue to the user on its Source. */
export const assignMe: Action = { write: (issue) => send("POST", "/api/assign", { issue }), idle: "Assign to me", running: "Assigning…" };
