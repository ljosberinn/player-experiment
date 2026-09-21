import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogStatus,
} from "./Dialog";

/**
 * The shell in each of the forms the app asks of it.
 *
 * Every story here is a live dialog over the canvas, scrim and all, because
 * that is the only honest way to show one: the box positions itself, and a
 * specimen pinned into the page would be drawing something the app never
 * renders. Switch the ground in the toolbar; both are the sheet's.
 *
 * `onClose` does nothing on purpose. A dialog that could be dismissed here
 * would leave an empty canvas and no way back to the drawing - which is also
 * why `Dialog` is not the story component: it requires `onClose`, and
 * Storybook would ask for args nothing here wants to vary.
 */
function Specimen() {
  return null;
}

const meta = {
  title: "Primitives/Dialog",
  component: Specimen,
} satisfies Meta<typeof Specimen>;

export default meta;

/** Header, body, footer, and nothing in the left-hand slot. */
export const Default: StoryObj<typeof meta> = {
  render: () => (
    <Dialog onClose={() => {}}>
      <DialogHeader title="Edit Smart Playlist" />
      <DialogBody>
        <label className="dialog-field" htmlFor="story-name">
          Name
          <input id="story-name" defaultValue="Lana Del Rey" />
        </label>
        <p className="dialog-summary">
          The body is a column with a 10px gap. What a caller puts in it is the caller's; the two
          rules above and below it are not.
        </p>
      </DialogBody>
      <DialogFooter>
        <DialogClose>Cancel</DialogClose>
        <Button kind="primary">Save</Button>
      </DialogFooter>
    </Dialog>
  ),
};

/** The count in the footer's left-hand slot, which is the sheet's 6a. */
export const WithStatus: StoryObj<typeof meta> = {
  render: () => (
    <Dialog onClose={() => {}}>
      <DialogHeader title="Edit Smart Playlist" />
      <DialogBody>
        <p className="dialog-summary">
          A dialog that has something to tally says so beside its actions rather than above them.
        </p>
      </DialogBody>
      <DialogFooter lead={<DialogStatus>2 conditions · 116 songs match</DialogStatus>}>
        <DialogClose>Cancel</DialogClose>
        <Button kind="primary">Save</Button>
      </DialogFooter>
    </Dialog>
  ),
};

/**
 * The paned header's caption, and the left-hand slot holding a way out rather
 * than a count.
 *
 * Neither has a caller until 118 rebuilds the MusicBrainz review, so this is
 * where both are drawn. The title steps down to 16px to leave the caption room
 * on its baseline.
 */
export const Paned: StoryObj<typeof meta> = {
  render: () => (
    <Dialog paned onClose={() => {}}>
      <DialogHeader title="Get Tags from MusicBrainz" caption="243 releases to review" />
      <DialogBody>
        <p className="dialog-summary">
          A paned dialog takes one height and lets only this give way, so the header above and the
          actions below stay where the pointer left them.
        </p>
      </DialogBody>
      <DialogFooter lead={<Button kind="ghost">Back to queue</Button>}>
        <DialogClose>Cancel</DialogClose>
        <Button>Set aside</Button>
        <Button kind="primary">Apply</Button>
      </DialogFooter>
    </Dialog>
  ),
};

/**
 * The alert, which the backdrop cannot dismiss, with the one kind the sheet
 * does not draw.
 */
export const Destructive: StoryObj<typeof meta> = {
  render: () => (
    <Dialog role="alert" variant="confirm" onClose={() => {}}>
      <DialogHeader title="Delete “Lana Del Rey”?" />
      <DialogBody>
        <DialogDescription>
          The playlist goes; the songs stay in the library. A rescan will not bring it back.
        </DialogDescription>
      </DialogBody>
      <DialogFooter>
        <DialogClose>Cancel</DialogClose>
        <Button kind="destructive">Delete</Button>
      </DialogFooter>
    </Dialog>
  ),
};
