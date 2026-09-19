import { statsWorstByBitrate } from "../../../ipc";
import { report } from "../../shell/statusStore";
import { saveCsv, toCsv } from "../csv";
import { useLibraryQuery } from "../useLibraryQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * How many albums the list draws and the export writes.
 *
 * Read to the end like the shopping list it is, not skimmed like a ranking:
 * the tail is the part still to re-buy.
 */
const ROWS = 200;

/**
 * Albums by mean bitrate, worst first: the re-download list.
 *
 * A table rather than a `BarList`, because the bar would be a share of 320
 * kbps and every row would look much like every other. What is read here is
 * the number, and the order it puts the rows in.
 */
export function WorstByBitrate() {
  const { query, deps } = useLibraryQuery();
  const { data, loading } = usePanelQuery(() => statsWorstByBitrate(query, ROWS), deps);

  const albums = data ?? [];

  const exportCsv = () => {
    const csv = toCsv(
      ["Album", "Artist", "Songs", "Mean kbps"],
      albums.map((album) => [
        album.album,
        album.artist ?? "",
        String(album.tracks),
        String(album.meanBitrate),
      ]),
    );
    // The save dialog already said where it was going, so a write that fails
    // after it is an error like any other rather than a notice of its own.
    saveCsv("worst-by-bitrate.csv", csv).catch(report);
  };

  return (
    <StatsPanel
      title="Albums by mean bitrate"
      action={
        <button
          type="button"
          className="stats-action"
          onClick={exportCsv}
          disabled={albums.length === 0}
        >
          Export…
        </button>
      }
    >
      {loading && albums.length === 0 ? (
        <div className="bar-list bar-list-loading">
          {Array.from({ length: 5 }, (_, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a skeleton row has no identity
            <div key={row} className="bar-list-skeleton" data-testid="bar-list-skeleton" />
          ))}
        </div>
      ) : albums.length === 0 ? (
        <p className="empty-state">Nothing here reports a bitrate.</p>
      ) : (
        <div className="stats-table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Album</th>
                <th scope="col">Artist</th>
                <th scope="col">Songs</th>
                <th scope="col">kbps</th>
              </tr>
            </thead>
            <tbody>
              {albums.map((album) => (
                <tr key={`${album.album}${album.artist ?? ""}`}>
                  <th scope="row">{album.album}</th>
                  <td>{album.artist ?? "—"}</td>
                  <td className="stats-table-number">{album.tracks.toLocaleString()}</td>
                  <td className="stats-table-number">{album.meanBitrate.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StatsPanel>
  );
}
