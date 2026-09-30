/** The Settings page's tabs, in display order. */
export const SETTINGS_TABS = ["general", "monitoring", "connections", "advanced"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
