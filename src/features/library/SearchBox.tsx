import { useEffect, useRef } from "react";
import { usePlaylistsStore } from "../playlists/store";
import { useLibraryStore } from "./store";

/**
 * The toolbar's search field, subscribed to its own text.
 *
 * Same reason as `NowPlayingStatus`: `searchInput` changes on every keystroke,
 * and reading it at the top of `App` meant every keystroke re-rendered the song
 * table underneath it. The committed `search` - the one the query actually runs
 * on - is debounced and still lives in the store, so the table updates when the
 * results do rather than when a key goes down.
 */
export function SearchBox() {
  const searchInput = useLibraryStore((s) => s.searchInput);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const commitSearch = useLibraryStore((s) => s.commitSearch);
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const field = useRef<HTMLInputElement>(null);

  // Ctrl+F. Claimed from inside a text field too, where it means nothing, and
  // under a dialog, where it does nothing: WebView2 opens its own find bar on
  // any Ctrl+F the page leaves alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }
      event.preventDefault();
      // Every dialog is the `Dialog` primitive, which is only in the DOM while
      // open. Focus pulled out from under a modal leaves it up and unreachable.
      if (document.querySelector(".dialog") !== null) {
        return;
      }
      field.current?.focus();
      field.current?.select();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The search is scoped to the current view, so it says which one.
  const currentPlaylistName =
    playlists.find((playlist) => playlist.id === playlistId)?.name ?? "This playlist";
  const scope = playlistId === null ? "Search Library" : `Search ${currentPlaylistName}`;

  return (
    <div className="search-box">
      <input
        ref={field}
        className="search"
        type="search"
        placeholder={scope}
        aria-label={scope}
        value={searchInput}
        onChange={(event) => setSearch(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter runs the pending search rather than waiting out the
          // debounce; Escape clears, the way every search field does.
          if (event.key === "Enter") {
            event.preventDefault();
            void commitSearch();
          } else if (event.key === "Escape") {
            event.preventDefault();
            void clearSearch();
          }
        }}
      />
      {searchInput === "" ? null : (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => void clearSearch()}
        >
          ✕
        </button>
      )}
    </div>
  );
}
