import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Each story is a live alert over the canvas, as `Primitives/Dialog` draws
 * its own. Neither button closes it, which would leave an empty canvas.
 */
function Specimen() {
  return null;
}

const meta = {
  title: "UI/ConfirmDialog",
  component: Specimen,
} satisfies Meta<typeof Specimen>;

export default meta;

/** The label a confirm gets when the caller names none. */
export const Default: StoryObj<typeof meta> = {
  render: () => (
    <ConfirmDialog
      title="Delete “Late Night”?"
      body="The playlist goes; the songs stay in your library."
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};

/** File ▸ Remove Missing Songs, which says what it does instead. */
export const ConfirmLabel: StoryObj<typeof meta> = {
  render: () => (
    <ConfirmDialog
      title="Remove missing songs?"
      body="3 songs cannot be found. Removing them also takes them out of every playlist. If a drive is unplugged, reconnect it and rescan instead."
      confirmLabel="Remove"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};

/** The longest body the app writes, removing songs from the library. */
export const LongBody: StoryObj<typeof meta> = {
  render: () => (
    <ConfirmDialog
      title="Remove these songs?"
      body="1,284 songs will be removed from your library and every playlist. The files stay on disk; a rescan adds them back only after File ▸ Forget Removed Songs."
      confirmLabel="Remove"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  ),
};
