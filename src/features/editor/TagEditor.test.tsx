import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TagEdit, Track } from "../../ipc";
import { suggestTagValues } from "../../ipc";
import { TagEditor } from "./TagEditor";

vi.mock("../../ipc", () => ({
  coverUrl: (hash: string) => `cover-url:${hash}`,
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

function open(tracks: Track[], pickedCover: string | null = null) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onPickCover = vi.fn(async () => pickedCover);
  render(
    <TagEditor tracks={tracks} onSave={onSave} onCancel={onCancel} onPickCover={onPickCover} />,
  );
  return { onSave, onCancel, onPickCover, user: userEvent.setup() };
}

const savedEdit = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls.at(-1)?.[0] as TagEdit;

describe("TagEditor", () => {
  it("shows one track's values", () => {
    open([track()]);

    expect(screen.getByLabelText("Name")).toHaveValue("Maki");
    expect(screen.getByLabelText("Year")).toHaveValue("2012");
    expect(screen.getByRole("dialog", { name: "Get Info" })).toBeInTheDocument();
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
      />,
    );

    // Off `document` rather than the render container: the dialog is portalled
    // to the body now. The cover is decorative (`alt=""`), so it has no role to
    // query it by.
    expect(document.querySelector(".status-cover")).toHaveAttribute("src", "cover-url:abc");
  });

  it("says artwork differs across a mixed selection", () => {
    open([track({ cover_hash: "abc" }), track({ id: 2, cover_hash: "def" })]);

    expect(screen.getByText(/Artwork differs/)).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "Get Info" })).toBeInTheDocument();

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
});
