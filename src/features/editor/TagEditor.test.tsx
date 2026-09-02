import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TagEdit, Track } from "../../ipc";
import { suggestTagValues } from "../../ipc";
import { TagEditor } from "./TagEditor";

vi.mock("../../ipc", () => ({
  coverUrl: (hash: string) => `cover-url:${hash}`,
  stagedCoverUrl: (version: number) => `staged-cover-url:${version}`,
  suggestTagValues: vi.fn(async () => []),
}));

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: "/m/1.mp3",
    duration_ms: 1000,
    title: "Maki",
    artist: "Guitar",
    album: "Tokyo",
    album_artist: "Guitar",
    genre: "Shoegaze",
    year: 2012,
    track_no: 1,
    disc_no: null,
    comment: null,
    bitrate: null,
    sample_rate: null,
    cover_hash: null,
    added_at: 0,
    play_count: 0,
    last_played_at: null,
    missing_since: null,
    ...overrides,
  };
}

function open(
  tracks: Track[],
  pickedCover: string | null = null,
  progress: { done: number; total: number } | null = null,
) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onPickCover = vi.fn(async () => pickedCover);
  const onDropCover = vi.fn(async () => "C:/staged/dropped-cover.png");
  render(
    <TagEditor
      tracks={tracks}
      progress={progress}
      onSave={onSave}
      onCancel={onCancel}
      onPickCover={onPickCover}
      onDropCover={onDropCover}
    />,
  );
  return { onSave, onCancel, onPickCover, onDropCover, user: userEvent.setup() };
}

/**
 * A drag payload jsdom cannot make: it implements no `DataTransfer` at all,
 * so what the handlers read has to be handed to them.
 */
function dragPayload(types: string[], files: File[] = []) {
  return { types, files, getData: () => "" };
}

const jpeg = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], "cover.jpg", {
    type: "image/jpeg",
  });

/** The block that takes the drop, which is the whole artwork row. */
const coverBlock = () => document.querySelector(".tag-cover") as HTMLElement;

const savedEdit = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls.at(-1)?.[0] as TagEdit;

describe("TagEditor", () => {
  it("shows one track's values", () => {
    open([track()]);

    expect(screen.getByLabelText("Name")).toHaveValue("Maki");
    expect(screen.getByLabelText("Year")).toHaveValue("2012");
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();
  });

  it("says how many songs a bulk edit covers", () => {
    open([track(), track({ id: 2 })]);

    expect(screen.getByRole("dialog", { name: /2 songs/ })).toBeInTheDocument();
  });

  it("leaves a field the selection disagrees on empty, and says it is mixed", () => {
    open([track(), track({ id: 2, artist: "Grizzly Bear" })]);

    const artist = screen.getByLabelText("Artist");
    expect(artist).toHaveValue("");
    expect(artist).toHaveAttribute("placeholder", "Mixed");
    // A field they do agree on still shows the shared value.
    expect(screen.getByLabelText("Album")).toHaveValue("Tokyo");
  });

  it("writes only what was touched", async () => {
    const { onSave, user } = open([track(), track({ id: 2, artist: "Grizzly Bear" })]);

    await user.type(screen.getByLabelText("Genre"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const edit = savedEdit(onSave);
    expect(edit.genre).toBe("Shoegaze!");
    // The mixed artist and the untouched album both have to stay absent, or a
    // bulk edit would flatten every track to the first one's values.
    expect(edit.artist).toBeNull();
    expect(edit.album).toBeNull();
  });

  it("sends an emptied field as a clear, not as untouched", async () => {
    const { onSave, user } = open([track()]);

    await user.clear(screen.getByLabelText("Genre"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(savedEdit(onSave).genre).toBe("");
  });

  it("cannot be saved until something changes", async () => {
    const { user } = open([track()]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(screen.getByLabelText("Genre"), "x");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("refuses a number it can see is wrong, before the round trip", async () => {
    const { user } = open([track()]);

    await user.clear(screen.getByLabelText("Year"));
    await user.type(screen.getByLabelText("Year"), "twenty");

    expect(await screen.findByRole("alert")).toHaveTextContent("Year must be a number");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks the fields a save will write", async () => {
    const { user } = open([track()]);

    await user.type(screen.getByLabelText("Genre"), "x");

    expect(screen.getByLabelText("Genre")).toHaveClass("touched");
    expect(screen.getByLabelText("Album")).not.toHaveClass("touched");
  });

  it("attaches artwork the picker returned", async () => {
    const { onSave, onPickCover, user } = open([track()], "C:/art/cover.png");

    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));
    await screen.findByText("New artwork selected.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onPickCover).toHaveBeenCalled();
    expect(savedEdit(onSave).cover).toEqual({ kind: "replace", path: "C:/art/cover.png" });
  });

  it("changes nothing when the picker is dismissed", async () => {
    const { user } = open([track()], null);

    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("removes artwork, and can take that back before saving", async () => {
    const { onSave, user } = open([track()]);

    await user.click(screen.getByRole("button", { name: "Remove Artwork" }));
    expect(screen.getByText("Artwork will be removed.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep Existing" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the artwork when the whole selection shares it", () => {
    render(
      <TagEditor
        tracks={[track({ cover_hash: "abc" }), track({ id: 2, cover_hash: "abc" })]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onPickCover={vi.fn(async () => null)}
        onDropCover={vi.fn(async () => "")}
      />,
    );

    // Off `document` rather than the render container: the dialog is portalled
    // to the body now. The cover is decorative (`alt=""`), so it has no role to
    // query it by.
    expect(document.querySelector(".tag-cover-art")).toHaveAttribute("src", "cover-url:abc");
  });

  it("says artwork differs across a mixed selection", () => {
    open([track({ cover_hash: "abc" }), track({ id: 2, cover_hash: "def" })]);

    expect(screen.getByText(/Artwork differs/)).toBeInTheDocument();
  });

  // The square is the block's shape, so it is drawn in every state rather than
  // being one of the things the state picks between. Phase 51 drops a file on
  // it, which needs it to be there when there is no artwork to show.
  it("draws an empty square when a song has no artwork", () => {
    open([track({ cover_hash: null })]);

    const square = document.querySelector(".tag-cover-art");

    expect(square).toHaveClass("tag-cover-art-empty");
    expect(square).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the square while a removal is pending", async () => {
    const { user } = open([track({ cover_hash: "abc" })]);

    await user.click(screen.getByRole("button", { name: "Remove Artwork" }));

    expect(document.querySelector(".tag-cover-art")).toBeInTheDocument();
  });

  it("keeps the square while a replacement is pending", async () => {
    const { user } = open([track({ cover_hash: "abc" })], "C:/art/cover.png");

    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));
    await screen.findByText("New artwork selected.");

    expect(document.querySelector(".tag-cover-art")).toBeInTheDocument();
  });

  it("shows the staged image while a replacement is pending", async () => {
    const { user } = open([track({ cover_hash: "abc" })], "C:/cache/chosen-cover.png");

    // Until it is saved the art is not in the library and has no hash; what
    // the square shows is the staging file, over the same protocol.
    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));

    await waitFor(() =>
      expect(document.querySelector(".tag-cover-art")).toHaveAttribute("src", "staged-cover-url:1"),
    );
  });

  it("changes the URL for a second choice, since the file name never does", async () => {
    const { user } = open([track()], "C:/cache/chosen-cover.png");

    fireEvent.drop(coverBlock(), { dataTransfer: dragPayload(["Files"], [jpeg()]) });
    await waitFor(() =>
      expect(document.querySelector(".tag-cover-art")).toHaveAttribute("src", "staged-cover-url:1"),
    );

    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));

    // One staging file, one fixed name: without this the webview would go on
    // showing the first image for the rest of the dialog.
    await waitFor(() =>
      expect(document.querySelector(".tag-cover-art")).toHaveAttribute("src", "staged-cover-url:2"),
    );
  });

  it("keeps showing the library's art while a removal is pending", async () => {
    const { user } = open([track({ cover_hash: "abc" })]);

    await user.click(screen.getByRole("button", { name: "Remove Artwork" }));

    // The caption is what says it is going; hiding it too would leave the
    // dialog saying "will be removed" about nothing visible.
    expect(document.querySelector(".tag-cover-art")).toHaveAttribute("src", "cover-url:abc");
  });

  it("says why a picked image was refused, the same way a dropped one is", async () => {
    render(
      <TagEditor
        tracks={[track()]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        // Picking now stages too, so the picker can refuse - which it could
        // not before: an unreadable file used to fail at save time.
        onPickCover={vi.fn(() => Promise.reject("That image is 40 MB; the limit is 12 MB."))}
        onDropCover={vi.fn(async () => "")}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That image is 40 MB; the limit is 12 MB.",
    );
    expect(document.querySelector(".tag-cover-art")).toHaveClass("tag-cover-art-empty");
  });

  it("attaches an image dropped on the artwork", async () => {
    const { onSave, onDropCover, user } = open([track()]);

    fireEvent.drop(coverBlock(), { dataTransfer: dragPayload(["Files"], [jpeg()]) });

    await screen.findByText("New artwork selected.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The drop crosses as bytes and comes back a path, so what is saved is the
    // same shape the picker produces - `CoverEdit` never learns a drop
    // happened.
    expect(onDropCover).toHaveBeenCalledWith(expect.any(File));
    expect(savedEdit(onSave).cover).toEqual({
      kind: "replace",
      path: "C:/staged/dropped-cover.png",
    });
  });

  it("accepts a file drag and nothing else", () => {
    open([track()]);

    // The app's last HTML5 drop target, and deliberately so: a song dragged
    // out of the table is a pointer gesture that carries no `DataTransfer` at
    // all, so what is left to tell apart is a file from anything else.
    const file = fireEvent.dragOver(coverBlock(), {
      dataTransfer: dragPayload(["Files"]),
    });
    const text = fireEvent.dragOver(coverBlock(), { dataTransfer: dragPayload(["text/plain"]) });

    // `fireEvent` returns false once something called `preventDefault`, which
    // on `dragover` is the whole of "this is a drop target": a drag that is
    // not accepted here never becomes a drop.
    expect(file).toBe(false);
    expect(text).toBe(true);
  });

  it("says why a dropped image was refused, and still lets a typed field save", async () => {
    const onSave = vi.fn();
    render(
      <TagEditor
        tracks={[track()]}
        onSave={onSave}
        onCancel={vi.fn()}
        onPickCover={vi.fn(async () => null)}
        // The refusal comes from the backend, the only thing that has seen the
        // bytes: too big, or not a JPEG or a PNG.
        // Rejecting with a bare string, which is what `invoke` does: an
        // `AppError` serializes to its sentence and nothing else.
        onDropCover={vi.fn(() => Promise.reject("Cover art has to be a JPEG or a PNG."))}
      />,
    );
    const user = userEvent.setup();

    fireEvent.drop(coverBlock(), { dataTransfer: dragPayload(["Files"], [jpeg()]) });
    await screen.findByText("Cover art has to be a JPEG or a PNG.");

    // A refused image is not a reason to hold a typed field hostage: the cover
    // is simply unchanged, and the rest of the edit still writes.
    await user.type(screen.getByLabelText("Genre"), "Dream Pop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(savedEdit(onSave).genre).toBe("ShoegazeDream Pop");
    expect(savedEdit(onSave).cover).toBeNull();
  });

  it("clears a refusal when the next choice is made", async () => {
    render(
      <TagEditor
        tracks={[track()]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onPickCover={vi.fn(async () => "C:/art/cover.png")}
        onDropCover={vi.fn(() => Promise.reject("Cover art has to be a JPEG or a PNG."))}
      />,
    );
    const user = userEvent.setup();

    fireEvent.drop(coverBlock(), { dataTransfer: dragPayload(["Files"], [jpeg()]) });
    await screen.findByRole("alert");

    // The picker is the other way to choose artwork, and a sentence about the
    // last refusal left standing under a fresh choice reports on nothing.
    await user.click(screen.getByRole("button", { name: "Choose Artwork…" }));

    await screen.findByText("New artwork selected.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves on Enter from a field", async () => {
    const { onSave, user } = open([track()]);

    await user.type(screen.getByLabelText("Genre"), "Dream Pop{Enter}");

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not save on Enter when there is nothing to save", async () => {
    const { onSave, user } = open([track()]);

    await user.type(screen.getByLabelText("Genre"), "{Enter}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save on Enter when a field is invalid", async () => {
    const { onSave, user } = open([track()]);

    await user.clear(screen.getByLabelText("Year"));
    await user.type(screen.getByLabelText("Year"), "twenty{Enter}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onSave, onCancel, user } = open([track()]);

    await user.type(screen.getByLabelText("Genre"), "x{Escape}");

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("leaves Enter on a button to that button", async () => {
    const { onSave, onPickCover, user } = open([track()], "C:/art/cover.png");

    // Let the dialog take its initial focus first. It claims focus on a later
    // tick, so a synchronous `.focus()` here races it - and loses on a slow
    // runner, which sent Enter to the Name field instead. It passed locally and
    // failed on CI, which is the signature of this particular race.
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());

    screen.getByRole("button", { name: "Choose Artwork…" }).focus();
    await user.keyboard("{Enter}");

    // Hijacking Enter here would break the control the user is operating.
    expect(onPickCover).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("discards everything on cancel", async () => {
    const { onSave, onCancel, user } = open([track()]);

    await user.type(screen.getByLabelText("Genre"), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("the focus trap phase 24 brought with it", () => {
    it("takes the page behind it out of reach", () => {
      // The hand-rolled dialog had no trap at all: Tab walked straight out of
      // it into the table behind, which stayed fully interactive.
      //
      // What is asserted is the *mechanism*, not the tabbing. An earlier
      // version of this test pressed Tab forty times and checked focus never
      // escaped; it passed here and failed on CI, because user-event walks its
      // own computed tab order and does not honour the inert marking, so
      // whether the trap yanks focus back in time is a race in jsdom. The
      // marking itself is deterministic, and the e2e suite is where real
      // tabbing is real.
      render(
        <>
          <button type="button">behind the dialog</button>
          <TagEditor
            tracks={[track()]}
            onSave={vi.fn()}
            onCancel={vi.fn()}
            onPickCover={vi.fn(async () => null)}
            onDropCover={vi.fn(async () => "")}
          />
        </>,
      );

      // Not `getByRole`: being out of the accessibility tree is the point.
      const outside = document.querySelector("button");
      expect(outside).toHaveTextContent("behind the dialog");
      expect(screen.queryByRole("button", { name: "behind the dialog" })).not.toBeInTheDocument();
      expect(outside?.closest("[data-base-ui-inert]")).not.toBeNull();
      expect(outside?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it("comes back round rather than falling out of the bottom", async () => {
      const { user } = open([track()]);

      // Settle the dialog's own initial focus before taking it, for the same
      // reason as the Enter test above.
      await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());

      // Save is the last control in the dialog.
      screen.getByRole("button", { name: "Save" }).focus();
      await user.tab();

      // Wherever it lands, it is not on the body - which is where focus goes
      // when a dialog lets it walk off the end.
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getByRole("button", { name: "Save" })).not.toHaveFocus();
    });
  });
});

describe("the suggestion list phase 18 brought with it", () => {
  const suggest = vi.mocked(suggestTagValues);

  it("offers artists the library already holds", async () => {
    suggest.mockResolvedValue(["Grizzly Bear"]);
    const { user } = open([track()]);

    await user.clear(screen.getByLabelText("Artist"));
    await user.type(screen.getByLabelText("Artist"), "griz");

    expect(await screen.findByRole("option", { name: "Grizzly Bear" })).toBeVisible();
  });

  it("closes the list on Escape without cancelling the whole edit", async () => {
    suggest.mockResolvedValue(["Grizzly Bear"]);
    const { onCancel, user } = open([track()]);

    await user.clear(screen.getByLabelText("Artist"));
    await user.type(screen.getByLabelText("Artist"), "griz");
    await screen.findByRole("option", { name: "Grizzly Bear" });
    await user.keyboard("{Escape}");

    // Losing a half-finished bulk edit because you dismissed a dropdown is a
    // surprising amount to lose for one keystroke.
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Grizzly Bear" })).not.toBeInTheDocument(),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();

    // A second Escape, with no list left to close, cancels as it always did.
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("counts a picked suggestion as a change, so it writes", async () => {
    suggest.mockResolvedValue(["Grizzly Bear"]);
    const { onSave, user } = open([track({ artist: "Grizly Bear" })]);

    await user.clear(screen.getByLabelText("Artist"));
    await user.type(screen.getByLabelText("Artist"), "griz");
    await user.click(await screen.findByRole("option", { name: "Grizzly Bear" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(savedEdit(onSave).artist).toBe("Grizzly Bear");
  });

  it("gives a per-song field no list at all", async () => {
    const { user } = open([track()]);

    await user.type(screen.getByLabelText("Comment"), "burned from vinyl");

    // Title, Comment, Track Number and Disc Number are per-song by nature.
    expect(screen.getByLabelText("Comment")).toHaveRole("textbox");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  describe("while the write is running", () => {
    it("says how far it has got, where the summary line was", () => {
      open([track()], null, { done: 120, total: 500 });

      // The dialog stays up across the write now, and a dialog that says
      // nothing while it does is indistinguishable from a hung window.
      expect(
        screen.getByText(`Writing ${(120).toLocaleString()} of ${(500).toLocaleString()}…`),
      ).toBeInTheDocument();
    });

    it("stops offering Save and Cancel", () => {
      open([track()], null, { done: 1, total: 2 });

      // Files are already on disk; there is nothing left to call off.
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    it("does not close on Escape", async () => {
      const { onCancel, user } = open([track()], null, { done: 1, total: 2 });

      await user.keyboard("{Escape}");

      expect(onCancel).not.toHaveBeenCalled();
    });

    it("closes on Escape again once the write is over", async () => {
      const { onCancel, user } = open([track()]);

      await user.keyboard("{Escape}");

      expect(onCancel).toHaveBeenCalled();
    });
  });
});
