import { useEffect } from "react";
import { useEditorStore } from "../editor/store";
import { type ExportChoice, exportChoice } from "../export/scope";
import { usePlayerStore } from "../player/store";
import { NOTICE_MS, usePlaylistsStore } from "../playlists/store";
import { useCurrentPlaylist } from "../playlists/useCurrentPlaylist";
import { TaskProgress } from "../shell/TaskProgress";
import { BrowseView } from "./BrowseView";
import { resolveColumns } from "./columns";
import { ScanBar } from "./ScanBar";
import { SongTable } from "./SongTable";
import { useLibraryStore, VIEW_TITLES } from "./store";

/**
 * The content pane: whatever the sidebar's current selection resolves to.
 *
 * Each part reads the stores it needs rather than taking them as props, for
 * the same reason the transport strip does - the shell would otherwise
 * re-render everything down to the song table whenever any of them changed.
 */
export function LibraryPane({
  toolbarNotice,
  onExport,
}: {
  /** The shell's own transient message, shown alongside the stores' own. */
  toolbarNotice: string | null;
  onExport: (choice: ExportChoice) => void;
}) {
  const tab = useLibraryStore((s) => s.tab);
  const browse = useLibraryStore((s) => s.browse);
  const closeGroup = useLibraryStore((s) => s.closeGroup);
  const notice = usePlaylistsStore((s) => s.notice);
  const dismissNotice = usePlaylistsStore((s) => s.dismissNotice);
  const tagNotice = useEditorStore((s) => s.notice);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  return (
    <main className="content">
      {/* Returns null unless a scan is running, so this costs no space in the
          ordinary case - but it stays mounted either way, because it is what
          subscribes to the progress events. */}
      <ScanBar />
      {/* The other two writes long enough to watch: an export, and a tag undo
          started from the Edit menu. Mounted unconditionally for the same
          reason `ScanBar` is - it is what subscribes to them. */}
      <TaskProgress />

      {/* Songs has no heading, deliberately: it is the view with 150k rows in
          it, and it is the one that can least afford to spend a third of the
          fold on the word "Songs". What the heading carried is in the footer
          instead, for every view. */}
      {tab !== "songs" && browse === null ? (
        <div className="view-heading">
          <h1>{VIEW_TITLES[tab]}</h1>
          <span className="view-heading-rule" aria-hidden="true" />
        </div>
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
          ‹ All {VIEW_TITLES[tab]}
        </button>
      ) : null}

      <LibraryBody onExport={onExport} />
    </main>
  );
}

/** Which of the three things the pane can be showing. */
function LibraryBody({ onExport }: { onExport: (choice: ExportChoice) => void }) {
  const tab = useLibraryStore((s) => s.tab);
  const browse = useLibraryStore((s) => s.browse);
  const total = useLibraryStore((s) => s.total);

  if (tab !== "songs" && browse === null) {
    return <BrowseView kind={tab} />;
  }
  if (total === 0) {
    return <EmptyLibrary />;
  }
  return <LibraryTable onExport={onExport} />;
}

/** Why there are no rows, which is a different answer in each of three cases. */
function EmptyLibrary() {
  const playlistId = useLibraryStore((s) => s.playlistId);
  const search = useLibraryStore((s) => s.search);
  // The field itself lives in `SearchBox`; this is the empty state's way out of
  // a search that found nothing. An action, so it never changes.
  const clearSearch = useLibraryStore((s) => s.clearSearch);
  const currentPlaylist = useCurrentPlaylist();

  if (playlistId !== null && search === "") {
    // An empty playlist is neither an empty library nor a search that found
    // nothing, and both of those give unhelpful advice here.
    return (
      <p className="empty-state">
        <strong>{currentPlaylist?.name ?? "This playlist"}</strong> is empty.{" "}
        {currentPlaylist?.kind === "static"
          ? "Drag songs from your library onto it in the sidebar."
          : "Nothing in your library matches its filter yet."}
      </p>
    );
  }

  if (search !== "") {
    // An empty library and an empty result set are different problems, and
    // "add a folder" is unhelpful advice for the second one.
    return (
      <p className="empty-state">
        No results for <strong>{search}</strong>.{" "}
        <button type="button" className="link-button" onClick={() => void clearSearch()}>
          Show all songs
        </button>
      </p>
    );
  }

  return (
    <p className="empty-state">
      No songs yet. Use <strong>Add Folders…</strong> to point Apex at your music.
    </p>
  );
}

/** The rows, and what a playlist lets you do to them. */
function LibraryTable({ onExport }: { onExport: (choice: ExportChoice) => void }) {
  const playlistId = useLibraryStore((s) => s.playlistId);
  const sortBy = useLibraryStore((s) => s.sortBy);
  // Resolved from the store rather than fixed, so a hidden column, a reorder
  // or a drag-resize reaches the table - and so a playlist can have its own.
  const columnConfig = useLibraryStore((s) => s.columns);
  const queueIds = useLibraryStore((s) => s.queueIds);
  const play = usePlayerStore((s) => s.play);
  const nowPlaying = usePlayerStore((s) => s.track);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);
  const moveTracks = usePlaylistsStore((s) => s.moveTracks);
  const currentPlaylist = useCurrentPlaylist();

  // A smart playlist's membership is its filter, so it has neither an order to
  // rearrange nor rows to take out - editing it means editing the filter.
  const editable = currentPlaylist?.kind === "static";
  // Rows can only be dragged into a new order where there is an order to
  // persist: inside a static playlist, showing it in its own order. Sorted by
  // a column the arrangement is derived and a drop would have nowhere to go.
  const reorderable = editable && sortBy === "position";

  /** Double-click or Enter on a row: queue the whole view, start at that row. */
  const activateRow = async (rowIndex: number) => {
    const ids = await queueIds();
    if (ids.length > 0) {
      await play(ids, rowIndex);
    }
  };

  return (
    <SongTable
      columns={resolveColumns(columnConfig)}
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
      onExport={(trackIds) => onExport(exportChoice(trackIds, null))}
      nowPlayingId={nowPlaying?.id ?? null}
    />
  );
}
