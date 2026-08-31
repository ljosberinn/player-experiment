import { useEffect } from "react";
import { useEditorStore } from "../editor/store";
import { isTypingTarget } from "../player/shortcuts";
import { usePlaylistsStore } from "../playlists/store";
import { useLibraryStore } from "./store";

/** Ctrl or Cmd plus a letter, whichever case the layout reports it in. */
function chord(event: KeyboardEvent, letter: string): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === letter;
}

function selectEverything(event: KeyboardEvent): boolean {
  if (!chord(event, "a")) {
    return false;
  }
  event.preventDefault();
  // Every id the query matches, not just the loaded pages: a selection
  // truncated at whatever happened to be scrolled into view would be a trap
  // for the bulk operations that follow it.
  void useLibraryStore.getState().selectAll();
  return true;
}

/**
 * Get Info's keyboard route.
 *
 * It used to be a toolbar button; that moved to the row's right-click menu,
 * and a menu is not a substitute for a shortcut, so the shortcut had to exist
 * before the button could go.
 */
function openTagEditor(event: KeyboardEvent): boolean {
  if (!chord(event, "i")) {
    return false;
  }
  const ids = [...useLibraryStore.getState().selection.ids];
  if (ids.length > 0) {
    event.preventDefault();
    void useEditorStore.getState().open(ids);
  }
  return true;
}

function dismissSelection(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || useLibraryStore.getState().selection.ids.size === 0) {
    return false;
  }
  event.preventDefault();
  useLibraryStore.getState().clearSelection();
  return true;
}

/**
 * Delete, for a selection the table does not have focus on.
 *
 * A focused row handles Delete itself, because it can act on the row under the
 * cursor even when that row is not part of the selection. This is the case it
 * cannot cover: Ctrl+A and a click on the sidebar both leave focus off the
 * table, and Delete has to keep working.
 */
function removeFromPlaylist(event: KeyboardEvent): boolean {
  if (event.key !== "Delete" || event.defaultPrevented) {
    return false;
  }
  const { playlistId, selection } = useLibraryStore.getState();
  if (playlistId === null || selection.ids.size === 0) {
    return true;
  }
  const open = usePlaylistsStore.getState().playlists.find((one) => one.id === playlistId);
  // Smart playlists are a query, not a list - there is no membership to remove
  // a song from, and deleting the file is not what Delete means.
  if (open?.kind !== "static") {
    return true;
  }
  event.preventDefault();
  void usePlaylistsStore.getState().removeTracks(playlistId, [...selection.ids]);
  return true;
}

const SHORTCUTS = [selectEverything, openTagEditor, dismissSelection, removeFromPlaylist];

function onKeyDown(event: KeyboardEvent): void {
  // Ctrl+A in the search box means "select this text", which is a much more
  // useful thing for it to do while you are typing in one.
  if (isTypingTarget(event.target)) {
    return;
  }
  // Each answers whether the key was its own, acted on or not: Ctrl+I with an
  // empty selection is still Ctrl+I, and must not fall through to the next.
  for (const shortcut of SHORTCUTS) {
    if (shortcut(event)) {
      return;
    }
  }
}

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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
