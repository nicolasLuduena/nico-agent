import { describe, expect, it } from "vitest";
import { entered } from "./field";

/** A text field as the page has it: what it holds, and the keys and focus it gets. */
function field(value: string) {
  const input = Object.assign(new EventTarget(), { value });
  const press = (key: string) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key });
    input.dispatchEvent(event);
    return event;
  };
  const leave = () => input.dispatchEvent(new Event("blur"));
  return { input, press, leave };
}

/** Set `set`, the field's saves recorded in `saved`. */
function enteredIn(f: ReturnType<typeof field>, set: string) {
  const saved: string[] = [];
  const action = entered(f.input as unknown as HTMLInputElement, { set, save: async (value) => void saved.push(value) });
  return { saved, action };
}

describe("a text field that saves as it is entered", () => {
  it("saves what is typed on Enter, without submitting a form around it", () => {
    const f = field("main");
    const { saved } = enteredIn(f, "main");

    f.input.value = "dev";
    const enter = f.press("Enter");

    expect(saved).toEqual(["dev"]);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("saves what is typed on leaving it", () => {
    const f = field("main");
    const { saved } = enteredIn(f, "main");

    f.input.value = "dev";
    f.leave();

    expect(saved).toEqual(["dev"]);
  });

  it("saves once on Enter then leaving it before serve answers", () => {
    const f = field("main");
    const { saved } = enteredIn(f, "main");

    f.input.value = "dev";
    f.press("Enter");
    f.leave();

    expect(saved).toEqual(["dev"]);
  });

  it("saves nothing while it holds what is set", () => {
    const f = field("main");
    const { saved } = enteredIn(f, "main");

    f.press("Enter");
    f.leave();

    expect(saved).toEqual([]);
  });

  it("puts back what is set on Escape, saving nothing after", () => {
    const f = field("main");
    const { saved } = enteredIn(f, "main");

    f.input.value = "dev";
    const escape = f.press("Escape");
    f.leave();

    expect(f.input.value).toBe("main");
    expect(escape.defaultPrevented).toBe(true);
    expect(saved).toEqual([]);
  });

  it("leaves Escape to what is around it while it holds what is set", () => {
    const f = field("main");
    enteredIn(f, "main");

    expect(f.press("Escape").defaultPrevented).toBe(false);
  });

  it("compares with what is set now, once serve answered", () => {
    const f = field("main");
    const { saved, action } = enteredIn(f, "main");

    f.input.value = "dev";
    f.press("Enter");
    action.update({ set: "dev", save: async (value) => void saved.push(value) });
    f.input.value = "main";
    f.press("Escape");

    expect(f.input.value).toBe("dev");
  });
});
