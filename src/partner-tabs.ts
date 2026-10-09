/** The app's tabs a Partner runs in, one Partner each (ADR-0014); shared with the app, so nothing here reaches the disk. */
export const PARTNER_TABS = ["review", "idea"] as const;
export type PartnerTab = (typeof PARTNER_TABS)[number];

export function isPartnerTab(tab: string): tab is PartnerTab {
  return (PARTNER_TABS as readonly string[]).includes(tab);
}

/** What the glossary calls each tab's Partner. */
export const PARTNER_NAMES: Record<PartnerTab, string> = { review: "Review partner", idea: "Idea partner" };
