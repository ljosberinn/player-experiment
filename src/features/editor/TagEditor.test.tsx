import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TagEdit, Track } from "../../ipc";
import { TagEditor } from "./TagEditor";

vi.mock("../../ipc", () => ({ coverUrl: (hash: string) => `cover-url:${hash}` }));

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

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Maki");
    expect(screen.getByRole("textbox", { name: "Year" })).toHaveValue("2012");
    expect(screen.getByRole("dialog", { name: "Get Info" })).toBeInTheDocument();
  });

  it("says how many songs a bulk edit covers", () => {
    open([track(), track({ id: 2 })]);

    expect(screen.getByRole("dialog", { name: /2 songs/ })).toBeInTheDocument();
  });

  it("leaves a field the selection disagrees on empty, and says it is mixed", () => {
    open([track(), track({ id: 2, artist: "Grizzly Bear" })]);

    const artist = screen.getByRole("textbox", { name: "Artist" });
    expect(artist).toHaveValue("");
    expect(artist).toHaveAttribute("placeholder", "Mixed");
    // A field they do agree on still shows the shared value.
    expect(screen.getByRole("textbox", { name: "Album" })).toHaveValue("Tokyo");
  });

  it("writes only what was touched", async () => {
    const { onSave, user } = open([track(), track({ id: 2, artist: "Grizzly Bear" })]);

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "!");
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

    await user.clear(screen.getByRole("textbox", { name: "Genre" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(savedEdit(onSave).genre).toBe("");
  });

  it("cannot be saved until something changes", async () => {
    const { user } = open([track()]);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "x");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("refuses a number it can see is wrong, before the round trip", async () => {
    const { user } = open([track()]);

    await user.clear(screen.getByRole("textbox", { name: "Year" }));
    await user.type(screen.getByRole("textbox", { name: "Year" }), "twenty");

    expect(await screen.findByRole("alert")).toHaveTextContent("Year must be a number");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("marks the fields a save will write", async () => {
    const { user } = open([track()]);

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "x");

    expect(screen.getByRole("textbox", { name: "Genre" })).toHaveClass("touched");
    expect(screen.getByRole("textbox", { name: "Album" })).not.toHaveClass("touched");
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

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "Dream Pop{Enter}");

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not save on Enter when there is nothing to save", async () => {
    const { onSave, user } = open([track()]);

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "{Enter}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save on Enter when a field is invalid", async () => {
    const { onSave, user } = open([track()]);

    await user.clear(screen.getByRole("textbox", { name: "Year" }));
    await user.type(screen.getByRole("textbox", { name: "Year" }), "twenty{Enter}");

    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onSave, onCancel, user } = open([track()]);

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "x{Escape}");

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("leaves Enter on a button to that button", async () => {
    const { onSave, onPickCover, user } = open([track()], "C:/art/cover.png");

    screen.getByRole("button", { name: "Choose Artwork…" }).focus();
    await user.keyboard("{Enter}");

    // Hijacking Enter here would break the control the user is operating.
    expect(onPickCover).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("discards everything on cancel", async () => {
    const { onSave, onCancel, user } = open([track()]);

    await user.type(screen.getByRole("textbox", { name: "Genre" }), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("the focus trap phase 24 brought with it", () => {
    it("never lets Tab reach the page behind it", async () => {
      // The hand-rolled dialog had no trap at all: Tab walked straight out of
      // it into the table behind, which stayed fully interactive.
      //
      // Asserted against a real element outside rather than by checking
      // containment, because Base UI's own focus guards sit in the portal
      // beside the popup and are legitimately focused in passing.
      const user = userEvent.setup();
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
      // Not `getByRole`: the modal takes the rest of the page out of the
      // accessibility tree, so the button is unreachable by role - which is
      // half of what is being asserted here.
      const outside = document.querySelector("button");
      expect(outside).toHaveTextContent("behind the dialog");
      expect(screen.queryByRole("button", { name: "behind the dialog" })).not.toBeInTheDocument();

      screen.getByRole("textbox", { name: "Name" }).focus();
      for (let i = 0; i < 40; i++) {
        await user.tab();
        expect(outside).not.toHaveFocus();
      }
    });

    it("comes back round rather than falling out of the bottom", async () => {
      const { user } = open([track()]);

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
