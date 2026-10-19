/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#70B8FF',
    tint: '#ff3d3d',

    // Core surfaces
    background: '#070a12',
    foreground: '#70B8FF',

    // Cards / elevated surfaces
    card: '#10162b',
    cardForeground: '#70B8FF',

    // Primary action color (buttons, links, active states)
    primary: '#ff3d3d',
    primaryForeground: '#070a12',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#141b33',
    secondaryForeground: '#70B8FF',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#0b1020',
    mutedForeground: '#9aa3b8',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#ffb020',
    accentForeground: '#070a12',

    // Destructive actions (delete, error states)
    destructive: '#ff5c5c',
    destructiveForeground: '#070a12',

    // Borders and input outlines
    border: '#1e2745',
    input: '#1e2745',
  },

  auth: {
    background: '#090a0f',
    backgroundSoft: '#0d1118',
    panel: '#111720',
    panelRaised: '#171e28',
    border: '#343e49',
    borderSoft: '#252d37',
    highlight: '#59636e',
    fire: '#ff2e00',
    orange: '#ff7b00',
    gold: '#e4b557',
    text: '#f5f7fa',
    muted: '#9ca6b2',
    placeholder: '#7f8a97',
    danger: '#ff655a',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 14,
};

export default colors;
