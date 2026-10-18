// shadcn-svelte's helpers, which its components in `components/ui/` import as `$lib/utils.js`.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** The classes given, a later Tailwind class winning over an earlier one of its kind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
