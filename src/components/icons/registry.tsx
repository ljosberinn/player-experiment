import { ChartBarIcon } from "@phosphor-icons/react/ChartBar";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { MusicNotesIcon } from "@phosphor-icons/react/MusicNotes";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { PlayIcon } from "@phosphor-icons/react/Play";
import { PlaylistIcon } from "@phosphor-icons/react/Playlist";
import { SkipBackIcon } from "@phosphor-icons/react/SkipBack";
import { SkipForwardIcon } from "@phosphor-icons/react/SkipForward";
import { SpeakerSimpleHighIcon } from "@phosphor-icons/react/SpeakerSimpleHigh";
import { SpeakerSimpleSlashIcon } from "@phosphor-icons/react/SpeakerSimpleSlash";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { UserSoundIcon } from "@phosphor-icons/react/UserSound";
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
  | "volume"
  | "volume-muted"
  | "playlist"
  | "smart-playlist"
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "statistics";

/**
 * Filled for the transport, outlined everywhere else.
 *
 * The transport glyphs were solid CSS shapes and the design draws them solid;
 * an outlined play triangle inside a 44px accent circle reads as a hole in it.
 * The rest of the app's icons were strokes and stay strokes.
 */
export const ICONS: Record<IconName, Glyph> = {
  previous: (props) => <SkipBackIcon weight="fill" {...props} />,
  play: (props) => <PlayIcon weight="fill" {...props} />,
  pause: (props) => <PauseIcon weight="fill" {...props} />,
  next: (props) => <SkipForwardIcon weight="fill" {...props} />,
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
  statistics: (props) => <ChartBarIcon {...props} />,
};
