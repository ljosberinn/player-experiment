import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useState } from "react";
import {
  coverUrl,
  type ReleaseCandidate,
  type ReleaseDetail,
  stagedCoverUrl,
  type Track,
  type WriteProgress,
} from "../../ipc";
import { fileNameOf, formatDuration } from "../../lib/format";
import {
  type Assignment,
  buildEdits,
  defaultAssignment,
  type Fields,
  LOOKUP_FIELDS,
  mappedCount,
  swapAssignment,
} from "./mapping";
import { type Stage, useTagsourceStore } from "./store";

/**
 * The release lookup: search MusicBrainz, pick a release, confirm what it
 * writes.
 *
 * Mp3tag's flow, because it is the right one. A lookup is a suggestion about
 * files the user has already got, so nothing is written before the tracklist
 * has been shown next to the files it would rename, field by field.
 *
 * One release at a time, in a queue. A selection is grouped by album and album
 * artist before anything leaves the machine - 65,535 tracks are some 8,000
 * releases, and MusicBrainz allows one request a second, so the release is the
 * unit a lookup is worth doing at.
 */
export function ReleaseLookup() {
  const queue = useTagsourceStore((s) => s.queue);
  const index = useTagsourceStore((s) => s.index);
  const fromReview = useTagsourceStore((s) => s.fromReview);
  const tracks = useTagsourceStore((s) => s.tracks);
  const stage = useTagsourceStore((s) => s.stage);
  const candidates = useTagsourceStore((s) => s.candidates);
  const detail = useTagsourceStore((s) => s.detail);
  const fields = useTagsourceStore((s) => s.fields);
  const setFields = useTagsourceStore((s) => s.setFields);
  const progress = useTagsourceStore((s) => s.progress);
  const error = useTagsourceStore((s) => s.error);
  const close = useTagsourceStore((s) => s.close);
  const skip = useTagsourceStore((s) => s.skip);
  const setAside = useTagsourceStore((s) => s.setAside);
  const search = useTagsourceStore((s) => s.search);
  const pick = useTagsourceStore((s) => s.pick);
  const back = useTagsourceStore((s) => s.back);
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

  const release = queue?.[index];
  if (queue === undefined || queue === null || release === undefined) {
    return null;
  }

  const busy = stage === "applying";

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        // A write in flight cannot be called off - files are already on disk.
        if (!open && !busy) {
          close();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="modal lookup">
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>
            {queue.length === 1
              ? "Get Tags from MusicBrainz"
              : `Get Tags from MusicBrainz — release ${index + 1} of ${queue.length}`}
          </Dialog.Title>
          <p className="lookup-subject">
            <strong>{release.album ?? "No album"}</strong>
            {" — "}
            {release.artist ?? "No artist"}
            {` (${tracks.length} selected)`}
          </p>

          {detail === null ? (
            <Results
              stage={stage}
              candidates={candidates}
              onPick={(mbid) => void pick(mbid)}
              onSearchAgain={() => void search()}
            />
          ) : (
            <Confirm
              // Keyed on the release, so picking a different candidate starts
              // from its own mapping rather than inheriting the last one's.
              key={detail.candidate.mbid}
              tracks={tracks}
              detail={detail}
              fields={fields}
              progress={progress}
              busy={busy}
              onFields={setFields}
              onApply={(assignment) => void apply(buildEdits(tracks, detail, assignment, fields))}
              onBack={back}
            />
          )}

          {error === null ? null : (
            <p className="content-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" disabled={busy} />}>Cancel</Dialog.Close>
            {/* Only on the review queue, which is the only queue an entry
                persists in. On a selection there is nothing to set aside: the
                queue dies with the dialog. */}
            {fromReview ? (
              <button
                type="button"
                disabled={busy}
                title="Take this release out of the review queue"
                onClick={() => void setAside()}
              >
                Set Aside
              </button>
            ) : null}
            {/* Skip means "not now". On the review queue the release is
                offered again next time it is opened, which is what makes Set
                Aside beside it a different decision rather than a louder one. */}
            <button type="button" disabled={busy} onClick={() => void skip()}>
              {index + 1 < queue.length ? "Skip Release" : "Skip"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A score as the two digits that fit beside a result. */
function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
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

function Results({
  stage,
  candidates,
  onPick,
  onSearchAgain,
}: {
  stage: Stage;
  candidates: ReleaseCandidate[];
  onPick: (mbid: string) => void;
  onSearchAgain: () => void;
}) {
  if (stage === "opening") {
    return <p className="modal-summary">Reading the files…</p>;
  }
  if (stage === "searching") {
    return <p className="modal-summary">Searching MusicBrainz…</p>;
  }
  if (stage === "fetching") {
    return <p className="modal-summary">Reading the tracklist…</p>;
  }
  if (candidates.length === 0) {
    return (
      <>
        <p className="modal-summary">
          MusicBrainz has nothing under that album and artist. Skip this release, or edit the tags
          by hand and try again.
        </p>
        <SearchAgain onSearchAgain={onSearchAgain} />
      </>
    );
  }

  return (
    <>
      <ul className="lookup-results">
        {candidates.map((candidate) => (
          <li key={candidate.mbid}>
            <button type="button" className="lookup-result" onClick={() => onPick(candidate.mbid)}>
              <span className="lookup-result-title">{candidate.title}</span>
              <span className="lookup-result-artist">{candidate.artist}</span>
              <span className="lookup-result-detail">{describe(candidate)}</span>
              {/* Sorted by, so it earns a column rather than a tooltip: it is
                  what says the second result fits the files better than the
                  first one's title match suggests. */}
              <span className="lookup-result-score">{percent(candidate.score)}</span>
            </button>
          </li>
        ))}
      </ul>
      <SearchAgain onSearchAgain={onSearchAgain} />
    </>
  );
}

/**
 * The way out of a stale result list.
 *
 * The review queue opens on the candidates the unattended pass found, which
 * may be weeks old and were found from tags that have since been edited. They
 * are a cache, and a cache with no way to refresh it is a worse answer than a
 * slow one - so this sits under every result list, including the empty one.
 */
function SearchAgain({ onSearchAgain }: { onSearchAgain: () => void }) {
  return (
    <p className="lookup-refresh">
      <button type="button" className="link-button" onClick={onSearchAgain}>
        Search again
      </button>
    </p>
  );
}

function Confirm({
  tracks,
  detail,
  fields,
  progress,
  busy,
  onFields,
  onApply,
  onBack,
}: {
  tracks: Track[];
  detail: ReleaseDetail;
  fields: Fields;
  progress: WriteProgress | null;
  busy: boolean;
  onFields: (fields: Fields) => void;
  onApply: (assignment: Assignment) => void;
  onBack: () => void;
}) {
  const [assignment, setAssignment] = useState<Assignment>(() =>
    defaultAssignment(tracks, detail.tracks),
  );

  const willWrite = mappedCount(assignment);
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
        <legend>Write</legend>
        {LOOKUP_FIELDS.map((field) => (
          <FieldToggle
            key={field.id}
            label={field.label}
            checked={fields[field.id]}
            // Nothing in the archive is nothing to write, so the box says so
            // rather than sitting there ticked over an empty square.
            disabled={field.id === "artwork" && detail.coverPath === null}
            onChange={(checked) => onFields({ ...fields, [field.id]: checked })}
          />
        ))}
      </fieldset>

      {/* Its own scroll area, so a 22-track reissue does not push the buttons
          that confirm it off the bottom of the dialog. */}
      <div className="lookup-map-scroll">
        <table className="lookup-map">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">
                <span className="visually-hidden">Reorder</span>
              </th>
              <th scope="col">MusicBrainz</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, row) => {
              const at = assignment[row];
              const remote = at === null || at === undefined ? null : detail.tracks[at];
              return (
                <tr
                  key={track.id}
                  className={remote === undefined || remote === null ? "unmapped" : undefined}
                >
                  <td>
                    <span className="lookup-map-title">
                      {track.title ?? fileNameOf(track.path)}
                    </span>
                    <span className="lookup-map-detail">{formatDuration(track.duration_ms)}</span>
                  </td>
                  <td className="lookup-map-move">
                    <button
                      type="button"
                      aria-label={`Move up: ${track.title ?? fileNameOf(track.path)}`}
                      disabled={row === 0 || busy}
                      onClick={() =>
                        setAssignment((current) => swapAssignment(current, row, row - 1))
                      }
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move down: ${track.title ?? fileNameOf(track.path)}`}
                      disabled={row === tracks.length - 1 || busy}
                      onClick={() =>
                        setAssignment((current) => swapAssignment(current, row, row + 1))
                      }
                    >
                      ▼
                    </button>
                  </td>
                  <td>
                    {remote === undefined || remote === null ? (
                      <span className="lookup-map-detail">Nothing to write</span>
                    ) : (
                      <>
                        <span className="lookup-map-title">
                          {detail.candidate.discCount > 1 ? `${remote.discNo}-` : ""}
                          {remote.trackNo}. {remote.title}
                        </span>
                        <span className="lookup-map-detail">
                          {remote.durationMs === null ? "—" : formatDuration(remote.durationMs)}
                          {remote.artist === detail.albumArtist ? "" : ` · ${remote.artist}`}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="modal-summary">
        {busy
          ? progress === null || progress.total === 0
            ? "Writing…"
            : `Writing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…`
          : `The release identifiers are written to every song of this release; the ticked fields to the ${willWrite} mapped above.`}
      </p>

      <div className="modal-actions lookup-confirm-actions">
        <button type="button" disabled={busy} onClick={onBack}>
          Back to Results
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || willWrite === 0}
          onClick={() => onApply(assignment)}
        >
          {busy ? "Writing…" : "Apply"}
        </button>
      </div>
    </>
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

function FieldToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="lookup-field">
      <input
        id={id}
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}
