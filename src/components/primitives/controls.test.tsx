import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { SearchField } from "./SearchField";
import { SegmentedControl } from "./SegmentedControl";
import { Select } from "./Select";
import { Slider } from "./Slider";
import { Switch } from "./Switch";

/**
 * What jsdom can see of the drawn controls, which is the half that matters
 * here.
 *
 * The drawing is in `library.css` and no stylesheet is applied, so nothing
 * below is about pixels - the specimen sheet in Storybook is where those are
 * looked at. These are the things the *replacement* could have lost: the role
 * a native element announced, the name its `<label>` gave it, the state it
 * reported, and the keyboard it came with.
 */
describe("Checkbox", () => {
  it("is still a checkbox, named by its own label", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Organise library" checked={false} onChange={onChange} />);

    // The `<label>` wraps the box and the word, so the word is a target too -
    // which is the thing a drawn control most easily throws away.
    await userEvent.click(screen.getByText("Organise library"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports mixed rather than ticked", () => {
    // `indeterminate` has no HTML attribute, so this is the one piece of
    // state the component has to set through the DOM. A box that lost it
    // would report itself as unticked and read as "some of these are on"
    // nowhere at all.
    render(<Checkbox label="Genre" checked={false} mixed onChange={() => undefined} />);

    const box = screen.getByRole("checkbox", { name: "Genre" });

    expect(box).toBeInstanceOf(HTMLInputElement);
    expect((box as HTMLInputElement).indeterminate).toBe(true);
  });

  it("takes its name from a label elsewhere when it has none of its own", () => {
    // The settings dialog puts the label at the far left of the row and the
    // control at the right, so the association is by `id` rather than by
    // containment.
    render(
      <>
        <label htmlFor="organise">Organise My Library</label>
        <Checkbox id="organise" checked onChange={() => undefined} />
      </>,
    );

    expect(screen.getByRole("checkbox", { name: "Organise My Library" })).toBeChecked();
  });

  it("does not act when disabled", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Artwork" checked disabled onChange={onChange} />);

    await userEvent.click(screen.getByText("Artwork"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Radio", () => {
  it("keeps the grouping that makes a set one control", async () => {
    const onChange = vi.fn();
    render(
      <>
        <Radio name="scope" value="all" label="All songs" checked onChange={onChange} />
        <Radio
          name="scope"
          value="matched"
          label="Matched only"
          checked={false}
          onChange={onChange}
        />
      </>,
    );

    // Shared `name` is what gives the pair arrow keys and one tab stop, and
    // it is what a role query with a name finds.
    await userEvent.click(screen.getByRole("radio", { name: "Matched only" }));

    expect(onChange).toHaveBeenCalledWith("matched");
    expect(screen.getByRole("radio", { name: "All songs" })).toBeChecked();
  });
});

describe("Switch", () => {
  it("announces as a switch rather than as a checkbox", async () => {
    // The distinction is the whole reason it is a separate primitive: a
    // checkbox is a value in a form, a switch takes effect as it is thrown.
    const onChange = vi.fn();
    render(<Switch label="Scrobble" checked={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole("switch", { name: "Scrobble" }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is named by a label elsewhere when it has none of its own", () => {
    render(
      <>
        <label htmlFor="offline">Offline Mode</label>
        <Switch id="offline" checked onChange={() => undefined} />
      </>,
    );

    expect(screen.getByRole("switch", { name: "Offline Mode" })).toBeChecked();
  });
});

describe("Select", () => {
  const RANGES = [
    { value: "12m", label: "Last 12 months" },
    { value: "all", label: "All time" },
  ] as const;

  it("shows the label of the value rather than the value", () => {
    // The trigger is a button, not a `<select>`, so the text in it is this
    // component's job. A select that showed `12m` would be reporting its
    // storage format.
    render(<Select label="Range" value="12m" options={RANGES} onChange={() => undefined} />);

    expect(screen.getByRole("combobox", { name: "Range" })).toHaveTextContent("Last 12 months");
  });

  it("opens on the keyboard and reports the choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select label="Range" value="12m" options={RANGES} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "Range" }));
    await user.click(await screen.findByRole("option", { name: "All time" }));

    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("takes its name from a label elsewhere", () => {
    // A `<button>` is labelable, so `htmlFor` finds the trigger - which is
    // what lets the settings rows keep their own layout.
    render(
      <>
        <label htmlFor="theme">Theme</label>
        <Select id="theme" value="12m" options={RANGES} onChange={() => undefined} />
      </>,
    );

    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
  });
});

describe("SearchField", () => {
  it("is a text field named by its label rather than by its glyph", async () => {
    const onChange = vi.fn();
    render(<SearchField label="Search library" value="" onChange={onChange} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search library" }), "a");

    expect(onChange).toHaveBeenCalledWith("a");
  });
});

describe("Slider", () => {
  it("reads the same to the eye and to a screen reader", () => {
    // The readout beside the rail is `aria-hidden`, so `format` has to reach
    // the thumb's `aria-valuetext` as well or the two say different things
    // about the same number - 58 and "58%".
    render(
      <Slider label="Level" value={58} onChange={() => undefined} format={(n) => `${n} dB`} />,
    );

    expect(screen.getByRole("slider", { name: "Level" })).toHaveAttribute(
      "aria-valuetext",
      "58 dB",
    );
    expect(screen.getByText("58 dB")).toBeInTheDocument();
  });

  it("steps on the keyboard and reports one number", async () => {
    // Base UI's value is a number or a range; this primitive is one-handled,
    // and flattening it here is what stops every call site doing it.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Slider label="Level" value={58} onChange={onChange} />);

    await user.click(screen.getByRole("slider", { name: "Level" }));
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith(59);
  });
});

describe("SegmentedControl", () => {
  it("is a named group of radios, so the arrow keys work", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        name="tab"
        label="Statistics tab"
        value="listening"
        segments={[
          { value: "listening", label: "Listening" },
          { value: "library", label: "Library" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("group", { name: "Statistics tab" })).toBeInTheDocument();

    // One tab stop into the set, then an arrow within it. Both are the
    // browser's, and both are what a set of buttons would have had to
    // rebuild.
    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("library");
  });
});
