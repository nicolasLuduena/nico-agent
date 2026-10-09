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

/** An ONNX model imported `with { type: "file" }`: its path, embedded in the binary. */
declare module "*.onnx" {
  const path: string;
  export default path;
}

/** WebAssembly imported `with { type: "file" }`: its path, embedded in the binary. */
declare module "*.wasm" {
  const path: string;
  export default path;
}
