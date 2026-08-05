import type React from "react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { SidebarSection } from "../../components/ui/SidebarSection";
import type { Playlist } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { hasTrackIds, readTrackIds } from "./drag";
import { NEW_PLAYLIST_NAME, usePlaylistsStore } from "./store";

/**
 * Stands in for "the new playlist a drop would create" in `dropTargetId`.
 *
 * Negative because every real playlist id is positive, so it can never collide
 * with one.
 */
const NEW_PLAYLIST_TARGET = -1;

/**
 * The two playlist sections of the source list.
 *
 * Owns its own behaviour rather than being data handed to `Sidebar`: each item
 * is a drop target for a multi-selection, renames in place, and deletes.
 *
 * Smart and static are separate sections as of phase 36, which is how the
 * design draws them and which also gives each its own `+`. They used to share
 * one heading with two buttons on it - a `+` that made a playlist and a gear
 * that made a smart one - and nothing but the icon said which was which.
 */
export function PlaylistSidebar({
  onExport,
}: {
  /**
   * Export a playlist. Lives with the caller because it opens a save dialog,
   * which is the shell's business rather than the sidebar's.
   */
  onExport?: ((playlist: Playlist) => void) | undefined;
} = {}) {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const load = usePlaylistsStore((s) => s.load);
  const createPlaylist = usePlaylistsStore((s) => s.create);
  const createFrom = usePlaylistsStore((s) => s.createFrom);
  const playPlaylist = usePlaylistsStore((s) => s.playPlaylist);
  const renamePlaylist = usePlaylistsStore((s) => s.rename);
  const removePlaylist = usePlaylistsStore((s) => s.remove);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const editSmart = usePlaylistsStore((s) => s.editSmart);

  const selectedId = useLibraryStore((s) => s.playlistId);
  const showPlaylist = useLibraryStore((s) => s.showPlaylist);

  /** Which playlist the pointer is currently over with a valid drag. */
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  /** The playlist awaiting a yes/no on deletion. */
  const [confirming, setConfirming] = useState<Playlist | null>(null);
  // Renaming lives in the store because creating a playlist starts one, and
  // that can happen from outside this component.
  const renamingId = usePlaylistsStore((s) => s.renaming);
  const startRename = usePlaylistsStore((s) => s.startRename);
  const endRename = usePlaylistsStore((s) => s.endRename);

  const collapsed = usePlaylistsStore((s) => s.collapsed);
  const loadSections = usePlaylistsStore((s) => s.loadSections);
  const toggleSection = usePlaylistsStore((s) => s.toggleSection);
  const watch = usePlaylistsStore((s) => s.watch);

  useEffect(() => {
    void load();
    void loadSections();
  }, [load, loadSections]);

  useEffect(() => {
    // The counts. A scan changes what half of these rows say and nothing else
    // would tell the sidebar so. `watch` resolves to its own teardown, which
    // may land after unmount.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void watch().then((off) => {
      if (cancelled) {
        off();
      } else {
        stop = off;
      }
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [watch]);

  const smart = playlists.filter((playlist) => playlist.kind === "smart");
  const statics = playlists.filter((playlist) => playlist.kind !== "smart");

  /**
   * One row: the item, its right-click menu, and its drop behaviour.
   *
   * A function rather than a component because it closes over most of the
   * state above - the drop target, the rename, the confirmation - and passing
   * all of that down would be a props list longer than the body.
   */
  const row = (playlist: Playlist) => (
    // Each row is its own trigger, which removes the "right-clicking a
    // playlist selects it first" special case: that existed so the
    // highlight said which playlist Delete was about to remove, and a
    // per-row trigger leaves no question in the first place.
    <ContextMenu
      key={playlist.id}
      label={`${playlist.name} actions`}
      items={[
        {
          label: "Play",
          // Nothing to play, and nothing to write into an export file.
          // Disabled rather than absent: the actions still exist, this
          // playlist just has no contents for them to act on yet.
          disabled: playlist.trackCount === 0,
          onSelect: () => void playPlaylist(playlist.id),
        },
        { kind: "separator" },
        ...(playlist.kind === "smart"
          ? [{ label: "Edit Filter…", onSelect: () => void editSmart(playlist.id) }]
          : []),
        { label: "Rename", onSelect: () => startRename(playlist.id) },
        { label: "Delete", onSelect: () => setConfirming(playlist) },
        { kind: "separator" },
        {
          label: "Export…",
          disabled: playlist.trackCount === 0,
          onSelect: () => onExport?.(playlist),
        },
      ]}
      render={
        <li
          className={[
            "sidebar-row",
            dropTargetId === playlist.id ? "drop-target" : "",
            playlist.id === selectedId ? "current" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onDragOver={(event: React.DragEvent<HTMLLIElement>) => {
            // A smart playlist's contents come from its filter, so
            // there is nothing a drop could add. Refusing the drag
            // outright says so more clearly than accepting it and
            // doing nothing.
            if (playlist.kind !== "static" || !hasTrackIds(event.dataTransfer)) {
              return;
            }
            // Both are required: without preventDefault the browser
            // refuses the drop outright, and the effect is what makes
            // the cursor say "copy" rather than "move".
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropTargetId(playlist.id);
          }}
          onDragLeave={() => setDropTargetId((id) => (id === playlist.id ? null : id))}
          onDrop={(event: React.DragEvent<HTMLLIElement>) => {
            if (playlist.kind !== "static") {
              return;
            }
            event.preventDefault();
            setDropTargetId(null);
            void addTracks(playlist.id, readTrackIds(event.dataTransfer));
          }}
        />
      }
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
      )}
    </ContextMenu>
  );

  return (
    <>
      <SidebarSection
        id="smart-playlists"
        title="Smart Playlists"
        collapsed={collapsed.smart === true}
        onToggle={() => void toggleSection("smart")}
        actions={
          <button
            type="button"
            className="sidebar-add"
            aria-label="New smart playlist"
            title="New smart playlist"
            onClick={() => void editSmart(null)}
          >
            +
          </button>
        }
      >
        {smart.length === 0 ? (
          <p className="sidebar-empty">
            None yet. Use <strong>+</strong> for a playlist that fills itself.
          </p>
        ) : (
          <ul aria-labelledby="smart-playlists-heading">{smart.map(row)}</ul>
        )}
      </SidebarSection>

      <SidebarSection
        id="playlists"
        title="Playlists"
        collapsed={collapsed.playlists === true}
        onToggle={() => void toggleSection("playlists")}
        actions={
          <button
            type="button"
            className="sidebar-add"
            aria-label="New playlist"
            onClick={() => void createPlaylist(NEW_PLAYLIST_NAME)}
          >
            +
          </button>
        }
      >
        {statics.length === 0 ? (
          <p className="sidebar-empty">
            Drag songs here to start one, or use <strong>+</strong>.
          </p>
        ) : (
          <ul aria-labelledby="playlists-heading">{statics.map(row)}</ul>
        )}

        {/* Dropping onto the empty space below the list starts a new playlist
            holding what was dropped. The drop lands first, so the rename that
            follows is over something real rather than an empty row.

            Inside this section, so folding it away takes the drop target with
            it - a hidden drop target is a thing a drag can still find. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target, not a control - the keyboard route to the same result is the + button above and the row menu's Add to Playlist. */}
        <div
          className={`sidebar-dropzone${dropTargetId === NEW_PLAYLIST_TARGET ? " drop-target" : ""}`}
          data-testid="playlist-dropzone"
          onDragOver={(event) => {
            if (!hasTrackIds(event.dataTransfer)) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropTargetId(NEW_PLAYLIST_TARGET);
          }}
          onDragLeave={() => setDropTargetId((id) => (id === NEW_PLAYLIST_TARGET ? null : id))}
          onDrop={(event) => {
            event.preventDefault();
            setDropTargetId(null);
            void createFrom(readTrackIds(event.dataTransfer));
          }}
        >
          {statics.length === 0 ? null : "Drop songs here for a new playlist"}
        </div>
      </SidebarSection>

      {confirming ? (
        <ConfirmDialog
          title={`Delete "${confirming.name}"?`}
          // Says what is and is not lost. Deleting a playlist removes the list,
          // never the songs, and that is exactly the fear this dialog exists to
          // answer.
          body={
            confirming.kind === "smart"
              ? "The playlist and its filter are removed. No songs are deleted."
              : `The playlist is removed. The ${confirming.trackCount} song${
                  confirming.trackCount === 1 ? "" : "s"
                } in it stay in your library.`
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const playlist = confirming;
            setConfirming(null);
            void removePlaylist(playlist.id);
          }}
        />
      ) : null}
    </>
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
