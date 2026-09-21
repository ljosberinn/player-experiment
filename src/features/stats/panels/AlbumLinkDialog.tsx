import { useId, useState } from "react";
import { Button } from "../../../components/primitives/Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from "../../../components/primitives/Dialog";
import { Select } from "../../../components/primitives/Select";
import { statsAlbumGroup } from "../../../ipc";
import { useStatsStore } from "../store";
import { usePanelQuery } from "../usePanelQuery";

/**
 * Which spellings of an album are one record, when the fold guessed wrong.
 *
 * A play keeps the album as it was scrobbled, and a streaming service renames
 * a release between one scrobble and the next. `db::plays::album_key` folds
 * the five causes a real log shows and deliberately stops there, so it is
 * both incomplete and occasionally wrong - which is why every group is
 * editable, the way `GenreOverrideDialog` makes the genre tree editable.
 *
 * **The three corrections are one write.** Pin every spelling with a new
 * title and the group is retitled; pin one with its own and it leaves the
 * group; pin a neighbour's spellings with this heading and it is merged in.
 * A second mechanism would be a second thing to be wrong about.
 *
 * The heading is free text and the refusal is the guard, for the reason the
 * genre dialog gives: what comes back is written to be read, so it is shown
 * beside the field it is about rather than in the status bar.
 */
export function AlbumLinkDialog({
  heading,
  onClose,
  onRenamed,
}: {
  /** The album the panel is drilled into - a heading, which is its identity. */
  heading: string;
  onClose: () => void;
  /**
   * Called when the group now reads under a different heading.
   *
   * The crumb that opened this names the old one, and a drill-down on a
   * heading nothing reads under is an empty tab.
   */
  onRenamed: (heading: string) => void;
}) {
  const pinAlbum = useStatsStore((s) => s.pinAlbum);
  const [title, setTitle] = useState(heading);
  const [merging, setMerging] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const mergeId = useId();

  const { data } = usePanelQuery(() => statsAlbumGroup(heading), [heading]);
  const group = data;

  // No `finally`: the React Compiler cannot lower one, and `panicThreshold`
  // is `all_errors`. Both arms clear the flag instead - see
  // `GenreOverrideDialog`.
  const attempt = async (spellings: readonly string[], to: string, renamed: boolean) => {
    setSaving(true);
    setRefusal(null);
    try {
      await pinAlbum(group?.artist ?? "", spellings, to);
      setSaving(false);
      if (renamed) {
        onRenamed(to);
      }
      onClose();
    } catch (cause) {
      // Left open on a refusal: closing would take away the field the message
      // is about.
      setSaving(false);
      setRefusal(String(cause));
    }
  };

  const members = group?.members ?? [];
  const others = group?.others ?? [];
  const neighbour = others.find((other) => other.heading === merging);

  return (
    <Dialog
      onClose={onClose}
      onSubmit={() => {
        const wanted = title.trim();
        if (wanted !== "" && !saving && members.length > 0) {
          void attempt(
            members.map((member) => member.album),
            wanted,
            wanted !== heading,
          );
        }
      }}
    >
      <DialogHeader title="How this album is grouped" />

      <DialogBody>
        <label className="dialog-field" htmlFor={titleId}>
          Shown as
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        {members.length > 0 && (
          <ul className="dialog-list">
            {members.map((member) => (
              <li key={member.album}>
                <span className="dialog-list-label">{member.album}</span>
                <span className="dialog-list-value">{member.plays.toLocaleString()}</span>
                {/* The last spelling has nothing to be separated from. */}
                <Button
                  onClick={() => void attempt([member.album], member.album, false)}
                  disabled={saving || members.length === 1}
                >
                  Separate
                </Button>
              </li>
            ))}
          </ul>
        )}

        {others.length > 0 && (
          <label className="dialog-field" htmlFor={mergeId}>
            Merge in
            <Select
              id={mergeId}
              value={merging}
              options={[
                { value: "", label: "Nothing — this album stands alone" },
                ...others.map((other) => ({
                  value: other.heading,
                  label: `${other.heading} (${other.plays.toLocaleString()})`,
                })),
              ]}
              onChange={setMerging}
            />
          </label>
        )}

        {refusal !== null && (
          <p className="dialog-summary dialog-refusal" role="alert">
            {refusal}
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <DialogClose>Cancel</DialogClose>
        <Button
          onClick={() => {
            if (neighbour !== undefined) {
              void attempt(neighbour.albums, heading, false);
            }
          }}
          disabled={saving || neighbour === undefined}
        >
          Merge
        </Button>
        <Button
          kind="primary"
          type="submit"
          disabled={saving || title.trim() === "" || members.length === 0}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
