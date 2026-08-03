import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import "./App.css";
import { Toolbar } from "@base-ui/react/toolbar";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { Sidebar } from "./components/ui/Sidebar";
import { StatusDisplay } from "./components/ui/StatusDisplay";
import { TabBar } from "./components/ui/TabBar";
import { TitleBar } from "./components/ui/TitleBar";
import { Transport } from "./components/ui/Transport";
import { useEditorStore } from "./features/editor/store";
import { TagEditor } from "./features/editor/TagEditor";
import { type ExportChoice, exportChoice } from "./features/export/scope";
import { BrowseView } from "./features/library/BrowseView";
import { resolveColumns } from "./features/library/columns";
import { ScanBar } from "./features/library/ScanBar";
import { SongTable } from "./features/library/SongTable";
import { useLibraryStore } from "./features/library/store";
import { useSelectionShortcuts } from "./features/library/useSelectionShortcuts";
import { usePlayerStore } from "./features/player/store";
import { useGlobalMediaKeys } from "./features/player/useGlobalMediaKeys";
import { usePlayerShortcuts } from "./features/player/usePlayerShortcuts";
import { PlaylistSidebar } from "./features/playlists/PlaylistSidebar";
import { NOTICE_MS, usePlaylistsStore } from "./features/playlists/store";
import { useNativeFeel } from "./features/shell/useNativeFeel";
import { useWindowGeometry } from "./features/shell/useWindowGeometry";
import { useZoomShortcuts } from "./features/shell/useZoomShortcuts";
import { formatZoom, MAX_ZOOM, MIN_ZOOM } from "./features/shell/zoom";
import { useZoomStore } from "./features/shell/zoomStore";
import { SmartPlaylistEditor } from "./features/smart/SmartPlaylistEditor";
import { useUpdaterStore } from "./features/updater/store";
import { useUpdater } from "./features/updater/useUpdater";
import { type AppInfo, exportLibrary, getAppInfo, onLibraryChanged } from "./ipc";
import { formatLibrarySummary } from "./lib/format";

const SIDEBAR_SECTIONS = [
  { title: "Library", items: [{ id: "music", label: "Music", icon: "♪" }] },
];

export function App() {
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  const [confirmRemoveMissing, setConfirmRemoveMissing] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const zoomFactor = useZoomStore((s) => s.factor);
  const stepZoom = useZoomStore((s) => s.step);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateVersion = useUpdaterStore((s) => s.version);
  const installUpdate = useUpdaterStore((s) => s.install);

  const total = useLibraryStore((s) => s.total);
  const stats = useLibraryStore((s) => s.stats);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const tab = useLibraryStore((s) => s.tab);
  const showTab = useLibraryStore((s) => s.showTab);
  const browse = useLibraryStore((s) => s.browse);
  const columnConfig = useLibraryStore((s) => s.columns);
  const loadColumns = useLibraryStore((s) => s.loadColumns);
  const closeGroup = useLibraryStore((s) => s.closeGroup);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const showPlaylist = useLibraryStore((s) => s.showPlaylist);
  const searchInput = useLibraryStore((s) => s.searchInput);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const commitSearch = useLibraryStore((s) => s.commitSearch);
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const refresh = useLibraryStore((s) => s.refresh);
  const removeMissing = useLibraryStore((s) => s.removeMissing);
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
    // The layout first: it can move the sort off a hidden column, and doing
    // that after the first query would mean querying twice on every launch.
    void loadColumns().then(() => refresh());
  }, [loadColumns, refresh]);

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
  // The window-scoped bindings above stay as they are; this adds the four
  // media keys that have to work while the app is behind something else.
  useGlobalMediaKeys();
  useZoomShortcuts();
  useSelectionShortcuts();
  useNativeFeel();
  useUpdater();
  useWindowGeometry();

  useEffect(() => {
    if (toolbarNotice === null) {
      return;
    }
    const timer = setTimeout(() => setToolbarNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [toolbarNotice]);

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

  useEffect(() => {
    // Playing a track whose file has come back clears its missing mark, and
    // the view has no other way to find out: the row still shows the marker
    // and the toolbar still offers to remove it. The backend only emits this
    // when a row actually changed, so the reload is rare rather than per song.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void onLibraryChanged(() => void refresh()).then((off) => {
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
  }, [refresh]);

  useEffect(() => {
    // Read once from the backend rather than baked in at build time: the Rust
    // crate's version is the one the installer and every export report, so
    // asking it is what keeps the footer honest if they ever disagree.
    void getAppInfo()
      .then(setAppInfo)
      .catch(() => {
        // A missing version is not worth an error state; the line just omits it.
      });
  }, []);

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
      setToolbarNotice(`Exported ${count} song${count === 1 ? "" : "s"}.`);
    } catch (cause) {
      setToolbarNotice(`Export failed: ${String(cause)}`);
    }
  };

  /** Double-click or Enter on a row: queue the whole view, start at that row. */
  const activateRow = async (rowIndex: number) => {
    const ids = await queueIds();
    if (ids.length > 0) {
      await play(ids, rowIndex);
    }
  };

  // Resolved from the store rather than fixed, so a hidden column, a reorder
  // or a drag-resize reaches the table - and so a playlist can have its own.
  const columns = resolveColumns(columnConfig);
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
        <StatusDisplay
          track={nowPlaying}
          positionMs={positionMs}
          summary={formatLibrarySummary(stats.tracks, stats.durationMs)}
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
            <TabBar active={tab} onChange={(next) => void showTab(next)} />
            {/* A real toolbar: one tab stop for the group, arrows between the
                buttons inside it. It was a div of buttons, so tabbing past the
                library actions cost a keystroke each. */}
            <Toolbar.Root className="scanbar" aria-label="Library actions">
              {/* Get Info is no longer a button here: it lives on the row's
                  right-click menu, where a per-song action belongs, and on
                  Ctrl+I. Undo stays - it acts on the last edit, not on a
                  selection, so no row menu is the right home for it. */}
              <Toolbar.Button
                render={<button type="button" />}
                disabled={!canUndoTags}
                onClick={() => void undoTags()}
              >
                Undo Tag Edit
              </Toolbar.Button>
              <Toolbar.Button
                render={<button type="button" />}
                onClick={() => void runExport(exportTarget)}
              >
                {exportTarget.label}
              </Toolbar.Button>
              {/* Only when there is something to clear, which in a library
                  whose drives are all plugged in is never. A permanent button
                  for a condition that rarely holds is one more thing to read
                  past on every launch. */}
              {stats.missing > 0 ? (
                <Toolbar.Button
                  render={<button type="button" />}
                  onClick={() => setConfirmRemoveMissing(true)}
                >
                  Remove {stats.missing} Missing
                </Toolbar.Button>
              ) : null}
            </Toolbar.Root>
            <ScanBar />
          </div>

          {error || playerError || playlistError || tagError ? (
            <p className="content-error" role="alert">
              {error ?? playerError ?? playlistError ?? tagError}
            </p>
          ) : null}

          {notice || tagNotice || toolbarNotice ? (
            <p className="content-notice" role="status">
              {notice ?? tagNotice ?? toolbarNotice}
            </p>
          ) : null}

          {browse !== null ? (
            // The way back out of a drill-in. A breadcrumb rather than the tab
            // itself: clicking Albums again while inside an album should be a
            // no-op, not a hidden back button.
            <button type="button" className="browse-back" onClick={() => void closeGroup()}>
              ‹ All {tab}
            </button>
          ) : null}

          {tab !== "songs" && browse === null ? (
            <BrowseView kind={tab} />
          ) : total === 0 && playlistId !== null && search === "" ? (
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

      <footer className="statusbar">
        {/* First in the DOM as well as leftmost on screen. Grid auto-placement
            only moves forward, so an item explicitly assigned to column 1
            after one sitting in column 2 cannot go back and starts a new row -
            which put the version and this control on a second line. */}
        {/* Bottom-left, in the strip's quietest corner: a control touched once
            and then left alone. Two buttons rather than a slider - the steps
            are 0.1 apart over a narrow range, which is a worse fit for dragging
            than for clicking, and the two buttons are the same gesture as the
            Ctrl+plus / Ctrl+minus that already work. */}
        <span className="statusbar-zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomFactor <= MIN_ZOOM}
            onClick={() => void stepZoom(-1)}
          >
            −
          </button>
          {/* aria-live so a screen reader hears the new value; the buttons
              themselves keep their own labels rather than announcing it. */}
          <span className="statusbar-zoom-value" aria-live="polite">
            {formatZoom(zoomFactor)}
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoomFactor >= MAX_ZOOM}
            onClick={() => void stepZoom(1)}
          >
            +
          </button>
        </span>

        <span className="statusbar-summary">
          {formatLibrarySummary(stats.tracks, stats.durationMs, stats.bytes)}
        </span>

        {/* Only `ready` says anything. Checking and downloading happen quietly,
            and a failed check usually means the machine is offline, which is
            not news.

            It is also the only way an update is ever applied: installing ends
            the process and starts the installer, so a player that did it on a
            timer would stop mid-song. Pressing this is the consent. */}
        {updateStatus === "ready" || updateStatus === "installing" ? (
          <button
            type="button"
            className="statusbar-update"
            disabled={updateStatus === "installing"}
            onClick={() => void installUpdate()}
          >
            {updateStatus === "installing"
              ? "Installing…"
              : `${updateVersion} ready — restart to install`}
          </button>
        ) : appInfo ? (
          <span className="statusbar-version">v{appInfo.version}</span>
        ) : null}
      </footer>

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

      {confirmRemoveMissing ? (
        <ConfirmDialog
          title="Remove missing songs?"
          body={`${stats.missing} song${stats.missing === 1 ? "" : "s"} cannot be found on disk. Removing them takes them out of every playlist too. The files themselves are not touched - if a drive is simply unplugged, plug it back in and rescan instead.`}
          confirmLabel="Remove"
          onConfirm={() => {
            setConfirmRemoveMissing(false);
            void removeMissing().then((removed) => {
              setToolbarNotice(`Removed ${removed} missing song${removed === 1 ? "" : "s"}.`);
            });
          }}
          onCancel={() => setConfirmRemoveMissing(false)}
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
