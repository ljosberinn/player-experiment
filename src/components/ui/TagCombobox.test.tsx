import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestTagValues } from "../../ipc";
import { TagCombobox } from "./TagCombobox";

vi.mock("../../ipc", () => ({ suggestTagValues: vi.fn(async () => []) }));

const suggest = vi.mocked(suggestTagValues);

/** A controlled host, because the field is only useful as a controlled input. */
function Host({ field = "artist" as const, initial = "" }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="artist">Artist</label>
      <TagCombobox id="artist" field={field} value={value} onChange={setValue} />
      <output>{value}</output>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  suggest.mockResolvedValue([]);
});

describe("TagCombobox", () => {
  it("offers what the library already says", async () => {
    suggest.mockResolvedValue(["Godspeed You! Black Emperor", "Godspeed You Black Emperor"]);
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "god");

    expect(
      await screen.findByRole("option", { name: "Godspeed You! Black Emperor" }),
    ).toBeVisible();
    expect(suggest).toHaveBeenCalledWith("artist", "god");
  });

  it("puts a suggestion in the field when one is chosen", async () => {
    suggest.mockResolvedValue(["Godspeed You! Black Emperor"]);
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "god");
    await user.click(await screen.findByRole("option", { name: "Godspeed You! Black Emperor" }));

    expect(screen.getByLabelText("Artist")).toHaveValue("Godspeed You! Black Emperor");
  });

  it("takes a suggestion on Enter after arrowing to it", async () => {
    suggest.mockResolvedValue(["Beach House", "Beach Fossils"]);
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "beach");
    await screen.findByRole("option", { name: "Beach Fossils" });
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Artist")).toHaveValue("Beach Fossils");
  });

  it("stays free text, because a band the library has never seen has to be typeable", async () => {
    suggest.mockResolvedValue(["Beach House"]);
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "Beach Hou");
    await screen.findByRole("option", { name: "Beach House" });
    // Typing past the suggestion rather than accepting it. Nothing may be
    // filled in without a deliberate Enter or click.
    await user.type(screen.getByLabelText("Artist"), "ses");

    expect(screen.getByLabelText("Artist")).toHaveValue("Beach Houses");
  });

  it("gives a field with no shared vocabulary no listbox at all", async () => {
    const user = userEvent.setup();
    render(<Host field={null as never} />);

    await user.type(screen.getByLabelText("Artist"), "anything");

    // Not an empty listbox - none. A comment or a title is per-song by nature.
    expect(screen.getByLabelText("Artist")).toHaveRole("textbox");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("asks once for a word rather than once per letter", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "beach");
    await waitFor(() => expect(suggest).toHaveBeenCalled());

    // Five keystrokes inside one debounce window is one round trip to SQLite,
    // not five.
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith("artist", "beach");
  });

  it("ignores a slow answer to a query that has been superseded", async () => {
    const user = userEvent.setup();
    // "bea" resolves after "beach" has already been asked and answered.
    let releaseStale: (values: string[]) => void = () => {};
    suggest.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          releaseStale = resolve;
        }),
    );
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "bea");
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));

    suggest.mockResolvedValue(["Beach House"]);
    await user.type(screen.getByLabelText("Artist"), "ch");
    expect(await screen.findByRole("option", { name: "Beach House" })).toBeVisible();

    // The stale lookup lands last and must not win.
    releaseStale(["Beastie Boys"]);
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Beastie Boys" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "Beach House" })).toBeVisible();
  });

  it("says nothing rather than failing when the lookup does", async () => {
    suggest.mockRejectedValue(new Error("database is locked"));
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Artist"), "beach");
    await waitFor(() => expect(suggest).toHaveBeenCalled());

    // The field still works. Suggestions are a convenience, and losing them is
    // not worth an error state over a field that is free text anyway.
    expect(screen.getByLabelText("Artist")).toHaveValue("beach");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
