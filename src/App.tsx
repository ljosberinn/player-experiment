import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { LibraryNav } from "./components/ui/LibraryNav";
import { MenuBar } from "./components/ui/MenuBar";
import { Sidebar } from "./components/ui/Sidebar";
import { TitleBar } from "./components/ui/TitleBar";
import { CrashNotice } from "./features/crash/CrashNotice";
import { useEditorStore } from "./features/editor/store";
import { TagEditorHost } from "./features/editor/TagEditorHost";
import { type ExportChoice, exportChoice } from "./features/export/scope";
import { useExportStore } from "./features/export/store";
import { HistoryNav } from "./features/library/HistoryNav";
import { LibraryPane } from "./features/library/LibraryPane";
import { RemoveMissingDialog } from "./features/library/RemoveMissingDialog";
import { SearchBox } from "./features/library/SearchBox";
import { useLibraryStore } from "./features/library/store";
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
import { NOTICE_MS } from "./features/playlists/store";
import { AppErrorPopover } from "./features/shell/AppErrorPopover";
import { DynamicBackground } from "./features/shell/DynamicBackground";
import { useDynamicBackgroundStore } from "./features/shell/dynamicBackgroundStore";
import { SettingsDialog } from "./features/shell/SettingsDialog";
import { StatusBar } from "./features/shell/StatusBar";
import { useAppMenus } from "./features/shell/useAppMenus";
import { useHistoryShortcuts } from "./features/shell/useHistoryShortcuts";
import { useLibraryShortcuts } from "./features/shell/useLibraryShortcuts";
import { useNativeFeel } from "./features/shell/useNativeFeel";
import { useWindowGeometry } from "./features/shell/useWindowGeometry";
import { useWindowTitle } from "./features/shell/useWindowTitle";
import { useZoomShortcuts } from "./features/shell/useZoomShortcuts";
import { SmartPlaylistEditorHost } from "./features/smart/SmartPlaylistEditorHost";
import { useUpdater } from "./features/updater/useUpdater";
import { type AppInfo, getAppInfo, onLibraryChanged } from "./ipc";

export function App() {
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  const [confirmRemoveMissing, setConfirmRemoveMissing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** What the error popover points at: the box that says what is playing. */
  const statusRef = useRef<HTMLDivElement>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const loadDynamicBg = useDynamicBackgroundStore((s) => s.load);

  const loadColumns = useLibraryStore((s) => s.loadColumns);
  const refresh = useLibraryStore((s) => s.refresh);
  const tab = useLibraryStore((s) => s.tab);
  const showTab = useLibraryStore((s) => s.showTab);
  const playlistId = useLibraryStore((s) => s.playlistId);

  const connect = usePlayerStore((s) => s.connect);
  const refreshUndo = useEditorStore((s) => s.refreshUndo);
  const runExportTo = useExportStore((s) => s.run);

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
  }, [loadDynamicBg]);

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

  useEffect(() => {
    if (toolbarNotice === null) {
      return;
    }
    const timer = setTimeout(() => setToolbarNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [toolbarNotice]);

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

  const appMenus = useAppMenus({
    onExport: (choice) => void runExport(choice),
    onRemoveMissing: () => setConfirmRemoveMissing(true),
    onSettings: () => setShowSettings(true),
  });

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
        <MenuBar menus={appMenus} />
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

        <LibraryPane toolbarNotice={toolbarNotice} onExport={(choice) => void runExport(choice)} />
      </div>

      {/* Beside the other dialogs rather than in the content flow: it is an
          alert dialog now, so it portals to the body and its position here is
          about where it belongs in the reading order, not on screen. */}
      <CrashNotice />

      <StatusBar />

      <TagEditorHost />

      {/* Anchored to the status display rather than stacked above the table.
          As a paragraph it pushed the rows down as it appeared, shifting the
          whole view under the pointer, and it sat nowhere near the thing it
          was about. */}
      <AppErrorPopover anchor={statusRef} />

      {confirmRemoveMissing ? (
        <RemoveMissingDialog
          onClose={() => setConfirmRemoveMissing(false)}
          onRemoved={(removed) =>
            setToolbarNotice(`Removed ${removed} missing song${removed === 1 ? "" : "s"}.`)
          }
        />
      ) : null}

      {showSettings ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}

      <SmartPlaylistEditorHost />
    </div>
  );
}

export default App;
