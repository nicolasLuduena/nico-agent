/** Markdown imported `with { type: "text" }`, embedded in the binary. */
declare module "*.md" {
  const text: string;
  export default text;
}

/** A WAV imported `with { type: "file" }`: its path, embedded in the binary. */
declare module "*.wav" {
  const path: string;
  export default path;
}
