import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { screen, userEvent } from "storybook/test";
import { editingHandlers } from "../../../.storybook/handlers";
import type { TagValueField } from "../../ipc";
import { Dialog, DialogBody, DialogHeader } from "../primitives/Dialog";
import { SUGGEST_DEBOUNCE_MS, TagCombobox } from "./TagCombobox";

/**
 * In a dialog, because that is the only place it is drawn: its field styles
 * are `.dialog input`, and a bare one would be an unstyled browser box.
 */
function Field({ field, initial }: { field: TagValueField | null; initial: string }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  return (
    <Dialog onClose={() => {}}>
      <DialogHeader title="Edit" />
      <DialogBody>
        <label className="dialog-field" htmlFor={id}>
          {field === null ? "Comment" : "Artist"}
          <TagCombobox id={id} field={field} value={value} onChange={setValue} />
        </label>
      </DialogBody>
    </Dialog>
  );
}

const meta = {
  title: "Features/Editing/TagCombobox",
  component: Field,
  args: { field: "artist", initial: "" },
  parameters: { ipc: editingHandlers },
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = { args: { initial: "The Lanterns" } };

export const Suggesting: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole("combobox"), "the");
    await screen.findByRole("listbox");
  },
};

/** Nothing in the library matches, so no list opens - not an empty one. */
export const NoMatch: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole("combobox"), "Godspeed");
    // Past the debounce, so the lookup has answered before the story settles.
    await new Promise((resolve) => setTimeout(resolve, SUGGEST_DEBOUNCE_MS * 2));
  },
};

/** A field with no shared vocabulary is a plain input with no list at all. */
export const NoVocabulary: Story = {
  args: { field: null, initial: "Recorded live at the pier, 2019" },
};
