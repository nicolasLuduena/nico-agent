import { type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

/**
 * A button that opens a box below it, as the Lead's controls and the
 * Research box do: opening moves focus to `focus` in the box; Escape, a click
 * elsewhere or focus leaving it closes it, and `close` does too, each but a
 * click elsewhere handing focus back to the button. Spread `wrapper` on the
 * element holding both, and pass `button` to the button's `ref`.
 */
export function usePopover<Focus extends HTMLElement>(focus: (box: HTMLDivElement) => Focus | null | undefined) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    if (box.current) focus(box.current)?.focus();
    return () => document.removeEventListener("pointerdown", away);
    // `focus` is read once per opening.
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const wrapper = {
    ref: box,
    onBlur: (e: FocusEvent) => {
      if (open && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "Escape" && open) close();
    },
  };
  return { open, toggle: () => setOpen(!open), close, wrapper, button };
}

/** Whether a key sends what was written: Enter, but not Shift+Enter (a new line) nor while an input method composes. */
export function sendsOnEnter(e: ReactKeyboardEvent): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}
