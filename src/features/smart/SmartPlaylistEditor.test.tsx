import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FilterGroup } from "../../ipc";
import { emptyFilter } from "./filterTree";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

function open(filter: FilterGroup = emptyFilter, name = "Recent") {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <SmartPlaylistEditor
      title="New Smart Playlist"
      name={name}
      filter={filter}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { onSave, onCancel, user: userEvent.setup() };
}

/** The filter the last save carried. */
function saved(onSave: ReturnType<typeof vi.fn>): FilterGroup {
  return onSave.mock.calls.at(-1)?.[1] as FilterGroup;
}

const artistIs = (text: string): FilterGroup => ({
  combinator: "all",
  children: [{ type: "rule", field: "artist", op: "is", value: { kind: "text", text } }],
});

describe("SmartPlaylistEditor", () => {
  it("says an empty filter will hold everything, rather than looking broken", async () => {
    open();

    expect(screen.getByText(/whole library/)).toBeInTheDocument();
  });

  it("builds a rule and hands it back on save", async () => {
    const { onSave, user } = open();

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByRole("textbox", { name: "Value for condition 1" }), "Grizzly Bear");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("Recent", artistIs("Grizzly Bear"));
  });

  it("offers only the operators the chosen field accepts", async () => {
    const { user } = open(artistIs("Guitar"));
    const op = screen.getByRole("combobox", { name: "Condition 1 on Artist" });

    expect(op).toHaveTextContent("contains");
    expect(op).not.toHaveTextContent("is in the last");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field for condition 1" }),
      "year",
    );

    expect(screen.getByRole("combobox", { name: "Condition 1 on Year" })).not.toHaveTextContent(
      "contains",
    );
  });

  it("repairs the operator and the value when a field cannot keep them", async () => {
    const { onSave, user } = open(artistIs("Guitar"));

    // "Artist is <text>" becoming "Date Added …" cannot keep either half.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field for condition 1" }),
      "addedAt",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    const rule = saved(onSave).children[0];
    expect(rule).toMatchObject({ field: "addedAt", op: "inLast", value: { kind: "number" } });
  });

  it("renders no value input for an operator that takes no value", async () => {
    const { user } = open(artistIs("Guitar"));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Condition 1 on Artist" }),
      "isEmpty",
    );

    expect(
      screen.queryByRole("textbox", { name: "Value for condition 1" }),
    ).not.toBeInTheDocument();
  });

  it("renders both ends of a range", async () => {
    const { onSave, user } = open({
      combinator: "all",
      children: [
        { type: "rule", field: "year", op: "between", value: { kind: "range", from: 0, to: 0 } },
      ],
    });

    await user.clear(screen.getByRole("spinbutton", { name: "Lower bound for condition 1" }));
    await user.type(
      screen.getByRole("spinbutton", { name: "Lower bound for condition 1" }),
      "2012",
    );
    await user.clear(screen.getByRole("spinbutton", { name: "Upper bound for condition 1" }));
    await user.type(
      screen.getByRole("spinbutton", { name: "Upper bound for condition 1" }),
      "2017",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saved(onSave).children[0]).toMatchObject({
      value: { kind: "range", from: 2012, to: 2017 },
    });
  });

  it("nests a group and keeps its combinator separate from the root's", async () => {
    const { onSave, user } = open();

    await user.click(screen.getByRole("button", { name: "+ Group" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Match rules in this group" }),
      "all",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Match rules" }), "any");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const filter = saved(onSave);
    expect(filter.combinator).toBe("any");
    expect(filter.children[0]).toMatchObject({ type: "group", combinator: "all" });
  });

  it("removes a condition without touching its siblings", async () => {
    const { onSave, user } = open({
      combinator: "all",
      children: [
        { type: "rule", field: "artist", op: "is", value: { kind: "text", text: "A" } },
        { type: "rule", field: "album", op: "is", value: { kind: "text", text: "B" } },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Remove condition 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saved(onSave).children).toHaveLength(1);
    expect(saved(onSave).children[0]).toMatchObject({ field: "album" });
  });

  it("removes a nested group", async () => {
    const { onSave, user } = open();
    await user.click(screen.getByRole("button", { name: "+ Group" }));

    await user.click(screen.getByRole("button", { name: "Remove group" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saved(onSave).children).toHaveLength(0);
  });

  it("refuses to save without a name", async () => {
    const { onSave, user } = open(emptyFilter, "Recent");

    await user.clear(screen.getByRole("textbox", { name: "Name" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("discards the draft on cancel", async () => {
    const { onSave, onCancel, user } = open();

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves on Enter and closes on Escape", async () => {
    const { onSave, onCancel, user } = open(artistIs("Guitar"));

    await user.type(screen.getByRole("textbox", { name: "Value for condition 1" }), "{Enter}");
    expect(onSave).toHaveBeenCalledOnce();

    await user.type(screen.getByRole("textbox", { name: "Name" }), "{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves Enter on a select and a button alone", async () => {
    const { onSave, user } = open();

    screen.getByRole("combobox", { name: "Match rules" }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "+ Rule" }).focus();
    await user.keyboard("{Enter}");

    // The + Rule button did its job; the dialog did not close over it.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Field for condition 1" })).toBeInTheDocument();
  });

  it("is announced as a dialog with its own name", () => {
    open();

    expect(screen.getByRole("dialog", { name: "New Smart Playlist" })).toBeInTheDocument();
  });
});
