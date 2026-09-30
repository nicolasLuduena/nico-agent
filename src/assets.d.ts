/** htmx, embedded as text so the compiled binary serves it offline. */
declare module "htmx.org/dist/htmx.min.js" {
  const source: string;
  export default source;
}
