const tokyoNight = {
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
  cursorFg: '#ffffff',
  cursorInfo: '#e0e6ff',
  deleteFg: '#ff8080',
  paletteCursor: '#292e42',
};

const light = {
  accent: '#194b9f', accent2: '#672a90', fg: '#202536', muted: '#525e78',
  border: '#6c7893', rule: '#818da5', ok: '#275b26', warn: '#764400', error: '#9e1d39',
  info: '#145573', ink: '#ffffff', hilite: '#dce6f8', cursor: '#c1d4f7', cursorDim: '#e0e9f9',
  picked: '#eadcf5', cursorFg: '#182844', cursorInfo: '#23426c', deleteFg: '#b3132d', paletteCursor: '#dce6f8',
};

const presets = {
  'tokyo-night': tokyoNight,
  light,
  catppuccin: {
    ...tokyoNight,
    accent: '#89b4fa', accent2: '#cba6f7', fg: '#cdd6f4', muted: '#a6adc8',
    border: '#6c7086', rule: '#45475a', ok: '#a6e3a1', warn: '#f9e2af', error: '#f38ba8',
    info: '#89dceb', ink: '#1e1e2e', hilite: '#313244', cursor: '#45475a', cursorDim: '#313244',
    picked: '#493d58', cursorInfo: '#b4befe', paletteCursor: '#313244',
  },
  gruvbox: {
    ...tokyoNight,
    accent: '#83a598', accent2: '#d3869b', fg: '#ebdbb2', muted: '#bdae93',
    border: '#928374', rule: '#665c54', ok: '#b8bb26', warn: '#fabd2f', error: '#fb4934',
    info: '#8ec07c', ink: '#282828', hilite: '#3c3836', cursor: '#504945', cursorDim: '#3c3836',
    picked: '#593b45', cursorFg: '#fbf1c7', cursorInfo: '#ebdbb2', paletteCursor: '#3c3836',
  },
  'high-contrast': {
    ...tokyoNight,
    accent: '#93d8ff', accent2: '#ffc3ff', fg: '#ffffff', muted: '#d3d8e2',
    border: '#aab4c7', rule: '#8490aa', ok: '#aaffad', warn: '#ffe18a', error: '#ffa0a9',
    info: '#b1f2ff', ink: '#000000', hilite: '#24354e', cursor: '#304966', cursorDim: '#202f45',
    picked: '#4a305c', cursorInfo: '#ffffff', paletteCursor: '#24354e',
  },
};

export const theme = { ...tokyoNight };

function lightBackground(value = ''): boolean {
  const bg = value.split(';').at(-1)?.trim() ?? '';
  if (!/^\d+$/.test(bg)) return false;
  const color = Number(bg);
  if (color < 16) return color === 7 || color >= 10;
  if (color >= 232) return color >= 245 && color <= 255;
  const levels = [0, 95, 135, 175, 215, 255];
  const cube = color - 16;
  const r = levels[Math.floor(cube / 36)]!;
  const g = levels[Math.floor(cube / 6) % 6]!;
  const b = levels[cube % 6]!;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 165;
}

export function setTheme(preset = 'auto', env = process.env): void {
  const auto = lightBackground(env.COLORFGBG) ? light : tokyoNight;
  const palette = Object.hasOwn(presets, preset) ? presets[preset as keyof typeof presets] : auto;
  for (const key of Object.keys(theme) as (keyof typeof theme)[]) {
    theme[key] = env.NO_COLOR ? '' : palette[key];
  }
}

export const CATEGORY_COLOR: Record<string, string> = {
  get stale() { return theme.warn; },
  get scope() { return theme.info; },
  get similar() { return theme.accent2; },
  get contradiction() { return theme.error; },
  get relearned() { return theme.accent; },
  get index() { return theme.muted; },
};

export const MODE_COLOR = {
  get NORMAL() { return theme.accent; },
  get SEARCH() { return theme.warn; },
  get COMMAND() { return theme.accent2; },
  get CONFIRM() { return theme.error; },
  get TOUR() { return theme.accent2; },
} as const;
