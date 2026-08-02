import { useEffect, useState } from "react";
import "./App.css";
import { Sidebar } from "./components/ui/Sidebar";
import { StatusDisplay } from "./components/ui/StatusDisplay";
import { TabBar, type ViewTab } from "./components/ui/TabBar";
import { TitleBar } from "./components/ui/TitleBar";
import { Transport } from "./components/ui/Transport";
import { columnsFor, DEFAULT_COLUMN_IDS } from "./features/library/columns";
import { ScanBar } from "./features/library/ScanBar";
import { SongTable } from "./features/library/SongTable";
import { useLibraryStore } from "./features/library/store";
import { usePlayerStore } from "./features/player/store";
import { usePlayerShortcuts } from "./features/player/usePlayerShortcuts";
import { formatLibrarySummary } from "./lib/format";

const SIDEBAR_SECTIONS = [
  { title: "Library", items: [{ id: "music", label: "Music", icon: "♪" }] },
];

export function App() {
  const [tab, setTab] = useState<ViewTab>("songs");
  const [source, setSource] = useState("music");

  const total = useLibraryStore((s) => s.total);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
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

  /** Double-click or Enter on a row: queue the whole view, start at that row. */
  const activateRow = async (rowIndex: number) => {
    const ids = await queueIds();
    if (ids.length > 0) {
      await play(ids, rowIndex);
    }
  };

  const columns = columnsFor(DEFAULT_COLUMN_IDS);

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
        <input
          className="search"
          type="search"
          placeholder="Search Library"
          aria-label="Search Library"
          value={search}
          onChange={(event) => void setSearch(event.currentTarget.value)}
        />
      </TitleBar>

      <div className="body">
        <Sidebar sections={SIDEBAR_SECTIONS} selectedId={source} onSelect={setSource} />

        <main className="content">
          <div className="content-header">
            <TabBar active={tab} onChange={setTab} />
            <ScanBar />
          </div>

          {error || playerError ? (
            <p className="content-error" role="alert">
              {error ?? playerError}
            </p>
          ) : null}

          {total === 0 ? (
            <p className="empty-state">
              No songs yet. Use <strong>Add Folder…</strong> to point Player at your music.
            </p>
          ) : (
            <SongTable
              columns={columns}
              onActivate={(rowIndex) => void activateRow(rowIndex)}
              nowPlayingId={nowPlaying?.id ?? null}
            />
          )}
        </main>
      </div>

      <footer className="statusbar">{formatLibrarySummary(total, 0)}</footer>
    </div>
  );
}

export default App;
