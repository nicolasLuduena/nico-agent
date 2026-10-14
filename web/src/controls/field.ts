/** A field's value as set, and how to save another, given the field to put back should serve refuse it. */
export interface Entry {
  set: string;
  save: (value: string, input: HTMLInputElement) => Promise<unknown>;
}

/**
 * A text or number field written as it is entered: Enter, or leaving it,
 * saves what it holds unless that is what is set; Escape puts back what is
 * set. Enter submits no form around it.
 */
export function entered(input: HTMLInputElement, entry: Entry) {
  let { set, save } = entry;
  /** The value being saved, so leaving the field after Enter does not save it again. */
  let saving: string | null = null;

  async function commit() {
    const value = input.value;
    if (value === set || value === saving) return;
    saving = value;
    try {
      await save(value, input);
    } finally {
      saving = null;
    }
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape" && input.value !== set) {
      // Taken here: the next Escape is for what is around it, a sheet to close.
      event.preventDefault();
      event.stopPropagation();
      input.value = set;
    }
  }
  const leave = () => void commit();

  input.addEventListener("keydown", key);
  input.addEventListener("blur", leave);
  return {
    update(next: Entry) {
      ({ set, save } = next);
    },
    destroy() {
      input.removeEventListener("keydown", key);
      input.removeEventListener("blur", leave);
    },
  };
}

/** A whole-number field's value as sent: an empty or partial number is sent as "", which serve refuses, as null would take the default. */
export const whole = (value: string) => (value.trim() === "" || Number.isNaN(Number(value)) ? "" : Number(value));
