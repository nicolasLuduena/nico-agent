export type ToolUIPartState = "input-available" | "output-available" | "output-error";

export const STATUS: Record<ToolUIPartState, string> = {
  "input-available": "Running",
  "output-available": "Completed",
  "output-error": "Error",
};
