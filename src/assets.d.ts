/** htmx, embedded as text so the compiled binary serves it offline. */
declare module "htmx.org/dist/htmx.min.js" {
  const source: string;
  export default source;
}

/** Markdown imported `with { type: "text" }`, embedded in the binary. */
declare module "*.md" {
  const text: string;
  export default text;
}
