const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe to put in HTML, in element content or a quoted attribute. */
export function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}
