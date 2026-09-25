import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { editingHandlers } from "../../../.storybook/handlers";
import type { FilterGroup } from "../../ipc";
import { emptyFilter, noOrder } from "./filterTree";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";

const meta = {
  title: "Features/Editing/SmartPlaylistEditor",
  component: SmartPlaylistEditor,
  args: {
    title: "Edit Smart Playlist",
    name: "Unplayed Jazz",
    filter: emptyFilter,
    order: noOrder,
    onSave: fn(),
    onCancel: fn(),
  },
  // Text rules on a field with a vocabulary ask for suggestions as they mount.
  parameters: { ipc: editingHandlers },
} satisfies Meta<typeof SmartPlaylistEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

/** What File ▸ New Smart Playlist opens on. */
export const New: Story = {
  args: { title: "New Smart Playlist", name: "New Smart Playlist", isNew: true },
};

export const OneRule: Story = {
  args: {
    filter: {
      combinator: "all",
      children: [{ type: "rule", field: "genre", op: "is", value: { kind: "text", text: "Jazz" } }],
    },
  },
};

/**
 * Every value shape a rule has, and a group of each combinator inside the
 * other.
 */
const NESTED: FilterGroup = {
  combinator: "all",
  children: [
    {
      type: "rule",
      field: "artist",
      op: "contains",
      value: { kind: "text", text: "Lanterns" },
    },
    { type: "rule", field: "year", op: "between", value: { kind: "range", from: 2008, to: 2019 } },
    {
      type: "group",
      combinator: "any",
      children: [
        { type: "rule", field: "playCount", op: "lessThan", value: { kind: "number", number: 3 } },
        {
          type: "rule",
          field: "lastPlayedAt",
          op: "inLast",
          value: { kind: "number", number: 30 },
        },
        {
          type: "group",
          combinator: "all",
          children: [
            { type: "rule", field: "loved", op: "is", value: { kind: "none" } },
            { type: "rule", field: "comment", op: "isEmpty", value: { kind: "none" } },
          ],
        },
      ],
    },
  ],
};

export const NestedGroups: Story = {
  args: { name: "Lanterns, rarely played", filter: NESTED },
};

/** The cutoff that makes Most Played a smart playlist. */
export const SortedAndLimited: Story = {
  args: {
    name: "Most Played",
    filter: {
      combinator: "all",
      children: [
        {
          type: "rule",
          field: "playCount",
          op: "greaterThan",
          value: { kind: "number", number: 0 },
        },
      ],
    },
    order: { sort: { field: "playCount", direction: "desc" }, limit: 25 },
  },
};
