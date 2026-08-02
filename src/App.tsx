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
import { formatLibrarySummary } from "./lib/format";

const SIDEBAR_SECTIONS = [
  { title: "Library", items: [{ id: "music", label: "Music", icon: "♪" }] },
];

export function App() {
  const [tab, setTab] = useState<ViewTab>("songs");
  const [volume, setVolume] = useState(0.8);
  const [source, setSource] = useState("music");

  const total = useLibraryStore((s) => s.total);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const refresh = useLibraryStore((s) => s.refresh);
  const error = useLibraryStore((s) => s.error);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = columnsFor(DEFAULT_COLUMN_IDS);

  return (
    <div className="app">
      <TitleBar>
        <Transport volume={volume} onVolumeChange={setVolume} />
        {/* Duration totals need a library-wide sum, which arrives with the
            footer work in a later phase; the count is honest today. */}
        <StatusDisplay track={null} summary={formatLibrarySummary(total, 0)} />
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

          {error ? (
            <p className="content-error" role="alert">
              {error}
            </p>
          ) : null}

          {total === 0 ? (
            <p className="empty-state">
              No songs yet. Use <strong>Add Folder…</strong> to point Player at your music.
            </p>
          ) : (
            <SongTable columns={columns} />
          )}
        </main>
      </div>

      <footer className="statusbar">{formatLibrarySummary(total, 0)}</footer>
    </div>
  );
}

export default App;
