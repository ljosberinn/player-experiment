import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { screen, userEvent } from "storybook/test";
import { editingHandlers } from "../../../.storybook/handlers";
import { Dialog, DialogBody, DialogHeader } from "../primitives/Dialog";
import { GenreCombobox } from "./GenreCombobox";
import { SUGGEST_DEBOUNCE_MS } from "./TagCombobox";

/** In a dialog, as `GenreOverrideDialog` lays it out; its field styles are `.dialog input`. */
function Field({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  return (
    <Dialog onClose={() => {}}>
      <DialogHeader title="Where this genre belongs" />
      <DialogBody>
        <label className="dialog-field" htmlFor={id}>
          Belongs under
          <GenreCombobox
            id={id}
            value={value}
            placeholder="Nothing — this genre is a root"
            onChange={setValue}
          />
        </label>
      </DialogBody>
    </Dialog>
  );
}

const meta = {
  title: "Features/Editing/GenreCombobox",
  component: Field,
  args: { initial: "" },
  parameters: { ipc: editingHandlers },
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Empty, so the placeholder shows. */
export const Closed: Story = {};

export const Suggesting: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole("combobox"), "folk");
    await screen.findByRole("listbox");
  },
};

/** No branch of the tree matches, so no list opens - not an empty one. */
export const NoMatch: Story = {
  play: async () => {
    await userEvent.type(await screen.findByRole("combobox"), "Blackgaze");
    // Past the debounce, so the lookup has answered before the story settles.
    await new Promise((resolve) => setTimeout(resolve, SUGGEST_DEBOUNCE_MS * 2));
  },
};
