import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FilterGroup, type SmartOrder, suggestTagValues } from "../../ipc";
import { emptyFilter, noOrder } from "./filterTree";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

// The value field suggests what the library already holds; these tests are
// about the tree, so it holds nothing.
vi.mock("../../ipc", () => ({ suggestTagValues: vi.fn(async () => []) }));

function open(
  filter: FilterGroup = emptyFilter,
  name = "Recent",
  order: SmartOrder = noOrder,
  isNew = false,
) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <SmartPlaylistEditor
      title="New Smart Playlist"
      name={name}
      filter={filter}
      order={order}
      isNew={isNew}
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

/** The order the last save carried. */
function savedOrder(onSave: ReturnType<typeof vi.fn>): SmartOrder {
  return onSave.mock.calls.at(-1)?.[2] as SmartOrder;
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
    await user.type(screen.getByLabelText("Value for condition 1"), "Grizzly Bear");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("Recent", artistIs("Grizzly Bear"), noOrder);
  });

  describe("sort and limit", () => {
    it("opens on nothing sorted and nothing limited", () => {
      open();

      expect(screen.getByRole("checkbox", { name: "Sorted by" })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Limited to" })).not.toBeChecked();
      // Both controls inert until their box is ticked, so an unsorted playlist
      // cannot be given a direction that means nothing.
      expect(screen.getByRole("combobox", { name: "Sort by" })).toBeDisabled();
      expect(screen.getByRole("spinbutton", { name: "Limit" })).toBeDisabled();
    });

    it("hands back the sort and cutoff it was opened with, untouched", async () => {
      const order: SmartOrder = { sort: { field: "playCount", direction: "desc" }, limit: 100 };
      const { onSave, user } = open(emptyFilter, "Most Played", order);

      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("playCount");
      expect(screen.getByRole("spinbutton", { name: "Limit" })).toHaveValue(100);

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(savedOrder(onSave)).toEqual(order);
    });

    it("builds a most-played cutoff from nothing", async () => {
      const { onSave, user } = open();

      await user.click(screen.getByRole("checkbox", { name: "Limited to" }));
      await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "playCount");
      const limit = screen.getByRole("spinbutton", { name: "Limit" });
      await user.clear(limit);
      await user.type(limit, "25");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(savedOrder(onSave)).toEqual({
        sort: { field: "playCount", direction: "desc" },
        limit: 25,
      });
    });

    it("supplies a sort when a cutoff is switched on without one", async () => {
      const { user } = open();

      await user.click(screen.getByRole("checkbox", { name: "Limited to" }));

      // A limit with no sort is a hundred arbitrary songs, which is never what
      // "limit this to a hundred" means.
      expect(screen.getByRole("checkbox", { name: "Sorted by" })).toBeChecked();
      expect(screen.getByRole("combobox", { name: "Sort by" })).toBeEnabled();
      // And it cannot be taken away again while the cutoff is relying on it.
      expect(screen.getByRole("checkbox", { name: "Sorted by" })).toBeDisabled();
    });

    it("keeps the sort when the cutoff is switched back off", async () => {
      const order: SmartOrder = { sort: { field: "year", direction: "asc" }, limit: 10 };
      const { onSave, user } = open(emptyFilter, "Oldest", order);

      await user.click(screen.getByRole("checkbox", { name: "Limited to" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      // Sorting is useful on its own, so dropping the cutoff must not quietly
      // throw away the column the user picked.
      expect(savedOrder(onSave)).toEqual({
        sort: { field: "year", direction: "asc" },
        limit: null,
      });
    });

    it("does not offer a sort the backend would refuse", () => {
      open();
      const sort = screen.getByRole("combobox", { name: "Sort by" });

      // Relevance needs a search to rank against and position needs a static
      // playlist to sit in; neither exists inside a smart playlist.
      expect(sort).not.toHaveTextContent(/relevance/i);
      expect(sort).not.toHaveTextContent(/position/i);
    });

    it("reads an emptied limit box as one song rather than as none", async () => {
      const order: SmartOrder = { sort: { field: "addedAt", direction: "desc" }, limit: 5 };
      const { onSave, user } = open(emptyFilter, "Recent", order);

      await user.clear(screen.getByRole("spinbutton", { name: "Limit" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      // Zero is refused by the backend, and clearing the box to retype is not
      // a request for an always-empty playlist.
      expect(savedOrder(onSave).limit).toBe(1);
    });
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

    await user.type(screen.getByLabelText("Value for condition 1"), "{Enter}");
    expect(onSave).toHaveBeenCalledOnce();

    await user.type(screen.getByRole("textbox", { name: "Name" }), "{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves Enter on a select and a button alone", async () => {
    const { onSave, user } = open();

    // The dialog claims initial focus asynchronously, so a `.focus()` issued
    // before that lands is taken straight back - and Enter then arrives at the
    // Name field, where implicit submission is exactly right and exactly not
    // what this test is about.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());

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

describe("naming a new smart playlist from its one rule (issue 52)", () => {
  const DEFAULT = "New Smart Playlist";

  it("derives the name from a single rule's value as it is typed", async () => {
    const { user } = open(emptyFilter, DEFAULT, noOrder, true);

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "Rome");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rome");
  });

  it("does not derive a name once a second rule exists", async () => {
    const { user } = open(emptyFilter, DEFAULT, noOrder, true);

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "Rome");
    await user.click(screen.getByRole("button", { name: "+ Rule" }));

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(DEFAULT);
  });

  it("falls back to the default when the rule's value is empty", async () => {
    const { user } = open(emptyFilter, DEFAULT, noOrder, true);

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "Rome");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rome");

    await user.clear(screen.getByLabelText("Value for condition 1"));

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(DEFAULT);
  });

  it("stops deriving for good once the user types a name of their own", async () => {
    const { onSave, user } = open(emptyFilter, DEFAULT, noOrder, true);

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "Rome");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rome");

    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Touring Bands");

    // The rule changes again after the takeover; the typed name must survive it.
    await user.clear(screen.getByLabelText("Value for condition 1"));
    await user.type(screen.getByLabelText("Value for condition 1"), "Paris");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("Touring Bands", expect.anything(), noOrder);
  });

  it("never derives a name when editing an existing playlist", async () => {
    const { onSave, user } = open(emptyFilter, "My Mix", noOrder, false);

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "Rome");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("My Mix");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("My Mix", expect.anything(), noOrder);
  });
});

describe("the vocabulary a rule offers", () => {
  const suggest = vi.mocked(suggestTagValues);

  beforeEach(() => {
    vi.clearAllMocks();
    suggest.mockResolvedValue([]);
  });

  it("offers the artists already in the library", async () => {
    suggest.mockResolvedValue(["Godspeed You! Black Emperor"]);
    const { user } = open();

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.type(screen.getByLabelText("Value for condition 1"), "god");

    // Typing a band name by hand into a filter is how a smart playlist ends up
    // matching nothing at all.
    expect(
      await screen.findByRole("option", { name: "Godspeed You! Black Emperor" }),
    ).toBeVisible();
    expect(suggest).toHaveBeenCalledWith("artist", "god");
  });

  it("switches vocabulary when the rule's field changes", async () => {
    const { user } = open();

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.selectOptions(screen.getByLabelText("Field for condition 1"), "genre");
    await user.type(screen.getByLabelText("Value for condition 1"), "shoe");

    await waitFor(() => expect(suggest).toHaveBeenCalledWith("genre", "shoe"));
  });

  it("offers none for a field where two songs need not agree", async () => {
    const { user } = open();

    await user.click(screen.getByRole("button", { name: "+ Rule" }));
    await user.selectOptions(screen.getByLabelText("Field for condition 1"), "comment");
    await user.type(screen.getByLabelText("Value for condition 1"), "anything");

    // A dropdown of other songs' comments is a way to paste the wrong data.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(suggest).not.toHaveBeenCalled();
  });
});
