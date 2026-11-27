const palette = {
  peach: '#FFD7AD',
  terracotta: '#A93420',
  clay: '#74594C',
  ink: '#38241D',
  paper: '#FFFFFF',
  linen: '#FFF6EB',
  espresso: '#291D1A',
  umber: '#3C2B25',
  cream: '#FFF2E3',
  apricot: '#EFA174',
} as const;

export const tokens = {
  palette,
  colors: {
    light: {
      background: palette.linen,
      surface: palette.paper,
      text: palette.ink,
      muted: palette.clay,
      primary: palette.peach,
      onPrimary: palette.ink,
      accent: palette.terracotta,
      onAccent: palette.paper,
      border: '#B6A195',
      success: '#35623F',
      warning: '#815008',
      danger: '#992633',
    },
    dark: {
      background: palette.espresso,
      surface: palette.umber,
      text: palette.cream,
      muted: '#D2B8A7',
      primary: palette.peach,
      onPrimary: palette.ink,
      accent: palette.apricot,
      onAccent: palette.espresso,
      border: '#867164',
      success: '#A1CF9C',
      warning: '#F0C078',
      danger: '#FFA499',
    },
  },
  radii: { sm: '0.25rem', md: '0.5rem', lg: '1rem', pill: '9999px' },
  space: { 0: '0', 1: '0.25rem', 2: '0.5rem', 3: '0.75rem', 4: '1rem', 6: '1.5rem', 8: '2rem', 12: '3rem', 16: '4rem' },
  fonts: { body: 'Manrope, sans-serif', heading: 'Manrope, sans-serif' },
  type: { caption: '0.75rem', small: '0.875rem', body: '1rem', lead: '1.25rem', heading: '2rem', display: '3rem' },
} as const;

export type DesignTokens = typeof tokens;
