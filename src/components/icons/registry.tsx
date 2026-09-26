import type { ComponentType } from "react";
import * as phosphor from "./phosphor/paths";

/**
 * The one file that knows what the icons look like.
 *
 * Everything else asks for an icon by what it means - `"play"`, `"genres"` -
 * through `<Icon>`, so swapping the artwork for another family is this file
 * and the path data it reads, and nothing else. `GlyphProps` is deliberately
 * the least a family needs (a size, a class, and whatever passes through to
 * the `<svg>`): anything family-specific, such as Phosphor's weights, is bound
 * here rather than named at a call site that would then have to change with it.
 *
 * Phosphor's paths rather than `@phosphor-icons/react`: each of its modules
 * carries all six weights of an icon, and the app draws one or two.
 */
export interface GlyphProps {
  size: number;
  className?: string;
  "aria-hidden": "true";
}

export type Glyph = ComponentType<GlyphProps>;

/** One path on Phosphor's grid, in the `<svg>` its package drew around it. */
function glyph(d: string): Glyph {
  return ({ size, className }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 256 256"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export type IconName =
  | "previous"
  | "play"
  | "pause"
  | "next"
  | "repeat-one"
  | "love"
  | "loved"
  | "volume"
  | "volume-muted"
  | "playlist"
  | "smart-playlist"
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "stats"
  | "favorites"
  | "most-played"
  | "recently-added"
  | "review"
  | "move-up"
  | "move-down"
  | "expand"
  | "search"
  | "remove";

/**
 * Filled for the transport, outlined everywhere else.
 *
 * The transport glyphs were solid CSS shapes and the design draws them solid;
 * an outlined play triangle inside a 48px accent circle reads as a hole in it.
 * The rest of the app's icons were strokes and stay strokes.
 */
export const ICONS: Record<IconName, Glyph> = {
  previous: glyph(phosphor.SKIP_BACK_FILL),
  play: glyph(phosphor.PLAY_FILL),
  pause: glyph(phosphor.PAUSE_FILL),
  next: glyph(phosphor.SKIP_FORWARD_FILL),
  // Regular, not filled: it is a loop of strokes, and the numeral inside it
  // closes up at heavier weights.
  "repeat-one": glyph(phosphor.REPEAT_ONCE),
  love: glyph(phosphor.HEART),
  loved: glyph(phosphor.HEART_FILL),
  volume: glyph(phosphor.SPEAKER_SIMPLE_HIGH_FILL),
  // Carries the slash itself, which the drawn version needed a pseudo-element
  // for. The grey is still the button's, so both signals survive the swap.
  "volume-muted": glyph(phosphor.SPEAKER_SIMPLE_SLASH_FILL),
  playlist: glyph(phosphor.PLAYLIST),
  "smart-playlist": glyph(phosphor.GEAR_SIX),
  songs: glyph(phosphor.MUSIC_NOTES),
  albums: glyph(phosphor.SQUARES_FOUR),
  artists: glyph(phosphor.USER_SOUND),
  genres: glyph(phosphor.TAG),
  stats: glyph(phosphor.CHART_BAR),
  favorites: glyph(phosphor.HEART),
  "most-played": glyph(phosphor.FIRE),
  "recently-added": glyph(phosphor.CLOCK),
  review: glyph(phosphor.LIST_CHECKS),
  // Bold, and the one pair here that needs saying: they are drawn at 10px
  // inside a 22px nudge button, where a regular-weight caret is a smudge.
  "move-up": glyph(phosphor.CARET_UP_BOLD),
  "move-down": glyph(phosphor.CARET_DOWN_BOLD),
  // The same caret at regular weight, and a separate name because it means
  // something else: `move-down` moves a row, this one says a list will drop.
  // A select that wore the nudge button's bold caret would read as an action.
  expand: glyph(phosphor.CARET_DOWN),
  search: glyph(phosphor.MAGNIFYING_GLASS),
  // Bold, like the nudge carets and for the same reason: it is drawn at
  // 12px inside a rule row, where a regular-weight cross is a smudge.
  remove: glyph(phosphor.X_BOLD),
};
