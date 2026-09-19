import { Dialog } from "@base-ui/react/dialog";
import { useId, useState } from "react";
import { GenreCombobox } from "../../../components/ui/GenreCombobox";
import { useStatsStore } from "../store";

/**
 * Where one genre belongs, when the tree guessed wrong.
 *
 * The Statistics view's only writer. The primary parent is arbitrary wherever
 * a genre has several - nothing makes black metal more the parent of blackened
 * death metal than death metal is - and the suffix derivation below that is
 * guesswork outright. This is what makes a labelled guess a correctable one.
 *
 * **Both fields are free text and the refusal is the guard.** 6,575 labels is
 * too many to pick from blind, and `set_override` refuses a cycle and a parent
 * no layer of the tree knows, by name, where no caller can skip either. What
 * comes back is written to be read, so it is shown here rather than reported
 * to the status bar - a message about what was just typed belongs beside the
 * field it was typed into.
 *
 * Leaving the parent empty is the correction "this genre is a root", which is
 * not the same act as Clear: one is a correction, the other forgets one.
 */
export function GenreOverrideDialog({
  genre,
  onClose,
}: {
  /** The genre to correct - the slice that was clicked, or the drilled level. */
  genre: string;
  onClose: () => void;
}) {
  const setOverride = useStatsStore((s) => s.setOverride);
  const clearOverride = useStatsStore((s) => s.clearOverride);
  const [label, setLabel] = useState(genre);
  const [parent, setParent] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const parentId = useId();

  // No `finally`: the React Compiler cannot lower one, and `panicThreshold`
  // is `all_errors`, so the build fails rather than silently skipping this
  // component. Both arms clear the flag instead.
  const attempt = async (write: () => Promise<void>) => {
    setSaving(true);
    setRefusal(null);
    try {
      await write();
      setSaving(false);
      onClose();
    } catch (cause) {
      // Left open on a refusal: closing would take away the field the message
      // is about, and the correction is one word from being right.
      setSaving(false);
      setRefusal(String(cause));
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className="modal"
          render={
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (label.trim() !== "" && !saving) {
                  // An empty parent is `null`, not `""`: the first is "this
                  // genre is a root" and the second is a label nothing knows.
                  void attempt(() =>
                    setOverride(label.trim(), parent.trim() === "" ? null : parent.trim()),
                  );
                }
              }}
            />
          }
        >
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>Where this genre belongs</Dialog.Title>

          <label className="modal-field" htmlFor={labelId}>
            Genre
            <GenreCombobox id={labelId} value={label} onChange={setLabel} />
          </label>

          <label className="modal-field" htmlFor={parentId}>
            Belongs under
            <GenreCombobox
              id={parentId}
              value={parent}
              placeholder="Nothing — this genre is a root"
              onChange={setParent}
            />
          </label>

          {refusal !== null && (
            <p className="modal-summary modal-refusal" role="alert">
              {refusal}
            </p>
          )}

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" />}>Cancel</Dialog.Close>
            <button
              type="button"
              onClick={() => void attempt(() => clearOverride(label.trim()))}
              disabled={saving || label.trim() === ""}
            >
              Forget Correction
            </button>
            <button type="submit" className="primary" disabled={saving || label.trim() === ""}>
              Save
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
