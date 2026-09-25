import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { FireIcon } from "@phosphor-icons/react/Fire";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { HeartIcon } from "@phosphor-icons/react/Heart";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { PlayIcon } from "@phosphor-icons/react/Play";
import { PlaylistIcon } from "@phosphor-icons/react/Playlist";
import { RepeatOnceIcon } from "@phosphor-icons/react/RepeatOnce";
import { SkipBackIcon } from "@phosphor-icons/react/SkipBack";
import { SkipForwardIcon } from "@phosphor-icons/react/SkipForward";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/SpeakerSimpleHigh";
import { SpeakerSimpleSlashIcon } from "@phosphor-icons/react/SpeakerSimpleSlash";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { UserSoundIcon } from "@phosphor-icons/react/UserSound";
import { XIcon } from "@phosphor-icons/react/X";
import type { ComponentType } from "react";

/**
 * The one file that knows which icon library is installed.
 *
 * Everything else asks for an icon by what it means - `"play"`, `"genres"` -
 * through `<Icon>`, so swapping Phosphor for another family is this file and
 * nothing else. `GlyphProps` is deliberately the intersection every candidate
 * supports (a size, a class, and whatever passes through to the `<svg>`):
 * anything library-specific, such as Phosphor's `weight`, is bound here rather
 * than named at a call site that would then have to change with the library.
 *
 * Imported per icon (`@phosphor-icons/react/Play`) rather than from the package
 * root: the root barrel is nine thousand modules, which the dev server compiles
 * on first import and the bundler then has to shake back out.
 */
export interface GlyphProps {
  size: number;
  className?: string;
  "aria-hidden": "true";
}

export type Glyph = ComponentType<GlyphProps>;

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
  previous: (props) => <SkipBackIcon weight="fill" {...props} />,
  play: (props) => <PlayIcon weight="fill" {...props} />,
  pause: (props) => <PauseIcon weight="fill" {...props} />,
  next: (props) => <SkipForwardIcon weight="fill" {...props} />,
  // Regular, not filled: it is a loop of strokes, and the numeral inside it
  // closes up at heavier weights.
  "repeat-one": (props) => <RepeatOnceIcon {...props} />,
  love: (props) => <HeartIcon {...props} />,
  loved: (props) => <HeartIcon weight="fill" {...props} />,
  volume: (props) => <SpeakerSimpleHighIcon weight="fill" {...props} />,
  // Carries the slash itself, which the drawn version needed a pseudo-element
  // for. The grey is still the button's, so both signals survive the swap.
  "volume-muted": (props) => <SpeakerSimpleSlashIcon weight="fill" {...props} />,
  playlist: (props) => <PlaylistIcon {...props} />,
  "smart-playlist": (props) => <GearSixIcon {...props} />,
  songs: (props) => <MusicNotesIcon {...props} />,
  albums: (props) => <SquaresFourIcon {...props} />,
  artists: (props) => <UserSoundIcon {...props} />,
  genres: (props) => <TagIcon {...props} />,
  stats: (props) => <ChartBarIcon {...props} />,
  favorites: (props) => <HeartIcon {...props} />,
  "most-played": (props) => <FireIcon {...props} />,
  "recently-added": (props) => <ClockIcon {...props} />,
  review: (props) => <ListChecksIcon {...props} />,
  // Bold, and the one pair here that needs saying: they are drawn at 10px
  // inside a 22px nudge button, where a regular-weight caret is a smudge.
  "move-up": (props) => <CaretUpIcon weight="bold" {...props} />,
  "move-down": (props) => <CaretDownIcon weight="bold" {...props} />,
  // The same caret at regular weight, and a separate name because it means
  // something else: `move-down` moves a row, this one says a list will drop.
  // A select that wore the nudge button's bold caret would read as an action.
  expand: (props) => <CaretDownIcon {...props} />,
  search: (props) => <MagnifyingGlassIcon {...props} />,
  // Bold, like the nudge carets and for the same reason: it is drawn at
  // 12px inside a rule row, where a regular-weight cross is a smudge.
  remove: (props) => <XIcon weight="bold" {...props} />,
};
