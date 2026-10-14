/**
 * Design tokens for HighWater Dashboard
 * All colours, typography, spacing, and risk mappings live here.
 * As per rules.md: No hex codes outside theme.js and index.css.
 */

export const THEME = {
  colors: {
    'navy-900': '#0B1F33',
    'navy-700': '#16344F',
    surface: '#F4F6F8',
    card: '#FFFFFF',
    border: '#D5DBE1',
    text: '#1B2733',
    'text-muted': '#5B6B7B',
    flood: '#2B8CC4',
    floodBorder: '#1A6896',
    shelter: '#0284C7',
    'risk-high': '#C62828',
    'risk-medium': '#E69F00',
    'risk-low': '#2E7D32',
    'risk-unknown': '#6B7280',
    route: '#6A1B9A',
    selected: '#0B1F33',
    buildingFlooded: '#B45309', // WCAG AA compliant (5.02:1 with white text)
    buildingFloodedBorder: '#92400E',
    demo: {
      text: '#965300', // WCAG AA compliant (5.39:1 on #FFF3D6)
      specText: '#B26A00', // Base design token from design.md
      bg: '#FFF3D6',
    },
  },
  typography: {
    fontFamily: {
      sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
    },
    fontSize: {
      title: '18px',
      heading: '16px',
      stat: '28px',
      body: '14px',
      caption: '12px',
    },
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    6: '24px',
    8: '32px',
  },
  borderRadius: {
    card: '8px',
    badge: '999px',
  },
  riskColors: {
    HIGH: '#C62828',
    MEDIUM: '#E69F00',
    LOW: '#2E7D32',
    UNKNOWN: '#6B7280',
  },
};

export const colors = THEME.colors;
export const riskColors = THEME.riskColors;
export default THEME;
