import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { shellHandlers } from "../../../.storybook/handlers";
import { useLastfmStore } from "../lastfm/store";
import { SettingsDialog } from "./SettingsDialog";

const meta = {
  title: "Features/Shell/SettingsDialog",
  component: SettingsDialog,
  args: { onClose: fn() },
  parameters: { ipc: shellHandlers },
} satisfies Meta<typeof SettingsDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Appearance: Story = { args: { category: "appearance" } };

/** Filing into the Library folder, so its row in Music Folders cannot be removed. */
export const Library: Story = { args: { category: "library" } };

/** A build with no last.fm key, which is every local build. */
export const OnlineNotConfigured: Story = { args: { category: "online" } };

export const OnlineConnected: Story = {
  args: { category: "online" },
  beforeEach: () => {
    useLastfmStore.setState({
      configured: true,
      username: "orchard_ears",
      queued: 3,
      imported: { username: "orchard_ears", through: 1_772_366_400, resumable: false },
    });
  },
};

export const OnlineImporting: Story = {
  args: { category: "online" },
  beforeEach: () => {
    useLastfmStore.setState({
      configured: true,
      username: "orchard_ears",
      importing: true,
      importProgress: { done: 18_200, total: 64_551 },
    });
  },
};

export const About: Story = { args: { category: "about" } };
