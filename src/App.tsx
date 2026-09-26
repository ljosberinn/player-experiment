import type { UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import "./App.css";
import { AppBar } from "./components/ui/AppBar";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ErrorDialog } from "./components/ui/ErrorDialog";
import { LibraryNav } from "./components/ui/LibraryNav";
import { Sidebar } from "./components/ui/Sidebar";
import { CrashNotice } from "./features/crash/CrashNotice";
import { useEditorStore } from "./features/editor/store";
import { TagEditor } from "./features/editor/TagEditor";
import { type ExportChoice, exportChoice } from "./features/export/scope";
import { useExportStore } from "./features/export/store";
import { useLastfmStore } from "./features/lastfm/store";
import { BrowseView } from "./features/library/BrowseView";
import { HistoryNav } from "./features/library/HistoryNav";
import { useLibraryDrop } from "./features/library/libraryDrop";
import { ReleaseGroups } from "./features/library/ReleaseGroups";
import { ScanBar } from "./features/library/ScanBar";
import { SearchBox } from "./features/library/SearchBox";
import { SongTable } from "./features/library/SongTable";
import { useLibraryStore, VIEW_TITLES } from "./features/library/store";
import { useSelectionShortcuts } from "./features/library/useSelectionShortcuts";
import { useLovedStore } from "./features/love/store";
import { PlayerBar } from "./features/player/PlayerBar";
import { usePlayerStore } from "./features/player/store";
import { useGlobalMediaKeys } from "./features/player/useGlobalMediaKeys";
import { usePlayerShortcuts } from "./features/player/usePlayerShortcuts";
import { PlaylistSidebar } from "./features/playlists/PlaylistSidebar";
import { usePlaylistsStore } from "./features/playlists/store";
import { AppMenus } from "./features/shell/AppMenus";
import { BackgroundTaskProgress } from "./features/shell/BackgroundTaskProgress";
import { DynamicBackground } from "./features/shell/DynamicBackground";
import { useDynamicBackgroundStore } from "./features/shell/dynamicBackgroundStore";
import { useFileDrops } from "./features/shell/fileDrop";
import { type SettingsCategory, SettingsDialog } from "./features/shell/SettingsDialog";
import { NOTICE_MS, notify, useStatusStore } from "./features/shell/statusStore";
import { TaskProgress } from "./features/shell/TaskProgress";
import { useHistoryShortcuts } from "./features/shell/useHistoryShortcuts";
import { useLibraryShortcuts } from "./features/shell/useLibraryShortcuts";
import { useNativeFeel } from "./features/shell/useNativeFeel";
import { useNoticeExpiry } from "./features/shell/useNoticeExpiry";
import { useWindowGeometry } from "./features/shell/useWindowGeometry";
import { useWindowTitle } from "./features/shell/useWindowTitle";
import { useZoomShortcuts } from "./features/shell/useZoomShortcuts";
import { ViewSummaryText } from "./features/shell/ViewSummaryText";
import { SmartPlaylistEditor } from "./features/smart/SmartPlaylistEditor";
import { StatisticsView } from "./features/stats/StatisticsView";
import { ReleaseLookup } from "./features/tagsource/ReleaseLookup";
import { ReviewQueue } from "./features/tagsource/ReviewQueue";
import { UpdateButton } from "./features/updater/UpdateButton";
import { useUpdater } from "./features/updater/useUpdater";
import { type AppInfo, getAppInfo, stagePickedCover } from "./ipc";

export function App() {
  const [confirmRemoveMissing, setConfirmRemoveMissing] = useState(false);
  /** Which category Settings is open on, or null while it is closed. */
  const [settings, setSettings] = useState<SettingsCategory | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const loadDynamicBg = useDynamicBackgroundStore((s) => s.load);
  // Launch lifecycle, and nothing else: who is connected is `AppMenus`'
  // business. Both are actions, so they cost no renders where they are.
  const loadLastfm = useLastfmStore((s) => s.load);
  const watchLastfm = useLastfmStore((s) => s.watch);
  const loadLoved = useLovedStore((s) => s.load);
  const watchLoved = useLovedStore((s) => s.watch);

  const total = useLibraryStore((s) => s.total);
  const stats = useLibraryStore((s) => s.stats);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const tab = useLibraryStore((s) => s.tab);
  const showTab = useLibraryStore((s) => s.showTab);
  const browse = useLibraryStore((s) => s.browse);
  const restoreView = useLibraryStore((s) => s.restoreView);
  const closeGroup = useLibraryStore((s) => s.closeGroup);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const search = useLibraryStore((s) => s.search);
  // The field itself lives in `SearchBox`; this is for the empty-state's way
  // out of a search that found nothing. An action, so it never changes.
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const watchLibrary = useLibraryStore((s) => s.watch);
  const removeMissing = useLibraryStore((s) => s.removeMissing);
  // Null on all but the handful of renders where the question is being asked,
  // so this costs the same as the `useState` above it - and unlike one, the
  // Delete shortcut can reach it.
  const pendingRemoval = useLibraryStore((s) => s.pendingRemoval);
  const askRemoval = useLibraryStore((s) => s.askRemoval);
  const cancelRemoval = useLibraryStore((s) => s.cancelRemoval);
  const removeFromLibrary = useLibraryStore((s) => s.removeFromLibrary);
  const queueIds = useLibraryStore((s) => s.queueIds);

  const nowPlaying = usePlayerStore((s) => s.track);
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
  const tagProgress = useEditorStore((s) => s.progress);
  const runExportTo = useExportStore((s) => s.run);

  const editing = usePlaylistsStore((s) => s.editing);
  const closeEditor = usePlaylistsStore((s) => s.closeEditor);
  const saveSmart = usePlaylistsStore((s) => s.saveSmart);

  const statusMessage = useStatusStore((s) => s.message);
  const dismissStatus = useStatusStore((s) => s.dismiss);

  useEffect(() => {
    void restoreView();
  }, [restoreView]);

  useEffect(() => {
    // Not awaited alongside the view above: nothing waits on it. The
    // background is on by default and there is nothing playing yet, so the
    // worst a slow read can do is turn the blobs off a moment after the first
    // paint of a window that has none.
    void loadDynamicBg();
    // One SQLite read, and the only thing last.fm does unbidden: it decides
    // whether the Account menu opens at all. Nothing leaves the machine.
    void loadLastfm();
    // The set the song menu reads to say Love or Unlove. Local too.
    void loadLoved();
  }, [loadDynamicBg, loadLastfm, loadLoved]);

  useEffect(() => {
    // What last.fm reports without being asked: the stored key has been
    // rejected and forgotten, so the Account menu must stop claiming an
    // account; and its loves arriving, which move the set the menus read.
    // Same teardown dance as the player subscription below.
    const stops: UnlistenFn[] = [];
    let cancelled = false;
    for (const watch of [watchLastfm, watchLoved]) {
      void watch().then((off) => {
        if (cancelled) {
          off();
        } else {
          stops.push(off);
        }
      });
    }
    return () => {
      cancelled = true;
      for (const stop of stops) {
        stop();
      }
    };
  }, [watchLastfm, watchLoved]);

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
  // Files dragged in from the OS arrive as one window-wide event; this routes
  // them, and holds no state of its own.
  useFileDrops();
  // What a dropped folder or file then lands in. A ref and a class toggle, no
  // subscription: the outline must not re-render the view with 150k rows in it.
  const libraryPane = useLibraryDrop();
  useUpdater();
  useWindowGeometry();
  // Alt+Tab and the taskbar, which are the only places a decorationless
  // window's title shows.
  useWindowTitle();

  useNoticeExpiry(notice, dismissNotice, NOTICE_MS);

  useEffect(() => {
    // Every write announces itself on `library://changed`, and this is what
    // re-asks. The same teardown dance as the other two subscriptions.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void watchLibrary().then((off) => {
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
  }, [watchLibrary]);

  useEffect(() => {
    // Read once from the backend rather than baked in at build time: the Rust
    // crate's version is the one the installer and every export report, so
    // asking it is what keeps the app bar honest if they ever disagree.
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
      notify(`Exported ${count} song${count === 1 ? "" : "s"}.`);
    } catch (cause) {
      // A notice rather than a report: the user named a file and is owed an
      // answer either way, and the answer belongs on the same line as the
      // success it replaces.
      notify(`Export failed: ${String(cause)}`);
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

      {/* The mark, the menus, the version and the search field. The OS frame
          above it is the window's own. `SearchBox` subscribes to its own
          input: read from here, every keystroke re-rendered the whole app. */}
      <AppBar version={appInfo?.version ?? null} update={<UpdateButton />} search={<SearchBox />}>
        {/* Its own component because the Edit menu serves the selection:
            built here, a click re-rendered the whole app for a menu nobody
            had open. */}
        <AppMenus
          onRemoveMissing={() => setConfirmRemoveMissing(true)}
          onSettings={(category = "appearance") => setSettings(category)}
          onExport={(choice) => void runExport(choice)}
        />
      </AppBar>

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
            onExport={(playlist) => void runExport(exportChoice([], playlist))}
          />
          <PlaylistSidebar onExport={(playlist) => void runExport(exportChoice([], playlist))} />
          {/* Under the playlists because it is the same kind of thing: a place
              to go, with a count beside it. Draws nothing until the unattended
              pass has queued something, and subscribes to its own count rather
              than taking one from here. */}
          <ReviewQueue />
          {/* Last, and pinned to the bottom by the sidebar's own layout. Like
              `ScanBar` it stays mounted whatever it is drawing, because it is
              what subscribes to `task://progress`. */}
          <BackgroundTaskProgress />
        </Sidebar>

        <main className="content" ref={libraryPane}>
          {/* Returns null unless a scan is running, so this costs no space in
              the ordinary case - but it stays mounted either way, because it
              is what subscribes to the progress events. */}
          <ScanBar />
          {/* The other write long enough to watch: an export. Mounted
              unconditionally for the same reason `ScanBar` is - it is what
              subscribes to it, and to `tags://progress` for the editor. */}
          <TaskProgress />

          {/* Songs has no heading, deliberately: it is the view with 150k rows
              in it, and it is the one that can least afford to spend a third of
              the fold on the word "Songs". Its summary gets a line of its own
              instead, below. */}
          {tab !== "songs" && browse === null ? (
            <div className="view-heading">
              <div className="view-heading-title">
                <h1>{VIEW_TITLES[tab]}</h1>
                <ViewSummaryText />
              </div>
              <span className="view-heading-rule" aria-hidden="true" />
            </div>
          ) : null}

          {notice ? (
            <p className="content-notice" role="status">
              {notice}
            </p>
          ) : null}

          {browse !== null ? (
            // The summary shares the breadcrumb's row, so a drill-in spends no
            // height on it.
            <div className="browse-back-row">
              {/* The way back out of a drill-in. A breadcrumb rather than the
                  tab itself: clicking Releases again while inside a release
                  should be a no-op, not a hidden back button. */}
              <button type="button" className="browse-back" onClick={() => void closeGroup()}>
                ‹ All {VIEW_TITLES[tab]}
              </button>
              <ViewSummaryText />
            </div>
          ) : tab === "songs" ? (
            <ViewSummaryText className="view-summary-line" />
          ) : null}

          {tab === "stats" ? (
            // Subscribes to the stats store itself and takes nothing from
            // here, so a range change wakes a panel rather than the app.
            <StatisticsView />
          ) : tab !== "songs" && browse === null ? (
            // Keyed on the tab, so each of the three is its own instance
            // with its own scroll container: unkeyed they shared one, and
            // Artists opened wherever the album grid had been left.
            <BrowseView key={tab} kind={tab} />
          ) : total === 0 && playlistId !== null && search === "" ? (
            // An empty playlist is neither an empty library nor a search that
            // found nothing, and both of those give unhelpful advice here.
            <p className="empty-state">
              <strong>{currentPlaylistName}</strong> is empty.{" "}
              {editable
                ? "Drag songs from your library onto it in the sidebar."
                : currentPlaylist?.builtIn === "favorites"
                  ? "Love a song to add it here."
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
          ) : browse !== null ? (
            // A drill-in is drawn as its releases - one group for a release,
            // a discography for an artist or a genre. The same rows and the
            // same wiring as the table below; what differs is that it places
            // them by group.
            <ReleaseGroups
              onActivate={(rowIndex) => void activateRow(rowIndex)}
              onRemove={
                editable && playlistId !== null
                  ? (trackIds) => void removeTracks(playlistId, trackIds)
                  : undefined
              }
              onRemoveFromLibrary={askRemoval}
              onExport={(trackIds) => void runExport(exportChoice(trackIds, null))}
              nowPlayingId={nowPlaying?.id ?? null}
            />
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
              // Unconditional, unlike the one above: every view a row can be
              // seen in is a view its library row can be removed from.
              onRemoveFromLibrary={askRemoval}
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

      {/* Last, under the content. Draws nothing while stopped, and
          subscribes to that on its own behalf so App does not re-render for
          it. */}
      <PlayerBar />

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
          // A drop carries a path like the picker does, so both stage the same
          // way and the editor has one cover state rather than two.
          onDropCover={stagePickedCover}
        />
      ) : null}

      {/* Mounted unconditionally, like `TaskProgress`: it subscribes on its
          own behalf and draws nothing until a lookup is open, so App does not
          re-render for a dialog it does not own. */}
      <ReleaseLookup />

      {statusMessage === null ? null : (
        <ErrorDialog message={statusMessage} onDismiss={dismissStatus} />
      )}

      {confirmRemoveMissing ? (
        <ConfirmDialog
          title="Remove missing songs?"
          body={`${stats.missing} song${stats.missing === 1 ? "" : "s"} cannot be found. Removing them also takes them out of every playlist. If a drive is unplugged, reconnect it and rescan instead.`}
          confirmLabel="Remove"
          onConfirm={() => {
            setConfirmRemoveMissing(false);
            void removeMissing().then((removed) => {
              notify(`Removed ${removed} missing song${removed === 1 ? "" : "s"}.`);
            });
          }}
          onCancel={() => setConfirmRemoveMissing(false)}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmDialog
          title={pendingRemoval.length === 1 ? "Remove this song?" : "Remove these songs?"}
          body={`${pendingRemoval.length} song${pendingRemoval.length === 1 ? "" : "s"} will be removed from your library and every playlist. The file${pendingRemoval.length === 1 ? " stays" : "s stay"} on disk; a rescan adds ${pendingRemoval.length === 1 ? "it" : "them"} back only after File ▸ Forget Removed Songs.`}
          confirmLabel="Remove"
          onConfirm={() => {
            const ids = pendingRemoval;
            cancelRemoval();
            void removeFromLibrary(ids).then((removed) => {
              notify(`Removed ${removed} song${removed === 1 ? "" : "s"} from your library.`);
            });
          }}
          onCancel={cancelRemoval}
        />
      ) : null}

      {settings === null ? null : (
        <SettingsDialog category={settings} onClose={() => setSettings(null)} />
      )}

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
