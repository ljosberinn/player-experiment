import { useEffect, useRef, useState } from "react";
import { useLibraryStore } from "../library/store";
import { hasTrackIds, readTrackIds } from "./drag";
import { usePlaylistsStore } from "./store";

/** The name a brand new playlist gets, the way every music player does it. */
const NEW_PLAYLIST_NAME = "New Playlist";

/**
 * The Playlists section of the source list.
 *
 * Owns its own behaviour rather than being data handed to `Sidebar`: each item
 * is a drop target for a multi-selection, renames in place, and deletes.
 */
export function PlaylistSidebar() {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const load = usePlaylistsStore((s) => s.load);
  const createPlaylist = usePlaylistsStore((s) => s.create);
  const renamePlaylist = usePlaylistsStore((s) => s.rename);
  const removePlaylist = usePlaylistsStore((s) => s.remove);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const editSmart = usePlaylistsStore((s) => s.editSmart);

  const selectedId = useLibraryStore((s) => s.playlistId);
  const showPlaylist = useLibraryStore((s) => s.showPlaylist);

  /** Which playlist the pointer is currently over with a valid drag. */
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  // Renaming lives in the store because creating a playlist starts one, and
  // that can happen from outside this component.
  const renamingId = usePlaylistsStore((s) => s.renaming);
  const startRename = usePlaylistsStore((s) => s.startRename);
  const endRename = usePlaylistsStore((s) => s.endRename);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="sidebar-section">
      <div className="sidebar-title-row">
        <h2 className="sidebar-title" id="playlists-heading">
          Playlists
        </h2>
        <button
          type="button"
          className="sidebar-add"
          aria-label="New playlist"
          onClick={() => void createPlaylist(NEW_PLAYLIST_NAME)}
        >
          +
        </button>
        <button
          type="button"
          className="sidebar-add"
          aria-label="New smart playlist"
          title="New smart playlist"
          onClick={() => void editSmart(null)}
        >
          ⚙
        </button>
      </div>

      {playlists.length === 0 ? (
        <p className="sidebar-empty">
          Drag songs here to start one, or use <strong>+</strong>.
        </p>
      ) : (
        <ul aria-labelledby="playlists-heading">
          {playlists.map((playlist) => (
            <li
              key={playlist.id}
              className={[
                "sidebar-row",
                dropTargetId === playlist.id ? "drop-target" : "",
                playlist.id === selectedId ? "current" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={(event) => {
                // A smart playlist's contents come from its filter, so there
                // is nothing a drop could add. Refusing the drag outright says
                // so more clearly than accepting it and doing nothing.
                if (playlist.kind !== "static" || !hasTrackIds(event.dataTransfer)) {
                  return;
                }
                // Both are required: without preventDefault the browser
                // refuses the drop outright, and the effect is what makes the
                // cursor say "copy" rather than "move".
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDropTargetId(playlist.id);
              }}
              onDragLeave={() => setDropTargetId((id) => (id === playlist.id ? null : id))}
              onDrop={(event) => {
                if (playlist.kind !== "static") {
                  return;
                }
                event.preventDefault();
                setDropTargetId(null);
                void addTracks(playlist.id, readTrackIds(event.dataTransfer));
              }}
            >
              {renamingId === playlist.id ? (
                <RenameField
                  name={playlist.name}
                  onCommit={(name) => {
                    endRename();
                    if (name !== playlist.name) {
                      void renamePlaylist(playlist.id, name);
                    }
                  }}
                  onCancel={endRename}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-item"
                    // Named for the destination, not its size: the count
                    // changes every time a track is added, and a navigation
                    // item whose announced name keeps changing is worse to
                    // use than one that stays put. It stays visible.
                    aria-label={playlist.name}
                    aria-current={playlist.id === selectedId ? "page" : undefined}
                    onClick={() => void showPlaylist(playlist.id)}
                    onDoubleClick={() => startRename(playlist.id)}
                  >
                    <span className="sidebar-icon" aria-hidden="true">
                      {playlist.kind === "smart" ? "⚙" : "≡"}
                    </span>
                    <span className="sidebar-label">{playlist.name}</span>
                    <span className="sidebar-count">{playlist.trackCount}</span>
                  </button>
                  {/* Shown only on the open playlist rather than on hover: an
                      always-present row of delete buttons is a hazard, and a
                      hover-only control is a web affordance. Double-click also
                      renames, but an invisible gesture is not an affordance -
                      these are how you find out the actions exist. */}
                  {playlist.id === selectedId && playlist.kind === "smart" ? (
                    <button
                      type="button"
                      className="sidebar-action"
                      title="Edit filter"
                      aria-label={`Edit filter for ${playlist.name}`}
                      onClick={() => void editSmart(playlist.id)}
                    >
                      ⚙
                    </button>
                  ) : null}
                  {playlist.id === selectedId ? (
                    <button
                      type="button"
                      className="sidebar-action"
                      title="Rename"
                      aria-label={`Rename playlist ${playlist.name}`}
                      onClick={() => startRename(playlist.id)}
                    >
                      ✎
                    </button>
                  ) : null}
                  {playlist.id === selectedId ? (
                    <button
                      type="button"
                      className="sidebar-action"
                      title="Delete"
                      aria-label={`Delete playlist ${playlist.name}`}
                      onClick={() => void removePlaylist(playlist.id)}
                    >
                      ✕
                    </button>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline rename: commits on Enter or blur, abandons on Escape. */
function RenameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape has to stop blur from committing what it just abandoned.
  const cancelled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="sidebar-rename"
      aria-label={`Rename playlist ${name}`}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => {
        if (!cancelled.current) {
          onCommit(value.trim() === "" ? name : value.trim());
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(value.trim() === "" ? name : value.trim());
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
        }
      }}
    />
  );
}
