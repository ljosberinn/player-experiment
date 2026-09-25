import { Fragment, useEffect } from "react";
import { Button } from "../../components/primitives/Button";
import { Checkbox } from "../../components/primitives/Checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from "../../components/primitives/Dialog";
import { IconButton } from "../../components/primitives/IconButton";
import { ProgressBar } from "../../components/primitives/ProgressBar";
import {
  coverUrl,
  type ReleaseCandidate,
  type ReleaseDetail,
  type RemoteTrack,
  type ReviewEntry,
  stagedCoverUrl,
  type Track,
} from "../../ipc";
import { fileNameOf, formatDuration } from "../../lib/format";
import { WriteLine } from "../editor/WriteLine";
import {
  type Assignment,
  agrees,
  buildEdits,
  changedRuns,
  differences,
  type Fields,
  LOOKUP_FIELDS,
  mappedCount,
} from "./mapping";
import { type Stage, useTagsourceStore } from "./store";

/** The rail beside the status line, in pixels. Section 6f. */
const RAIL = 62;

/**
 * The release lookup: pick a release out of the queue, pick a release out of
 * MusicBrainz, confirm what it writes.
 *
 * Mp3tag's flow, because it is the right one. A lookup is a suggestion about
 * files the user has already got, so nothing is written before the tracklist
 * has been shown next to the files it would rename, field by field.
 *
 * One release at a time, in a queue. A selection is grouped by album and album
 * artist before anything leaves the machine - 65,535 tracks are some 8,000
 * releases, and MusicBrainz allows one request a second, so the release is the
 * unit a lookup is worth doing at.
 *
 * **The queue is a column, not a screen.** Section 6e draws it beside the pane
 * rather than in front of it, so four hundred releases are one dialog rather
 * than four hundred. That is affordable because selecting a row costs no
 * request: a review entry arrives with the pass's candidates, and only picking
 * one of them spends the rate-limited fetch.
 */
export function ReleaseLookup() {
  const queue = useTagsourceStore((s) => s.queue);
  const index = useTagsourceStore((s) => s.index);
  const fromReview = useTagsourceStore((s) => s.fromReview);
  const tracks = useTagsourceStore((s) => s.tracks);
  const stage = useTagsourceStore((s) => s.stage);
  const candidates = useTagsourceStore((s) => s.candidates);
  const detail = useTagsourceStore((s) => s.detail);
  const assignment = useTagsourceStore((s) => s.assignment);
  const fields = useTagsourceStore((s) => s.fields);
  const setFields = useTagsourceStore((s) => s.setFields);
  const error = useTagsourceStore((s) => s.error);
  const close = useTagsourceStore((s) => s.close);
  const choose = useTagsourceStore((s) => s.choose);
  const setAside = useTagsourceStore((s) => s.setAside);
  const search = useTagsourceStore((s) => s.search);
  const pick = useTagsourceStore((s) => s.pick);
  const back = useTagsourceStore((s) => s.back);
  const swap = useTagsourceStore((s) => s.swap);
  const apply = useTagsourceStore((s) => s.apply);
  const watch = useTagsourceStore((s) => s.watch);

  useEffect(() => {
    // Its own subscription rather than the tag editor's, so the readout in
    // this dialog counts this dialog's write. Resolves to its own teardown,
    // which can land after unmount.
    let stop: (() => void) | null = null;
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

  if (queue === undefined || queue === null) {
    return null;
  }
  // Undefined is a queue that has run past its end, a frame before `close`
  // lands; null is a release decided with nothing selected in its place.
  const release = index === null ? null : (queue[index] ?? null);

  const busy = stage === "applying";
  const willWrite = mappedCount(assignment);

  return (
    <Dialog
      paned
      variant="lookup"
      onClose={() => {
        // A write in flight cannot be called off - files are already on disk.
        if (!busy) {
          close();
        }
      }}
    >
      <DialogHeader title="Get Tags from MusicBrainz" caption={caption(queue.length, fromReview)} />

      <DialogBody>
        <Queue queue={queue} index={index} onSelect={(at) => void choose(at)} />
        {release === null ? (
          <p className="lookup-empty">Pick a release from the queue.</p>
        ) : (
          <Pane
            release={release}
            tracks={tracks}
            stage={stage}
            candidates={candidates}
            detail={detail}
            assignment={assignment}
            fields={fields}
            busy={busy}
            willWrite={willWrite}
            onPick={(mbid) => void pick(mbid)}
            onFields={setFields}
            onSwap={swap}
          />
        )}
      </DialogBody>

      {error === null ? null : (
        <p className="content-error" role="alert">
          {error}
        </p>
      )}

      {/* Not the sheet's "Back to queue": with the queue in the column on the
          left, back to it is clicking another row. The slot holds the step
          back that is still a step - out of a picked candidate, or out of a
          candidate list the review queue cached weeks ago. One at a time,
          because they are the same move at two depths. A write has no step
          back, so it takes the slot for its progress. */}
      <DialogFooter
        lead={
          busy ? (
            <Writing />
          ) : detail === null ? (
            <Button kind="ghost" disabled={release === null} onClick={() => void search()}>
              Search again
            </Button>
          ) : (
            <Button kind="ghost" onClick={back}>
              Back to Results
            </Button>
          )
        }
      >
        <DialogClose disabled={busy}>Cancel</DialogClose>
        {/* Only on the review queue, which is the only queue an entry persists
            in. On a selection there is nothing to set aside: the queue dies
            with the dialog. */}
        {fromReview ? (
          <Button
            disabled={release === null || busy}
            title="Take this release out of the review queue"
            onClick={() => void setAside()}
          >
            Set Aside
          </Button>
        ) : null}
        <Button
          kind="primary"
          disabled={busy || detail === null || willWrite === 0}
          onClick={() => {
            if (detail !== null) {
              void apply(buildEdits(tracks, detail, assignment, fields));
            }
          }}
        >
          {busy ? "Writing…" : "Apply"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * The apply's progress, subscribed here so a file landing re-renders the line
 * rather than the dialog.
 */
function Writing() {
  const progress = useTagsourceStore((s) => s.progress);
  return <WriteLine progress={progress} />;
}

/**
 * What the dialog is working through, beside what it is called.
 *
 * A position within the queue would be a number about a list that is on
 * screen: the column says which release is which and how many are left.
 */
function caption(length: number, fromReview: boolean): string {
  const releases = `${length} release${length === 1 ? "" : "s"}`;
  return fromReview ? `${releases} to review` : releases;
}

/** A score as the two digits that fit beside a queue row. */
function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * The queue, as a column that scrolls inside itself.
 *
 * The pass leaves four hundred releases behind and they are not equally worth
 * looking at, so the queue is sorted by what the pass scored each one at
 * rather than a stack the dialog hands you the top of. `lookup::queue` does
 * the sorting; this renders the order it arrived in.
 *
 * About four hundred rows and no virtualisation: the list is bounded by what
 * one library's pass could not write, and it is behind a click.
 *
 * A listbox rather than a table, which is what 212px leaves room for. Of the
 * five columns the table had, the artist and the file count move to the pane's
 * subject line and the pressing to the candidate list, which draws it already.
 * The one that has nowhere else to go stays: a track count that disagrees with
 * the candidate the score was measured on is why a release at 97% is in this
 * queue at all, so it colours the score rather than taking a column.
 */
function Queue({
  queue,
  index,
  onSelect,
}: {
  queue: ReviewEntry[];
  index: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="lookup-queue">
      <div className="lookup-eyebrow">Queue</div>
      {/* Selection moves on the arrows, which costs nothing: `enter` reads the
          release's files and stops. Focus follows it by hand rather than
          through an effect - every row is mounted, so the target is already in
          the DOM when the key is handled - and focusing it is also what
          scrolls it into the column. */}
      <div
        className="lookup-queue-list"
        role="listbox"
        aria-label="Review queue"
        tabIndex={index === null ? 0 : -1}
        onKeyDown={(event) => {
          const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
          if (step === 0) {
            return;
          }
          event.preventDefault();
          const next =
            index === null
              ? step > 0
                ? 0
                : queue.length - 1
              : Math.min(queue.length - 1, Math.max(0, index + step));
          onSelect(next);
          const row = event.currentTarget.children[next];
          if (row instanceof HTMLElement) {
            row.focus();
          }
        }}
      >
        {queue.map((entry, at) => (
          <QueueRow
            key={`${entry.album ?? ""} ${entry.artist ?? ""}`}
            entry={entry}
            selected={at === index}
            onSelect={() => onSelect(at)}
          />
        ))}
      </div>
    </div>
  );
}

function QueueRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ReviewEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  // The candidate the score was measured on: `pass.rs` fetches the first
  // result and queues what it decided about that one.
  const best = entry.candidates?.[0] ?? null;
  const disagrees = best !== null && best.trackCount !== entry.trackIds.length;
  const album = entry.album ?? "No album";

  return (
    <div
      role="option"
      aria-selected={selected}
      // Roving, so Tab walks past the queue rather than through four hundred
      // rows of it.
      tabIndex={selected ? 0 : -1}
      className={selected ? "selected" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className={`lookup-queue-score${disagrees ? " disagrees" : ""}`}>
        {entry.score === null ? "—" : percent(entry.score)}
      </span>
      <span className="lookup-queue-album" title={album}>
        {album}
      </span>
    </div>
  );
}

/** The year, the country and the format - what tells two pressings apart. */
function describe(candidate: ReleaseCandidate): string {
  const parts = [
    candidate.date?.slice(0, 4),
    candidate.country,
    candidate.format,
    candidate.discCount > 1
      ? `${candidate.discCount}×${candidate.trackCount} tracks`
      : `${candidate.trackCount} tracks`,
  ];
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
}

/**
 * What the pane says while it is waiting, and how far along the rail is.
 *
 * No spinner, which is the sheet's own instruction, and no measured fraction
 * either - a search has no progress to report. The rail counts the four steps
 * to a drawn mapping: the files, the candidates, the tracklist, the mapping
 * itself. The sheet draws the first of them at 25%.
 */
const PENDING: Partial<Record<Stage, { ratio: number; said: string }>> = {
  opening: { ratio: 0.25, said: "Reading your files…" },
  searching: { ratio: 0.5, said: "Searching MusicBrainz…" },
  fetching: { ratio: 0.75, said: "Reading the tracklist…" },
};

/**
 * The selected release, in three regions: what it is, where the tags would
 * come from, and which file gets which track.
 *
 * The mapping waits for a tracklist, unlike section 6f, which draws the file
 * column in every state: the files alone are a list with nothing to compare
 * them against.
 */
function Pane({
  release,
  tracks,
  stage,
  candidates,
  detail,
  assignment,
  fields,
  busy,
  willWrite,
  onPick,
  onFields,
  onSwap,
}: {
  release: ReviewEntry;
  tracks: Track[];
  stage: Stage;
  candidates: ReleaseCandidate[];
  detail: ReleaseDetail | null;
  assignment: Assignment;
  fields: Fields;
  busy: boolean;
  willWrite: number;
  onPick: (mbid: string) => void;
  onFields: (fields: Fields) => void;
  onSwap: (row: number, other: number) => void;
}) {
  const waiting = PENDING[stage] ?? null;

  return (
    <div className="lookup-pane">
      <p className="lookup-subject">
        <strong>{release.album ?? "No album"}</strong>
        <span className="lookup-subject-detail">
          {`— ${release.artist ?? "No artist"} · `}
          {detail === null
            ? `${tracks.length} file${tracks.length === 1 ? "" : "s"}`
            : `${willWrite} of ${tracks.length} files mapped`}
        </span>
      </p>

      <Source
        stage={stage}
        tracks={tracks}
        candidates={candidates}
        detail={detail}
        fields={fields}
        onPick={onPick}
        onFields={onFields}
      />

      {detail === null ? null : (
        <Mapping
          tracks={tracks}
          detail={detail}
          assignment={assignment}
          fields={fields}
          busy={busy}
          onSwap={onSwap}
        />
      )}

      {waiting === null ? (
        <p className="lookup-note">
          {detail === null
            ? "Pick the release these files came from."
            : `The release identifiers are written to every song of this release; the ticked fields to the ${willWrite} mapped above.`}
        </p>
      ) : (
        // A div, not the paragraph beside it: `ProgressBar` is a div, and a
        // div inside a `<p>` is markup no parser keeps in one piece.
        <div className="lookup-note lookup-waiting">
          <ProgressBar ratio={waiting.ratio} width={RAIL} />
          {waiting.said}
        </div>
      )}
    </div>
  );
}

/**
 * Where the tags would come from: the candidates until one is picked, then the
 * two covers and the fields that release would write.
 *
 * One region in two states rather than two screens. Picking is a rate-limited
 * fetch, so it stays a click the user makes: a pane that fetched the top
 * candidate as the selection moved would spend a request per arrow key.
 */
function Source({
  stage,
  tracks,
  candidates,
  detail,
  fields,
  onPick,
  onFields,
}: {
  stage: Stage;
  tracks: Track[];
  candidates: ReleaseCandidate[];
  detail: ReleaseDetail | null;
  fields: Fields;
  onPick: (mbid: string) => void;
  onFields: (fields: Fields) => void;
}) {
  if (detail === null) {
    if (candidates.length > 0) {
      return (
        <ul className="lookup-results">
          {candidates.map((candidate) => (
            <li key={candidate.mbid}>
              <button
                type="button"
                className="lookup-result"
                onClick={() => onPick(candidate.mbid)}
              >
                <span className="lookup-result-title" title={candidate.title}>
                  {candidate.title}
                </span>
                <span className="lookup-result-artist" title={candidate.artist}>
                  {candidate.artist}
                </span>
                <span className="lookup-result-detail">{describe(candidate)}</span>
                {/* Sorted by, so it earns a column rather than a tooltip: it is
                    what says the second result fits the files better than the
                    first one's title match suggests. */}
                <span className="lookup-result-score">{percent(candidate.score)}</span>
              </button>
            </li>
          ))}
        </ul>
      );
    }
    if (stage === "results") {
      return (
        <p className="lookup-note">
          MusicBrainz has nothing under that album and artist. Take another release out of the
          queue, or edit the tags by hand and search again.
        </p>
      );
    }
    return null;
  }

  // Whatever the selected files already share, so the fetched cover is judged
  // against the one it would replace rather than on its own.
  const commonCover = tracks.every((track) => track.cover_hash === tracks[0]?.cover_hash)
    ? (tracks[0]?.cover_hash ?? null)
    : null;

  return (
    <>
      <div className="lookup-covers">
        <Art
          label="Current"
          src={commonCover === null ? null : coverUrl(commonCover)}
          note={commonCover === null ? "Missing or mixed" : null}
        />
        <Art
          label="MusicBrainz"
          // The staging file has one name for every image the app is about to
          // write, so the release id is what tells the webview these are not
          // the bytes it fetched for the last one.
          src={detail.coverPath === null ? null : stagedCoverUrl(detail.candidate.mbid)}
          note={detail.coverPath === null ? "No artwork in the archive" : null}
        />
      </div>

      <fieldset className="lookup-fields">
        <legend className="lookup-eyebrow">Write</legend>
        {LOOKUP_FIELDS.map((field) => (
          <Checkbox
            key={field.id}
            label={field.label}
            // Nothing in the archive is nothing to write, so the box says so
            // rather than sitting there ticked over an empty square.
            checked={fields[field.id] && !(field.id === "artwork" && detail.coverPath === null)}
            disabled={field.id === "artwork" && detail.coverPath === null}
            onChange={(checked) => onFields({ ...fields, [field.id]: checked })}
          />
        ))}
      </fieldset>
    </>
  );
}

/**
 * Which file gets which track.
 *
 * A table, although the sheet draws a three-column grid: file against
 * MusicBrainz is what a table is for, and `table-layout: fixed` states the
 * sheet's `1fr 62px 1fr` without giving up the row and the column a reader
 * gets told about.
 *
 * Rows the apply would leave as they are fold away under the rest, so the
 * rows worth reading are the only ones open. The groups are drawn
 * from the live assignment and fields, so a swap or a tick can move a row
 * between them, and each group's arrows swap within it: a file that already
 * reads as its track is not the other half of anybody's fix.
 */
function Mapping({
  tracks,
  detail,
  assignment,
  fields,
  busy,
  onSwap,
}: {
  tracks: Track[];
  detail: ReleaseDetail;
  assignment: Assignment;
  fields: Fields;
  busy: boolean;
  onSwap: (row: number, other: number) => void;
}) {
  const discs = tracks.some((track) => (track.disc_no ?? 1) > 1);
  const changed: MapRow[] = [];
  const unchanged: MapRow[] = [];
  tracks.forEach((track, row) => {
    const at = assignment[row];
    const remote = at === null || at === undefined ? null : (detail.tracks[at] ?? null);
    (remote !== null && agrees(track, remote, fields) ? unchanged : changed).push({
      track,
      row,
      remote,
    });
  });

  const rowsOf = (group: MapRow[]) =>
    group.map(({ track, row, remote }, at) => {
      const above = group[at - 1]?.row;
      const below = group[at + 1]?.row;
      const name = track.title ?? fileNameOf(track.path);
      return (
        <tr key={track.id} className={remote === null ? "unmapped" : undefined}>
          <td>
            <span className="lookup-map-title">
              {track.track_no === null
                ? "— "
                : `${discs ? `${track.disc_no ?? 1}-` : ""}${track.track_no}. `}
              {name}
            </span>
            <span className="lookup-map-detail">{formatDuration(track.duration_ms)}</span>
          </td>
          <td className="lookup-map-move">
            <IconButton
              icon="move-up"
              place="nudge"
              label={`Move up: ${name}`}
              disabled={above === undefined || busy}
              onClick={() => {
                if (above !== undefined) {
                  onSwap(row, above);
                }
              }}
            />
            <IconButton
              icon="move-down"
              place="nudge"
              label={`Move down: ${name}`}
              disabled={below === undefined || busy}
              onClick={() => {
                if (below !== undefined) {
                  onSwap(row, below);
                }
              }}
            />
          </td>
          <td>
            <RemoteCell detail={detail} file={track} remote={remote} fields={fields} />
          </td>
        </tr>
      );
    });

  return (
    <>
      <table className="lookup-map">
        <Columns />
        <thead>
          <tr>
            {/* Both counts in the heads, so a release with a file too many or a
                track too few reads off them before a row is compared. */}
            <th scope="col" className="lookup-eyebrow">
              {`File · ${tracks.length}`}
            </th>
            <th scope="col">
              <span className="visually-hidden">Reorder</span>
            </th>
            <th scope="col" className="lookup-eyebrow">
              {`MusicBrainz · ${detail.tracks.length}`}
            </th>
          </tr>
        </thead>
        <tbody>{rowsOf(changed)}</tbody>
      </table>
      {/* A table of its own, because a disclosure cannot wrap a `<tbody>`.
          Closed on every release, since the mapping remounts with each
          tracklist. */}
      {unchanged.length === 0 ? null : (
        <details className="lookup-unchanged">
          <summary className="lookup-eyebrow">{`Unchanged · ${unchanged.length}`}</summary>
          <table className="lookup-map" aria-label="Unchanged">
            <Columns />
            <tbody>{rowsOf(unchanged)}</tbody>
          </table>
        </details>
      )}
    </>
  );
}

/** The column widths, stated on both tables so their rows line up. */
function Columns() {
  return (
    <colgroup>
      <col />
      <col className="lookup-map-move-col" />
      <col />
    </colgroup>
  );
}

/** `row` is the file's index in the selection, which is what `onSwap` takes. */
type MapRow = { track: Track; row: number; remote: RemoteTrack | null };

/**
 * The MusicBrainz half of a mapping row, with what an apply would change in
 * the accent. Numbers are marked whole; text only where it differs. The file half beside it is the old value, so the colour only
 * points at a difference the row already shows.
 */
function RemoteCell({
  detail,
  file,
  remote,
  fields,
}: {
  detail: ReleaseDetail;
  file: Track;
  remote: RemoteTrack | null;
  fields: Fields;
}) {
  if (remote === null) {
    return <span className="lookup-map-detail">Nothing to write</span>;
  }

  const changed = differences(file, remote, fields);
  // A disc a single-disc release would write is still a change, so it is
  // drawn whenever it is one.
  const disc = detail.candidate.discCount > 1 || changed.discNo;
  const artist = remote.artist !== detail.albumArtist || changed.artist;

  return (
    <>
      <span className="lookup-map-title">
        {disc ? <Mark on={changed.discNo}>{`${remote.discNo}-`}</Mark> : null}
        <Mark on={changed.trackNo}>{String(remote.trackNo)}</Mark>
        {". "}
        <Diff from={file.title ?? ""} to={remote.title} on={changed.title} />
      </span>
      <span className="lookup-map-detail">
        {remote.durationMs === null ? "—" : formatDuration(remote.durationMs)}
        {artist ? " · " : null}
        {artist ? <Diff from={file.artist ?? ""} to={remote.artist} on={changed.artist} /> : null}
      </span>
    </>
  );
}

function Mark({ on, children }: { on: boolean; children: string }) {
  return on ? <span className="lookup-map-changed">{children}</span> : children;
}

/** A changed value with only the stretches the old one lacked marked. */
function Diff({ from, to, on }: { from: string; to: string; on: boolean }) {
  if (!on) {
    return to;
  }
  return changedRuns(from, to).map((run) =>
    run.changed ? (
      <span key={run.start} className="lookup-map-changed">
        {run.text}
      </span>
    ) : (
      <Fragment key={run.start}>{run.text}</Fragment>
    ),
  );
}

function Art({ label, src, note }: { label: string; src: string | null; note: string | null }) {
  return (
    <figure className="lookup-cover">
      {src === null ? (
        <div className="tag-cover-art tag-cover-art-empty" aria-hidden="true" />
      ) : (
        <img className="tag-cover-art" src={src} alt="" />
      )}
      <figcaption>
        {label}
        {note === null ? null : <span className="tag-cover-note">{note}</span>}
      </figcaption>
    </figure>
  );
}
