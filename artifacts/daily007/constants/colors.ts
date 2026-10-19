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
    text: '#F4F7FF',
    tint: '#3388FF',

    // Core surfaces
    background: '#070A18',
    foreground: '#F4F7FF',

    // Cards / elevated surfaces
    card: '#0D1631',
    cardForeground: '#F4F7FF',

    // Primary action color (buttons, links, active states)
    primary: '#3388FF',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#142043',
    secondaryForeground: '#E4EAFF',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#0B1230',
    mutedForeground: '#AAB6D5',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#FFD34F',
    accentForeground: '#10152B',

    // Destructive actions (delete, error states)
    destructive: '#FF7187',
    destructiveForeground: '#10152B',

    // Borders and input outlines
    border: '#263765',
    input: '#263765',
  },

  auth: {
    background: '#070A18',
    backgroundSoft: '#0B1230',
    panel: '#0D1631',
    panelRaised: '#121D3D',
    border: '#2A3A70',
    borderSoft: '#202E58',
    highlight: '#617BC5',
    fire: '#2587FF',
    orange: '#935DFF',
    gold: '#FFD34F',
    text: '#f5f7fa',
    muted: '#AAB6D5',
    placeholder: '#7E8DB7',
    danger: '#FF7187',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 14,
};

export default colors;
