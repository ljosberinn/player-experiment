import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent } from "storybook/test";
import { statsHandlers } from "../../../../.storybook/handlers";
import { GenreOverrideDialog } from "./GenreOverrideDialog";

const meta = {
  title: "Features/Statistics/GenreOverrideDialog",
  component: GenreOverrideDialog,
  args: { genre: "Dream Pop", onClose: fn() },
  parameters: { ipc: statsHandlers },
} satisfies Meta<typeof GenreOverrideDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Opened at the top of the tree, where there is no level to be wrong about. */
export const AtTheRoot: Story = {
  args: { genre: "" },
};

/** Opened inside a genre, which fills the first field. */
export const OnAGenre: Story = {};

/** A parent no layer of the tree knows, which `set_override` refuses by name. */
export const Refused: Story = {
  parameters: {
    ipc: { set_genre_override: () => Promise.reject('no genre called "dreamgaze"') },
  },
  play: async () => {
    await userEvent.type(await screen.findByLabelText("Belongs under"), "Dreamgaze");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
  },
};
