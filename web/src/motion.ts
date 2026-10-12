/** DESIGN.md: under prefers-reduced-motion all motion is off, and changes simply appear. */
export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** DESIGN.md's flash: `el` lights once in its own ink, like a board updating a single line. */
export function flash(el: Element) {
  if (still()) return;
  el.animate(
    { backgroundColor: ["color-mix(in srgb, currentColor 18%, transparent)", "transparent"] },
    { duration: 200, easing: "ease-out" },
  );
}
