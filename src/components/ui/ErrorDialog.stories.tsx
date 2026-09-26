import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorDialog } from "./ErrorDialog";

/**
 * Each story is a live alert over the canvas, as `UI/ConfirmDialog` draws its
 * own. OK does not close it, which would leave an empty canvas.
 */
function Specimen() {
  return null;
}

const meta = {
  title: "UI/ErrorDialog",
  component: Specimen,
} satisfies Meta<typeof Specimen>;

export default meta;

export const Short: StoryObj<typeof meta> = {
  render: () => <ErrorDialog message="The audio device went away." onDismiss={() => {}} />,
};

/** A path and a reason, which is what most of them are. */
export const Long: StoryObj<typeof meta> = {
  render: () => (
    <ErrorDialog
      message="C:\Music\Orchard Ensemble\Field Recordings, Vol. 2\01 Morning in the Orchard, Before Anyone Else Had Woken and the Frost Was Still on the Grass.flac could not be opened: The system cannot find the path specified. (os error 3)"
      onDismiss={() => {}}
    />
  ),
};
