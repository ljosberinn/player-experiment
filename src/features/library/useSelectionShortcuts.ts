import { useEffect } from "react";
import { useEditorStore } from "../editor/store";
import { isTypingTarget } from "../player/shortcuts";
import { usePlaylistsStore } from "../playlists/store";
import { useLibraryStore } from "./store";

/**
 * Window-level selection keys.
 *
 * Separate from the player shortcuts because those deliberately ignore any key
 * pressed with a modifier - Ctrl+A is a modifier chord, so it could never have
 * reached them. `selectAll` existed in the store from the start and had no way
 * to be triggered until this.
 */
export function useSelectionShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+A in the search box means "select this text", which is a much
      // more useful thing for it to do while you are typing in one.
      if (isTypingTarget(event.target)) {
        return;
      }

      const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
      if (selectAll) {
        event.preventDefault();
        // Every id the query matches, not just the loaded pages: a selection
        // truncated at whatever happened to be scrolled into view would be a
        // trap for the bulk operations that follow it.
        void useLibraryStore.getState().selectAll();
        return;
      }

      // Edit's keyboard route. It used to be a toolbar button; that moved
      // to the row's right-click menu, and a menu is not a substitute for a
      // shortcut, so the shortcut had to exist before the button could go.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
        const ids = [...useLibraryStore.getState().selection.ids];
        if (ids.length > 0) {
          event.preventDefault();
          void useEditorStore.getState().open(ids);
        }
        return;
      }

      if (event.key === "Escape" && useLibraryStore.getState().selection.ids.size > 0) {
        event.preventDefault();
        useLibraryStore.getState().clearSelection();
        return;
      }

      // A focused row handles Delete itself, because it can act on the row
      // under the cursor even when that row is not part of the selection.
      // This is the case it cannot cover: Ctrl+A and a click on the sidebar
      // both leave focus off the table, and Delete has to keep working.
      if (event.key === "Delete" && !event.defaultPrevented) {
        const { playlistId, selection } = useLibraryStore.getState();
        if (playlistId === null || selection.ids.size === 0) {
          return;
        }
        const open = usePlaylistsStore.getState().playlists.find((one) => one.id === playlistId);
        // Smart playlists are a query, not a list - there is no membership to
        // remove a song from, and deleting the file is not what Delete means.
        if (open?.kind !== "static") {
          return;
        }
        event.preventDefault();
        void usePlaylistsStore.getState().removeTracks(playlistId, [...selection.ids]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
