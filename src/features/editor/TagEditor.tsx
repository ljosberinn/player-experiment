import { useEffect, useEffectEvent, useId, useState } from "react";
import { Button } from "../../components/primitives/Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogStatus,
} from "../../components/primitives/Dialog";
import { TagCombobox } from "../../components/ui/TagCombobox";
import {
  type CoverEdit,
  coverUrl,
  stagedCoverUrl,
  type TagEdit,
  type TagValueField,
  type Track,
} from "../../ipc";
import { registerDropTarget } from "../shell/fileDrop";
import { commonValue, type Draft, FIELDS, hasChanges, numericProblem, toEdit } from "./fields";
import { useEditorStore } from "./store";
import { WriteLine } from "./WriteLine";

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
  onDropCover,
}: {
  tracks: Track[];
  onSave: (edit: TagEdit) => void;
  onCancel: () => void;
  /**
   * Opens the OS picker and stages what it returns; resolves to a path, null
   * if the picker was dismissed, or rejects with the sentence to show.
   */
  onPickCover: () => Promise<string | null>;
  /**
   * Stages an image dropped in from the OS; resolves to a path, or rejects
   * with the sentence to show.
   */
  onDropCover: (path: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [cover, setCover] = useState<CoverEdit | null>(null);
  /**
   * Why the last drop was refused, if it was.
   *
   * State rather than something derived the way `problem` is: a rejected drop
   * is an event, not a property of the draft. It reads out of the same line as
   * `problem` but is deliberately not part of `canSave` - an image the backend
   * would not take must not stop a typed field being written.
   */
  const [rejected, setRejected] = useState<string | null>(null);
  /**
   * How many images have been staged in this dialog.
   *
   * The staging file has one fixed name, so nothing about the URL changes
   * between two choices and the webview would go on showing the first. This is
   * what changes it.
   */
  const [staged, setStaged] = useState(0);
  /**
   * Whether a file dragged in from the OS is over the block.
   *
   * The only feedback there is: with `dragDropEnabled` on, the cursor says
   * "copy" over every part of the window whether or not anything there takes a
   * drop.
   */
  const [hovered, setHovered] = useState(false);
  /**
   * The block itself, as state rather than a ref: the dialog is portalled and
   * its content is not in the tree yet when this component's first effect runs,
   * so an effect reading a ref would register nothing.
   */
  const [coverBlock, setCoverBlock] = useState<HTMLDivElement | null>(null);

  /**
   * Takes whichever route chose an image.
   *
   * Both stage, both can be refused, and both end in the same two pieces of
   * state - so the picker and the drop differ only in what they hand over.
   */
  const choose = (staging: Promise<string | null>) => {
    setRejected(null);
    void staging.then(
      (path) => {
        if (path !== null) {
          setCover({ kind: "replace", path });
          setStaged((version) => version + 1);
        }
      },
      (error: unknown) => setRejected(String(error)),
    );
  };

  // The block takes OS file drops for as long as the dialog is up. Registered
  // once rather than per render: `fileDrop` keeps the hover state that goes
  // with the registration, and re-registering mid-drag would drop it.
  const dropped = useEffectEvent((paths: string[]) => {
    const [path] = paths;
    if (path !== undefined) {
      choose(onDropCover(path));
    }
  });
  useEffect(() => {
    if (coverBlock === null) {
      return;
    }
    return registerDropTarget({ element: coverBlock, onHover: setHovered, onDrop: dropped });
  }, [coverBlock]);

  // The dialog stays open across the write - a batch of 500 files is one mp3
  // rewritten after another, and a dialog that sits there saying nothing while
  // that happens is indistinguishable from a hung window.
  const saving = useEditorStore((s) => s.progress !== null);
  const problem = numericProblem(draft);
  const message = problem ?? rejected;
  const canSave = problem === null && hasChanges(draft, cover) && !saving;
  const commonCover = tracks.every((track) => track.cover_hash === tracks[0]?.cover_hash)
    ? (tracks[0]?.cover_hash ?? null)
    : null;
  /**
   * What goes in the square: the image about to be written if there is one,
   * and otherwise whatever the selection already shares.
   *
   * A pending *removal* keeps showing the art it is about to take away - the
   * caption is what says it is going.
   */
  const art =
    cover?.kind === "replace" ? stagedCoverUrl(staged) : commonCover ? coverUrl(commonCover) : null;
  // What the square cannot say for itself. Shared artwork and no pending
  // choice is the one state that needs no caption: the art is the answer.
  const coverNote =
    cover?.kind === "replace"
      ? "New artwork selected."
      : cover?.kind === "remove"
        ? "Artwork will be removed."
        : commonCover
          ? null
          : tracks.length === 1
            ? "No artwork."
            : "Artwork differs or is missing.";

  return (
    // Open on render: the caller decides whether the editor is up, so there is
    // no trigger. Escape is the library's, and Enter-to-save is a real form
    // submit - which is what `useDialogKeys`' BUTTON/SELECT/TEXTAREA exclusion
    // list was approximating by hand.
    <Dialog
      onSubmit={() => {
        if (canSave) {
          onSave({ ...toEdit(draft), cover });
        }
      }}
      onClose={() => {
        // A write in flight cannot be called off - files are already on disk -
        // so Escape and the backdrop stop closing the dialog while one runs.
        if (!saving) {
          onCancel();
        }
      }}
    >
      <DialogHeader title={tracks.length === 1 ? "Edit" : `Edit — ${tracks.length} songs`} />

      <DialogBody>
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
                suggest={field.suggest ?? null}
                onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              />
            );
          })}
        </div>

        <div ref={setCoverBlock} className={hovered ? "tag-cover drop-target" : "tag-cover"}>
          <div className="tag-cover-preview">
            {/* The square is drawn whether or not there is art to put in it,
                so the block keeps its shape as the selection changes and as a
                choice goes pending. A pending replacement is shown from the
                staging file rather than from the library, which is the whole
                reason both routes stage; the caption stays either way,
                because what the save will do is not something a picture
                says. */}
            {art === null ? (
              <div className="tag-cover-art tag-cover-art-empty" aria-hidden="true" />
            ) : (
              <img className="tag-cover-art" src={art} alt="" />
            )}
            {coverNote === null ? null : <span className="tag-cover-note">{coverNote}</span>}
          </div>
          <div className="tag-cover-actions">
            <Button onClick={() => choose(onPickCover())}>Choose Artwork…</Button>
            <Button onClick={() => setCover({ kind: "remove" })}>Remove Artwork</Button>
            {cover === null ? null : <Button onClick={() => setCover(null)}>Keep Existing</Button>}
          </div>
        </div>

        {message ? (
          <p className="content-error" role="alert">
            {message}
          </p>
        ) : null}
      </DialogBody>

      <DialogFooter
        lead={
          saving ? (
            <Writing />
          ) : tracks.length > 1 ? (
            <DialogStatus>Only changed fields are written.</DialogStatus>
          ) : undefined
        }
      >
        <DialogClose disabled={saving}>Cancel</DialogClose>
        {/* A submit button, so Enter anywhere in the form saves - and does
            nothing when the form cannot be saved, without a key handler
            having to decide which elements to keep its hands off. */}
        <Button kind="primary" type="submit" disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function TagField({
  label,
  value,
  placeholder,
  touched,
  suggest,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  touched: boolean;
  /** Which vocabulary to offer, or null for a field that has none. */
  suggest: TagValueField | null;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <TagCombobox
        id={id}
        field={suggest}
        value={value}
        placeholder={placeholder}
        // Marked so it is visible at a glance which fields a save will write,
        // which matters most when the selection is large. Picking a suggestion
        // is a change like any other, so it marks the field too.
        className={touched ? "touched" : undefined}
        onChange={onChange}
      />
    </>
  );
}

/**
 * The save's progress, subscribed here so a file landing re-renders the line
 * rather than the dialog.
 */
function Writing() {
  const progress = useEditorStore((s) => s.progress);
  return <WriteLine progress={progress} />;
}
