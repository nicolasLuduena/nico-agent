import { encode } from "@toon-format/toon";

/** A command's result: data plus next-step hints, rendered at the boundary. */
export interface Output {
  data: Record<string, unknown>;
  help?: string[];
  /** 1 when the command produced its output but failed its purpose. */
  exitCode?: 0 | 1;
}

export function render(output: Output, json: boolean): string {
  const help = output.help ?? [];
  if (json) {
    const body = help.length ? { ...output.data, help } : output.data;
    return `${JSON.stringify(body, null, 2)}\n`;
  }
  let text = Object.keys(output.data).length ? `${encode(output.data)}\n` : "";
  if (help.length) text += `help[${help.length}]:\n${help.map((h) => `  ${h}\n`).join("")}`;
  return text;
}
