/** A request the user can fix; `usage` marks a malformed one (CLI exit 2). */
export class DispatchError extends Error {
  constructor(
    message: string,
    readonly help: string[],
    readonly usage = false,
  ) {
    super(message);
  }
}

/** A launch choice that is not valid, naming the request key at fault. */
export class LaunchError extends DispatchError {
  constructor(readonly key: "harness" | "model" | "effort", message: string, help: string[], usage = false) {
    super(message, help, usage);
  }
}
