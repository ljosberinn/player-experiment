import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/ui/Sidebar";
import { StatusDisplay } from "./components/ui/StatusDisplay";
import { TabBar, type ViewTab } from "./components/ui/TabBar";
import { TitleBar } from "./components/ui/TitleBar";
import { Transport } from "./components/ui/Transport";
import { useEditorStore } from "./features/editor/store";
import { TagEditor } from "./features/editor/TagEditor";
import { type ExportChoice, exportChoice } from "./features/export/scope";
import { columnsFor, DEFAULT_COLUMN_IDS } from "./features/library/columns";
import { ScanBar } from "./features/library/ScanBar";
import { SongTable } from "./features/library/SongTable";
import { useLibraryStore } from "./features/library/store";
import { useSelectionShortcuts } from "./features/library/useSelectionShortcuts";
import { usePlayerStore } from "./features/player/store";
import { usePlayerShortcuts } from "./features/player/usePlayerShortcuts";
import { PlaylistSidebar } from "./features/playlists/PlaylistSidebar";
import { NOTICE_MS, usePlaylistsStore } from "./features/playlists/store";
import { useNativeFeel } from "./features/shell/useNativeFeel";
import { useWindowGeometry } from "./features/shell/useWindowGeometry";
import { SmartPlaylistEditor } from "./features/smart/SmartPlaylistEditor";
import { exportLibrary } from "./ipc";
import { formatLibrarySummary } from "./lib/format";

const SIDEBAR_SECTIONS = [
  { title: "Library", items: [{ id: "music", label: "Music", icon: "♪" }] },
];

export function App() {
  const [tab, setTab] = useState<ViewTab>("songs");
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const total = useLibraryStore((s) => s.total);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const showPlaylist = useLibraryStore((s) => s.showPlaylist);
  const searchInput = useLibraryStore((s) => s.searchInput);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const commitSearch = useLibraryStore((s) => s.commitSearch);
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const refresh = useLibraryStore((s) => s.refresh);
  const error = useLibraryStore((s) => s.error);
  const queueIds = useLibraryStore((s) => s.queueIds);

  const status = usePlayerStore((s) => s.status);
  const nowPlaying = usePlayerStore((s) => s.track);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const volume = usePlayerStore((s) => s.volume);
  const playerError = usePlayerStore((s) => s.error);
  const connect = usePlayerStore((s) => s.connect);
  const play = usePlayerStore((s) => s.play);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const playlists = usePlaylistsStore((s) => s.playlists);
  const notice = usePlaylistsStore((s) => s.notice);
  const playlistError = usePlaylistsStore((s) => s.error);
  const dismissNotice = usePlaylistsStore((s) => s.dismissNotice);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);
  const moveTracks = usePlaylistsStore((s) => s.moveTracks);
  const selection = useLibraryStore((s) => s.selection);
  const editorTracks = useEditorStore((s) => s.tracks);
  const canUndoTags = useEditorStore((s) => s.canUndo);
  const tagNotice = useEditorStore((s) => s.notice);
  const tagError = useEditorStore((s) => s.error);
  const closeTagEditor = useEditorStore((s) => s.close);
  const saveTags = useEditorStore((s) => s.save);
  const undoTags = useEditorStore((s) => s.undo);
  const refreshUndo = useEditorStore((s) => s.refreshUndo);

  const editing = usePlaylistsStore((s) => s.editing);
  const closeEditor = usePlaylistsStore((s) => s.closeEditor);
  const saveSmart = usePlaylistsStore((s) => s.saveSmart);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // `connect` resolves to its own teardown, which may land after unmount.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void connect().then((off) => {
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
  }, [connect]);

  usePlayerShortcuts();
  useSelectionShortcuts();
  useNativeFeel();
  useWindowGeometry();

  useEffect(() => {
    if (exportNotice === null) {
      return;
    }
    const timer = setTimeout(() => setExportNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [exportNotice]);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  useEffect(() => {
    void refreshUndo();
  }, [refreshUndo]);

  /**
   * Writes `choice` to a JSON file the user names.
   *
   * Takes what to export rather than reading it off the view, because the row
   * and playlist menus export the thing that was right-clicked, which is not
   * always the thing the toolbar would have exported.
   */
  const runExport = async (choice: ExportChoice) => {
    try {
      const path = await save({
        defaultPath: choice.fileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path === null) {
        return;
      }
      const count = await exportLibrary(path, choice.scope);
      setExportNotice(`Exported ${count} song${count === 1 ? "" : "s"}.`);
    } catch (cause) {
      setExportNotice(`Export failed: ${String(cause)}`);
    }
  };

  /** Double-click or Enter on a row: queue the whole view, start at that row. */
  const activateRow = async (rowIndex: number) => {
    const ids = await queueIds();
    if (ids.length > 0) {
      await play(ids, rowIndex);
    }
  };

  const columns = columnsFor(DEFAULT_COLUMN_IDS);
  const currentPlaylist = playlists.find((playlist) => playlist.id === playlistId) ?? null;
  const exportTarget = exportChoice([...selection.ids], currentPlaylist);
  const currentPlaylistName = currentPlaylist?.name ?? "This playlist";
  // A smart playlist's membership is its filter, so it has neither an order to
  // rearrange nor rows to take out - editing it means editing the filter.
  const editable = currentPlaylist?.kind === "static";
  // Rows can only be dragged into a new order where there is an order to
  // persist: inside a static playlist, showing it in its own order. Sorted by
  // a column the arrangement is derived and a drop would have nowhere to go.
  const reorderable = editable && sortBy === "position";
  const searchScope = playlistId === null ? "Search Library" : `Search ${currentPlaylistName}`;

  return (
    <div className="app">
      <TitleBar>
        <Transport
          playing={status === "playing"}
          volume={volume}
          onPrevious={() => void previous()}
          onPlayPause={() => void toggle()}
          onNext={() => void next()}
          onVolumeChange={(value) => void setVolume(value)}
        />
        {/* Duration totals need a library-wide sum, which arrives with the
            footer work in a later phase; the count is honest today. */}
        <StatusDisplay
          track={nowPlaying}
          positionMs={positionMs}
          summary={formatLibrarySummary(total, 0)}
          onSeek={(value) => void seek(value)}
        />
        {/* The search is scoped to the current view, so it says which one. */}
        <div className="search-box">
          <input
            className="search"
            type="search"
            placeholder={searchScope}
            aria-label={searchScope}
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
      </TitleBar>

      <div className="body">
        <Sidebar
          sections={SIDEBAR_SECTIONS}
          selectedId={playlistId === null ? "music" : ""}
          onSelect={() => void showPlaylist(null)}
        >
          <PlaylistSidebar onExport={(playlist) => void runExport(exportChoice([], playlist))} />
        </Sidebar>

        <main className="content">
          <div className="content-header">
            <TabBar active={tab} onChange={setTab} />
            <div className="scanbar">
              {/* Get Info is no longer a button here: it lives on the row's
                  right-click menu, where a per-song action belongs, and on
                  Ctrl+I. Undo stays - it acts on the last edit, not on a
                  selection, so no row menu is the right home for it. */}
              <button type="button" disabled={!canUndoTags} onClick={() => void undoTags()}>
                Undo Tag Edit
              </button>
              <button type="button" onClick={() => void runExport(exportTarget)}>
                {exportTarget.label}
              </button>
            </div>
            <ScanBar />
          </div>

          {error || playerError || playlistError || tagError ? (
            <p className="content-error" role="alert">
              {error ?? playerError ?? playlistError ?? tagError}
            </p>
          ) : null}

          {notice || tagNotice || exportNotice ? (
            <p className="content-notice" role="status">
              {notice ?? tagNotice ?? exportNotice}
            </p>
          ) : null}

          {total === 0 && playlistId !== null && search === "" ? (
            // An empty playlist is neither an empty library nor a search that
            // found nothing, and both of those give unhelpful advice here.
            <p className="empty-state">
              <strong>{currentPlaylistName}</strong> is empty.{" "}
              {editable
                ? "Drag songs from your library onto it in the sidebar."
                : "Nothing in your library matches its filter yet."}
            </p>
          ) : total === 0 && search !== "" ? (
            // An empty library and an empty result set are different problems,
            // and "add a folder" is unhelpful advice for the second one.
            <p className="empty-state">
              No results for <strong>{search}</strong>.{" "}
              <button type="button" className="link-button" onClick={() => void clearSearch()}>
                Show all songs
              </button>
            </p>
          ) : total === 0 ? (
            <p className="empty-state">
              No songs yet. Use <strong>Add Folder…</strong> to point Player at your music.
            </p>
          ) : (
            <SongTable
              columns={columns}
              onActivate={(rowIndex) => void activateRow(rowIndex)}
              onReorder={
                reorderable && playlistId !== null
                  ? (trackIds, targetIndex) => void moveTracks(playlistId, trackIds, targetIndex)
                  : undefined
              }
              onRemove={
                editable && playlistId !== null
                  ? (trackIds) => void removeTracks(playlistId, trackIds)
                  : undefined
              }
              onExport={(trackIds) => void runExport(exportChoice(trackIds, null))}
              nowPlayingId={nowPlaying?.id ?? null}
            />
          )}
        </main>
      </div>

      <footer className="statusbar">{formatLibrarySummary(total, 0)}</footer>

      {editorTracks ? (
        <TagEditor
          tracks={editorTracks}
          onSave={(edit) => void saveTags(edit)}
          onCancel={closeTagEditor}
          onPickCover={async () => {
            const picked = await open({
              multiple: false,
              filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
            });
            return typeof picked === "string" ? picked : null;
          }}
        />
      ) : null}

      {editing ? (
        <SmartPlaylistEditor
          // Keyed on which playlist is open, so reopening the editor on a
          // different one starts from that one's filter rather than from the
          // draft state left behind by the last.
          key={editing.playlistId ?? "new"}
          title={editing.playlistId === null ? "New Smart Playlist" : "Edit Smart Playlist"}
          name={editing.name}
          filter={editing.filter}
          onSave={(name, filter) => void saveSmart(name, filter)}
          onCancel={closeEditor}
        />
      ) : null}
    </div>
  );
}

export default App;
