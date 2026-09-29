import { useEffect, useRef, useState } from "react";
import type { PaletteGroup } from "../../components/ui/CommandPalette";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { SUGGEST_DEBOUNCE_MS } from "../../components/ui/TagCombobox";
import {
  type BrowseGroup,
  type BrowseKind,
  type PaletteResults,
  paletteSearch,
  type Track,
} from "../../ipc";
import { fileNameOf } from "../../lib/format";
import { groupSubtitle } from "../library/browse";

/** One letter matches most of a library, and says nothing about which part. */
export const PALETTE_SEARCH_MIN = 2;
export const PALETTE_SEARCH_LIMIT = 5;

/**
 * What the library holds for what has been typed into the palette.
 *
 * Debounced and late-answer-guarded for the reasons `useGenreSuggestions` is.
 * The last answer stays up while the next is coming, so the list does not
 * blink empty between keystrokes. `searching` is true until the answer for
 * this `query` is in.
 */
export function usePaletteSearch(query: string): {
  found: PaletteResults | null;
  searching: boolean;
} {
  const [answer, setAnswer] = useState<{ query: string; found: PaletteResults | null }>({
    query: "",
    found: null,
  });
  const latest = useRef(0);
  const trimmed = query.trim();
  const wanted = trimmed.length >= PALETTE_SEARCH_MIN ? trimmed : null;

  useEffect(() => {
    const token = latest.current + 1;
    latest.current = token;
    if (wanted === null) {
      return;
    }

    const timer = setTimeout(() => {
      void paletteSearch(wanted, PALETTE_SEARCH_LIMIT)
        .then((found) => {
          if (latest.current === token) {
            setAnswer({ query: wanted, found });
          }
        })
        .catch(() => {
          // Finding no music is not an error the palette reports: its
          // commands are still there.
          if (latest.current === token) {
            setAnswer({ query: wanted, found: null });
          }
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [wanted]);

  return {
    found: wanted === null ? null : answer.found,
    searching: wanted !== null && answer.query !== wanted,
  };
}

/** The palette's Artists, Releases and Songs, for what a search found. */
export function foundGroups(
  found: PaletteResults,
  {
    onShowGroup,
    onPlay,
  }: {
    onShowGroup: (kind: BrowseKind, group: BrowseGroup) => void;
    onPlay: (track: Track) => void;
  },
): PaletteGroup[] {
  // The backend leaves untagged groups out, so a key is always there.
  const group =
    (kind: BrowseKind, prefix: string) =>
    (hit: BrowseGroup): MenuItem => ({
      id: `${prefix}:${hit.id ?? ""}`,
      label: hit.key ?? "",
      hint: groupSubtitle(hit, kind) ?? undefined,
      onSelect: () => onShowGroup(kind, hit),
    });

  return [
    { group: "Artists", found: true, items: found.artists.map(group("artists", "artist")) },
    { group: "Releases", found: true, items: found.releases.map(group("albums", "release")) },
    {
      group: "Songs",
      found: true,
      items: found.tracks.map(
        (track): MenuItem => ({
          id: `track:${track.id}`,
          label: track.title ?? fileNameOf(track.path),
          hint: track.artist ?? undefined,
          onSelect: () => onPlay(track),
        }),
      ),
    },
  ];
}
