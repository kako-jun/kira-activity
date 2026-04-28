/**
 * Palette tokens for the visual direction defined in docs/visual-direction.md.
 *
 * Each theme defines five tokens:
 *   - background: outermost surface (canvas / page background)
 *   - ink:        text and primary line color
 *   - grid:       axis / grid / scaffolding lines
 *   - accent:     main data color (lines, bars, primary dots)
 *   - highlight:  emphasis color (peaks, alerts, secondary dots)
 *
 * Source-aware accent (Phase 1 scope): only `theme=film` reacts to `source`.
 * The other themes already encode a strong visual identity, so we keep their
 * accent fixed to avoid muddying that identity. This matches the acceptance
 * criterion "Keep film-like base colors even when accents change" — the rule
 * applies to the film theme, where the cream + ink base must stay constant
 * while accents shift between github-green and hatena-blue tones.
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

const THEMES = Object.freeze({
  // Cream + dark gray-brown ink. The "investigation document" mood from the
  // live-action Death Note analysis screen.
  film: Object.freeze({
    background: '#e8e2d4',
    ink: '#3a322a',
    grid: '#bfb6a3',
    accent: '#7a5c3a',
    highlight: '#c14a3a'
  }),
  // GitHub dark contribution-graph palette.
  github: Object.freeze({
    background: '#0d1117',
    ink: '#c9d1d9',
    grid: '#30363d',
    accent: '#39d353',
    highlight: '#7ee787'
  }),
  // Hatena Bookmark inspired light blue palette.
  hatena: Object.freeze({
    background: '#f4f6f8',
    ink: '#1f2937',
    grid: '#cbd5e1',
    accent: '#2c7eb8',
    highlight: '#5eb1e0'
  }),
  // Warm sepia paper.
  sepia: Object.freeze({
    background: '#f3ead4',
    ink: '#3a2a18',
    grid: '#c8b890',
    accent: '#8a5a2a',
    highlight: '#d09c5a'
  }),
  // Neutral mono — a calm fallback with no chroma.
  mono: Object.freeze({
    background: '#f5f5f5',
    ink: '#222222',
    grid: '#bcbcbc',
    accent: '#000000',
    highlight: '#666666'
  })
});

/**
 * Source-aware accent overrides for the film theme. Tuned to read as
 * "film palette + a hint of github/hatena" rather than the source's own
 * brand color. The base (background, ink, grid, highlight) stays film.
 *
 * Film theme の中で source を表現する accent。pure な theme=github / theme=hatena
 * よりトーンを落とし、film のクリーム+灰茶の base に馴染むよう調整している。
 * 「film の中の github 寄り」と「pure github」は意図的に別色。
 */
const FILM_ACCENT_BY_SOURCE = Object.freeze({
  github: '#3a7d44', // muted green that lives next to film's brown
  hatena: '#3a6ea5'  // muted blue that lives next to film's brown
});

/**
 * Resolve the palette for a given (theme, source) pair.
 *
 * @param {string} theme  — one of VALID_THEMES; falls back to 'film'
 * @param {string} [source] — 'github' or 'hatena'; only consulted when theme=film
 * @returns {{background:string, ink:string, grid:string, accent:string, highlight:string}}
 */
export function getPalette(theme, source) {
  // Defend against prototype keys like __proto__ / constructor / toString.
  // Server already whitelists via VALID_THEMES, but this module is exported
  // and could be called directly with attacker-controlled input.
  const base = Object.prototype.hasOwnProperty.call(THEMES, theme)
    ? THEMES[theme]
    : THEMES.film;
  let accent = base.accent;
  if (theme === 'film' && source && FILM_ACCENT_BY_SOURCE[source]) {
    accent = FILM_ACCENT_BY_SOURCE[source];
  }
  // Return a plain (mutable) copy so callers cannot accidentally freeze the
  // module-level constants by passing this through some downstream API.
  return {
    background: base.background,
    ink: base.ink,
    grid: base.grid,
    accent,
    highlight: base.highlight
  };
}

/**
 * Verify that a palette only contains six-digit hex colors. Used as an
 * extra defense before injecting values directly into a CSS context.
 * Returns the input unchanged if all values are safe; otherwise replaces
 * the offending entry with '#000000'.
 */
export function sanitizePalette(palette) {
  const out = {};
  for (const key of Object.keys(THEMES.film)) {
    const v = palette[key];
    out[key] = typeof v === 'string' && HEX6.test(v) ? v : '#000000';
  }
  return out;
}

export const VALID_THEMES = Object.freeze(Object.keys(THEMES));
