import { usePlaylistsStore } from "../playlists/store";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

/** Mounts the filter editor whenever the store says a filter is being edited. */
export function SmartPlaylistEditorHost() {
  const editing = usePlaylistsStore((s) => s.editing);
  const closeEditor = usePlaylistsStore((s) => s.closeEditor);
  const saveSmart = usePlaylistsStore((s) => s.saveSmart);

  if (editing === null) {
    return null;
  }
  return (
    <SmartPlaylistEditor
      // Keyed on which playlist is open, so reopening the editor on a
      // different one starts from that one's filter rather than from the draft
      // state left behind by the last.
      key={editing.playlistId ?? "new"}
      title={editing.playlistId === null ? "New Smart Playlist" : "Edit Smart Playlist"}
      name={editing.name}
      filter={editing.filter}
      order={editing.order}
      onSave={(name, filter, order) => void saveSmart(name, filter, order)}
      onCancel={closeEditor}
    />
  );
}
