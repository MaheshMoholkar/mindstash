/** One palette for the whole UI (Tokyo Night–like). Chalk downsamples on terminals without truecolor. */
export const theme = {
  accent: '#7aa2f7',
  accent2: '#bb9af7',
  fg: '#c0caf5',
  muted: '#9aa5ce',
  border: '#565f89',
  rule: '#3b4261',
  ok: '#9ece6a',
  warn: '#e0af68',
  error: '#f7768e',
  info: '#7dcfff',
  ink: '#1a1b26', // text on coloured pills
  hilite: '#283457',
  cursor: '#3d59a1', // focused cursor row
  cursorDim: '#2a3454', // cursor row when the list isn't focused
  picked: '#3b2f5c', // rows selected with Space / V
} as const;

export const CONFIDENCE = { high: theme.error, medium: theme.warn, low: theme.muted } as const;

export const CATEGORY_COLOR: Record<string, string> = {
  all: theme.fg,
  stale: theme.warn,
  scope: theme.info,
  similar: theme.accent2,
  contradiction: theme.error,
  relearned: theme.accent,
  index: theme.muted,
};

export const MODE_COLOR = {
  NORMAL: theme.accent,
  SEARCH: theme.warn,
  COMMAND: theme.accent2,
  CONFIRM: theme.error,
} as const;
