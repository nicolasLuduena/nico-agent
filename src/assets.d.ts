/** Markdown imported `with { type: "text" }`, embedded in the binary. */
declare module "*.md" {
  const text: string;
  export default text;
}
