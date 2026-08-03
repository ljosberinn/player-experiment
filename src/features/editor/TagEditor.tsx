import { Dialog } from "@base-ui/react/dialog";
import { useId, useState } from "react";
import { type CoverEdit, coverUrl, type TagEdit, type Track } from "../../ipc";
import { commonValue, type Draft, FIELDS, hasChanges, numericProblem, toEdit } from "./fields";

/**
 * The tag editor, for one track or five hundred.
 *
 * There is no separate single-track mode: one track is a selection of one, and
 * a second code path for it would be two chances to get the write semantics
 * wrong instead of one.
 */
export function TagEditor({
  tracks,
  onSave,
  onCancel,
  onPickCover,
}: {
  tracks: Track[];
  onSave: (edit: TagEdit) => void;
  onCancel: () => void;
  /** Opens the OS picker; resolves to a path, or null if dismissed. */
  onPickCover: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [cover, setCover] = useState<CoverEdit | null>(null);

  const problem = numericProblem(draft);
  const canSave = problem === null && hasChanges(draft, cover);
  const commonCover = tracks.every((track) => track.cover_hash === tracks[0]?.cover_hash)
    ? (tracks[0]?.cover_hash ?? null)
    : null;

  return (
    // Open on render: the caller decides whether the editor is up, so there is
    // no trigger. Escape is the library's, and Enter-to-save is a real form
    // submit - which is what `useDialogKeys`' BUTTON/SELECT/TEXTAREA exclusion
    // list was approximating by hand.
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
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
                if (canSave) {
                  onSave({ ...toEdit(draft), cover });
                }
              }}
            />
          }
        >
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>
            {tracks.length === 1 ? "Get Info" : `Get Info — ${tracks.length} songs`}
          </Dialog.Title>

          <div className="tag-grid">
            {FIELDS.map((field) => {
              const common = commonValue(tracks, field);
              const touched = draft[field.id] !== undefined;
              return (
                <TagField
                  key={field.id}
                  label={field.label}
                  // A mixed field shows nothing and says so in its placeholder;
                  // typing into it is what opts every selected track in.
                  value={draft[field.id] ?? (common.kind === "same" ? common.value : "")}
                  placeholder={common.kind === "mixed" ? "Mixed" : ""}
                  touched={touched}
                  onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
                />
              );
            })}
          </div>

          <div className="tag-cover">
            {cover?.kind === "replace" ? (
              <span className="tag-cover-note">New artwork selected.</span>
            ) : cover?.kind === "remove" ? (
              <span className="tag-cover-note">Artwork will be removed.</span>
            ) : commonCover ? (
              <img className="status-cover" src={coverUrl(commonCover)} alt="" />
            ) : (
              <span className="tag-cover-note">
                {tracks.length === 1 ? "No artwork." : "Artwork differs or is missing."}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                void onPickCover().then((path) => {
                  if (path !== null) {
                    setCover({ kind: "replace", path });
                  }
                });
              }}
            >
              Choose Artwork…
            </button>
            <button type="button" onClick={() => setCover({ kind: "remove" })}>
              Remove Artwork
            </button>
            {cover === null ? null : (
              <button type="button" onClick={() => setCover(null)}>
                Keep Existing
              </button>
            )}
          </div>

          {problem ? (
            <p className="content-error" role="alert">
              {problem}
            </p>
          ) : null}

          <p className="modal-summary">
            {tracks.length === 1
              ? "Blank a field to clear it."
              : "Only the fields you change are written; the rest are left as they are."}
          </p>

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" />}>Cancel</Dialog.Close>
            {/* A submit button, so Enter anywhere in the form saves - and does
                nothing when the form cannot be saved, without a key handler
                having to decide which elements to keep its hands off. */}
            <button type="submit" className="primary" disabled={!canSave}>
              Save
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TagField({
  label,
  value,
  placeholder,
  touched,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  touched: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        // Marked so it is visible at a glance which fields a save will write,
        // which matters most when the selection is large.
        className={touched ? "touched" : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </>
  );
}
