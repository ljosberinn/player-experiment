import type { UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ErrorPopover } from "./components/ui/ErrorPopover";
import { LibraryNav } from "./components/ui/LibraryNav";
import { Sidebar } from "./components/ui/Sidebar";
import { TitleBar } from "./components/ui/TitleBar";
import { CrashNotice } from "./features/crash/CrashNotice";
import { useEditorStore } from "./features/editor/store";
import { TagEditor } from "./features/editor/TagEditor";
import { type ExportChoice, exportChoice } from "./features/export/scope";
import { useExportStore } from "./features/export/store";
import { useLastfmStore } from "./features/lastfm/store";
import { BrowseView } from "./features/library/BrowseView";
import { HistoryNav } from "./features/library/HistoryNav";
import { ScanBar } from "./features/library/ScanBar";
import { SearchBox } from "./features/library/SearchBox";
import { SongTable } from "./features/library/SongTable";
import { useScanStore } from "./features/library/scan";
import { useLibraryStore, VIEW_TITLES } from "./features/library/store";
import { useSelectionShortcuts } from "./features/library/useSelectionShortcuts";
import { NowPlayingStatus } from "./features/player/NowPlayingStatus";
import { PlayerRepeat } from "./features/player/PlayerRepeat";
import { PlayerScrubber } from "./features/player/PlayerScrubber";
import { PlayerTransport } from "./features/player/PlayerTransport";
import { PlayerVolume } from "./features/player/PlayerVolume";
import { usePlayerStore } from "./features/player/store";
import { useGlobalMediaKeys } from "./features/player/useGlobalMediaKeys";
import { usePlayerShortcuts } from "./features/player/usePlayerShortcuts";
import { PlaylistSidebar } from "./features/playlists/PlaylistSidebar";
import { usePlaylistsStore } from "./features/playlists/store";
import { AppMenus } from "./features/shell/AppMenus";
import { DynamicBackground } from "./features/shell/DynamicBackground";
import { useDynamicBackgroundStore } from "./features/shell/dynamicBackgroundStore";
import { SettingsDialog } from "./features/shell/SettingsDialog";
import { NOTICE_MS, useStatusStore } from "./features/shell/statusStore";
import { TaskProgress } from "./features/shell/TaskProgress";
import { useHistoryShortcuts } from "./features/shell/useHistoryShortcuts";
import { useLibraryShortcuts } from "./features/shell/useLibraryShortcuts";
import { useNativeFeel } from "./features/shell/useNativeFeel";
import { useNoticeExpiry } from "./features/shell/useNoticeExpiry";
import { useWindowGeometry } from "./features/shell/useWindowGeometry";
import { useWindowTitle } from "./features/shell/useWindowTitle";
import { useZoomShortcuts } from "./features/shell/useZoomShortcuts";
import { viewSummary } from "./features/shell/viewSummary";
import { formatZoom, MAX_ZOOM, MIN_ZOOM } from "./features/shell/zoom";
import { useZoomStore } from "./features/shell/zoomStore";
import { SmartPlaylistEditor } from "./features/smart/SmartPlaylistEditor";
import { useUpdaterStore } from "./features/updater/store";
import { useUpdater } from "./features/updater/useUpdater";
import {
  type AppInfo,
  getAppInfo,
  onLibraryChanged,
  stageDroppedCover,
  stagePickedCover,
} from "./ipc";

export function App() {
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  // Stable, so the notice-expiry effect it feeds does not restart on every
  // unrelated render - see the effect near the other two below.
  const clearToolbarNotice = useCallback(() => setToolbarNotice(null), []);
  const [confirmRemoveMissing, setConfirmRemoveMissing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** What the error popover points at: the box that says what is playing. */
  const statusRef = useRef<HTMLDivElement>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const zoomFactor = useZoomStore((s) => s.factor);
  const stepZoom = useZoomStore((s) => s.step);
  const loadDynamicBg = useDynamicBackgroundStore((s) => s.load);
  // Launch lifecycle, and nothing else: who is connected is `AppMenus`'
  // business. Both are actions, so they cost no renders where they are.
  const loadLastfm = useLastfmStore((s) => s.load);
  const watchLastfm = useLastfmStore((s) => s.watch);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateVersion = useUpdaterStore((s) => s.version);
  const installUpdate = useUpdaterStore((s) => s.install);

  const total = useLibraryStore((s) => s.total);
  const stats = useLibraryStore((s) => s.stats);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const tab = useLibraryStore((s) => s.tab);
  const showTab = useLibraryStore((s) => s.showTab);
  const browse = useLibraryStore((s) => s.browse);
  // Only for the footer's count of how many albums, artists or genres a browse
  // view is listing; the view itself reads them for rendering.
  const groups = useLibraryStore((s) => s.groups);
  const loadColumns = useLibraryStore((s) => s.loadColumns);
  const closeGroup = useLibraryStore((s) => s.closeGroup);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const search = useLibraryStore((s) => s.search);
  // The field itself lives in `SearchBox`; this is for the empty-state's way
  // out of a search that found nothing. An action, so it never changes.
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const refresh = useLibraryStore((s) => s.refresh);
  const removeMissing = useLibraryStore((s) => s.removeMissing);
  const queueIds = useLibraryStore((s) => s.queueIds);

  const nowPlaying = usePlayerStore((s) => s.track);
  const playerError = usePlayerStore((s) => s.error);
  const connect = usePlayerStore((s) => s.connect);
  const play = usePlayerStore((s) => s.play);

  const playlists = usePlaylistsStore((s) => s.playlists);
  const notice = useStatusStore((s) => s.notice);
  const dismissNotice = useStatusStore((s) => s.dismissNotice);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);
  const moveTracks = usePlaylistsStore((s) => s.moveTracks);
  const editorTracks = useEditorStore((s) => s.tracks);
  const closeTagEditor = useEditorStore((s) => s.close);
  const saveTags = useEditorStore((s) => s.save);
  const refreshUndo = useEditorStore((s) => s.refreshUndo);
  const tagProgress = useEditorStore((s) => s.progress);
  const runExportTo = useExportStore((s) => s.run);

  const scanError = useScanStore((s) => s.error);
  const dismissScanError = useScanStore((s) => s.dismissError);

  const editing = usePlaylistsStore((s) => s.editing);
  const closeEditor = usePlaylistsStore((s) => s.closeEditor);
  const saveSmart = usePlaylistsStore((s) => s.saveSmart);

  const statusMessage = useStatusStore((s) => s.message);
  const dismissStatus = useStatusStore((s) => s.dismiss);
  const dismissPlayerError = usePlayerStore((s) => s.dismissError);

  /**
   * The one error on screen, whichever part of the app it came from.
   *
   * Four stores can be unhappy at once and there is one place to say so, so the
   * order is the order they are noticed in - and dismissing clears all four
   * rather than uncovering the next one, which would read as the message
   * refusing to go away.
   */
  const problem = statusMessage ?? playerError ?? scanError ?? null;
  const dismissProblem = () => {
    dismissStatus();
    dismissPlayerError();
    dismissScanError();
  };

  useEffect(() => {
    // The layout first: it can move the sort off a hidden column, and doing
    // that after the first query would mean querying twice on every launch.
    void loadColumns().then(() => refresh());
  }, [loadColumns, refresh]);

  useEffect(() => {
    // Not awaited alongside the layout above: nothing waits on it. The
    // background is on by default and there is nothing playing yet, so the
    // worst a slow read can do is turn the blobs off a moment after the first
    // paint of a window that has none.
    void loadDynamicBg();
    // One SQLite read, and the only thing last.fm does unbidden: it decides
    // whether the Account menu opens at all. Nothing leaves the machine.
    void loadLastfm();
  }, [loadDynamicBg, loadLastfm]);

  useEffect(() => {
    // The one thing last.fm reports without being asked: the stored key has
    // been rejected and forgotten, so the Account menu must stop claiming an
    // account. Same teardown dance as the player subscription below.
    let stop: UnlistenFn | undefined;
    let cancelled = false;
    void watchLastfm().then((off) => {
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
  }, [watchLastfm]);

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
  // F5, which is the library half of the keyboard rather than the transport.
  useLibraryShortcuts();
  // Back and forward: the mouse's side buttons and Alt+arrows.
  useHistoryShortcuts();
  // The window-scoped bindings above stay as they are; this adds the four
  // media keys that have to work while the app is behind something else.
  useGlobalMediaKeys();
  useZoomShortcuts();
  useSelectionShortcuts();
  useNativeFeel();
  useUpdater();
  useWindowGeometry();
  // Alt+Tab and the taskbar, which are the only places a decorationless
  // window's title shows.
  useWindowTitle();

  useNoticeExpiry(toolbarNotice, clearToolbarNotice, NOTICE_MS);
  useNoticeExpiry(notice, dismissNotice, NOTICE_MS);

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
      const count = await runExportTo(path, choice.scope);
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

  const currentPlaylist = playlists.find((playlist) => playlist.id === playlistId) ?? null;
  const currentPlaylistName = currentPlaylist?.name ?? "This playlist";
  // A smart playlist's membership is its filter, so it has neither an order to
  // rearrange nor rows to take out - editing it means editing the filter.
  const editable = currentPlaylist?.kind === "static";
  // Rows can only be dragged into a new order where there is an order to
  // persist: inside a static playlist, showing it in its own order. Sorted by
  // a column the arrangement is derived and a drop would have nowhere to go.
  const reorderable = editable && sortBy === "position";

  return (
    <div className="app">
      {/* Behind everything, and outside the flex flow: the cover's colours,
          blurred, turning once a minute. Renders nothing at all when there is
          no artwork playing or the preference is off. */}
      <DynamicBackground />

      {/* The title bar carries the product identity and nothing else now: the
          mark, the menus, the version and the window buttons. Everything that
          used to ride on it is in the strip below, which is what the design
          draws and what gives the menus the left edge to themselves. */}
      <TitleBar version={appInfo?.version ?? null}>
        {/* Its own component because the Edit menu serves the selection:
            built here, a click re-rendered the whole app for a menu nobody
            had open. */}
        <AppMenus
          onRemoveMissing={() => setConfirmRemoveMissing(true)}
          onSettings={() => setShowSettings(true)}
          onExport={(choice) => void runExport(choice)}
        />
      </TitleBar>

      {/* Each of these subscribes to its own store values rather than taking
          them as props. They are the things that change on a schedule of their
          own - the playhead four times a second, the volume rail at the
          pointer's sampling rate, the search field on every keystroke - and
          read from here they re-rendered the whole app, song table included. */}
      <div className="transport-strip">
        <PlayerTransport />
        <PlayerScrubber />
        <div className="strip-gap" />
        <NowPlayingStatus ref={statusRef} />
        <div className="strip-gap" />
        {/* Repeat sits with the volume rather than in the transport pill: the
            pill is prev/play/next and nothing else, and repeat is a setting
            about what happens next rather than a thing to press now. */}
        <PlayerRepeat />
        <PlayerVolume />
        <SearchBox />
      </div>

      <div className="body">
        <Sidebar>
          {/* Above the library views because it acts on all of them, and on
              the playlists below them. */}
          <HistoryNav />
          <LibraryNav
            // Nothing in the library section is current while a playlist is
            // open: the playlist is what the content pane is showing, and two
            // highlighted rows would be two answers to one question.
            active={playlistId === null ? tab : null}
            onSelect={(view) => void showTab(view)}
          />
          <PlaylistSidebar onExport={(playlist) => void runExport(exportChoice([], playlist))} />
        </Sidebar>

        <main className="content">
          {/* Returns null unless a scan is running, so this costs no space in
              the ordinary case - but it stays mounted either way, because it
              is what subscribes to the progress events. */}
          <ScanBar />
          {/* The other two writes long enough to watch: an export, and a tag
              undo started from the Edit menu. Mounted unconditionally for the
              same reason `ScanBar` is - it is what subscribes to them. */}
          <TaskProgress />

          {/* Songs has no heading, deliberately: it is the view with 150k rows
              in it, and it is the one that can least afford to spend a third of
              the fold on the word "Songs". What the heading carried is in the
              footer instead, for every view. */}
          {tab !== "songs" && browse === null ? (
            <div className="view-heading">
              <h1>{VIEW_TITLES[tab]}</h1>
              <span className="view-heading-rule" aria-hidden="true" />
            </div>
          ) : null}

          {notice || toolbarNotice ? (
            <p className="content-notice" role="status">
              {notice ?? toolbarNotice}
            </p>
          ) : null}

          {browse !== null ? (
            // The way back out of a drill-in. A breadcrumb rather than the tab
            // itself: clicking Albums again while inside an album should be a
            // no-op, not a hidden back button.
            <button type="button" className="browse-back" onClick={() => void closeGroup()}>
              ‹ All {VIEW_TITLES[tab]}
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
              No songs yet. Use <strong>Add Folders…</strong> to point Apex at your music.
            </p>
          ) : (
            <SongTable
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

      {/* Beside the other dialogs rather than in the content flow: it is an
          alert dialog now, so it portals to the body and its position here is
          about where it belongs in the reading order, not on screen. */}
      <CrashNotice />

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

        {/* What the Songs heading used to carry, for every view. Scoped to
            what is on screen rather than to the whole library: inside a
            playlist, a search or an album, a line under the table that counted
            something else would be answering a question nobody asked. */}
        <span className="statusbar-summary">
          {viewSummary({
            tab,
            drilledIn: browse !== null,
            groupCount: groups.length,
            trackCount: stats.tracks,
            durationMs: stats.durationMs,
            bytes: stats.bytes,
          })}
        </span>

        {/* Only `ready` says anything. Checking and downloading happen quietly,
            and a failed check usually means the machine is offline, which is
            not news.

            It is also the only way an update is ever applied: installing ends
            the process and starts the installer, so a player that did it on a
            timer would stop mid-song. Pressing this is the consent.

            The version itself moved to the title bar in phase 34, so this no
            longer replaces it - the corner is empty until there is an update,
            which is the state it is in on all but a handful of launches. */}
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
        ) : null}
      </footer>

      {editorTracks ? (
        <TagEditor
          tracks={editorTracks}
          progress={tagProgress}
          onSave={(edit) => void saveTags(edit)}
          onCancel={closeTagEditor}
          onPickCover={async () => {
            const picked = await open({
              multiple: false,
              filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
            });
            // Staged rather than carried straight to the save, so a picked
            // image previews and is refused the same way a dropped one is.
            return typeof picked === "string" ? await stagePickedCover(picked) : null;
          }}
          // The bytes cross once, at drop time, and what comes back is a path -
          // the same thing the picker gives, so the editor has one cover state
          // rather than two.
          onDropCover={async (file) => stageDroppedCover(await file.arrayBuffer())}
        />
      ) : null}

      {/* Anchored to the status display rather than stacked above the table.
          As a paragraph it pushed the rows down as it appeared, shifting the
          whole view under the pointer, and it sat nowhere near the thing it
          was about. */}
      <ErrorPopover message={problem} anchor={statusRef} onDismiss={dismissProblem} />

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

      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}

      {editing ? (
        <SmartPlaylistEditor
          // Keyed on which playlist is open, so reopening the editor on a
          // different one starts from that one's filter rather than from the
          // draft state left behind by the last.
          key={editing.playlistId ?? "new"}
          title={editing.playlistId === null ? "New Smart Playlist" : "Edit Smart Playlist"}
          name={editing.name}
          filter={editing.filter}
          order={editing.order}
          isNew={editing.playlistId === null}
          onSave={(name, filter, order) => void saveSmart(name, filter, order)}
          onCancel={closeEditor}
        />
      ) : null}
    </div>
  );
}

export default App;
