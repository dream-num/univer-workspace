/**
 * The workspace brand palette applied as DSH theme-token overrides.
 *
 * The DeepSeek shell brands itself monochrome with a deepseek-blue accent.
 * Univer Workspace brands blue (`#2563eb` primary / `#3b82f6` brand-500 /
 * `#1d4ed8` brand-700). The skin overrides the brand and business-accent
 * alias tokens in both light and dark modes; static neutral and semantic
 * tokens stay untouched so layout and states keep the DSH design system.
 */

/** One CSS variable override. */
export interface TokenOverride {
  readonly token: string;
  readonly light: string;
  readonly dark: string;
}

/** The brand tokens the skin overrides in both modes. */
export const BRAND_TOKEN_OVERRIDES: readonly TokenOverride[] = [
  {
    token: "--dsw-alias-brand-primary",
    light: "#2563eb",
    dark: "#3b82f6",
  },
  {
    token: "--dsw-alias-brand-primary-invert",
    light: "#ffffff",
    dark: "#0f1115",
  },
  {
    token: "--dsw-alias-brand-text",
    light: "#2563eb",
    dark: "#3b82f6",
  },
  {
    token: "--dsw-alias-button-info-fill",
    light: "#2563eb",
    dark: "#3b82f6",
  },
  {
    token: "--dsw-alias-button-info-hover",
    light: "#1d4ed8",
    dark: "#2563eb",
  },
  {
    token: "--dsw-alias-state-business-primary",
    light: "#2563eb",
    dark: "#3b82f6",
  },
  {
    token: "--dsw-alias-state-business-tertiary",
    light: "#e0eaff",
    dark: "#1e40af",
  },
  {
    token: "--dsw-specific-sidebar-nav-item-active-accent",
    light: "#e0eaff",
    dark: "#1e40af",
  },
];

/** The full override stylesheet, injected after the theme base styles. */
export const SKIN_CSS = [
  `body{${BRAND_TOKEN_OVERRIDES.map(o => `${o.token}:${o.light}`).join(";")}}`,
  `body[data-ds-dark-theme]{${BRAND_TOKEN_OVERRIDES.map(o => `${o.token}:${o.dark}`).join(";")}}`,
].join("\n");
