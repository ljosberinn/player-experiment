import type { Meta, StoryObj } from "@storybook/react-vite";
import { BUILT_INS, LIBRARY, MENUS, PLAYLISTS } from "../../../.storybook/fixtures";
import { commands } from "../../features/shell/commands";
import { CommandPalette } from "./CommandPalette";

/**
 * The palette over the canvas, built by `commands()` from `MENUS`, so every
 * group has something in it. Closing it does nothing, which would leave an
 * empty canvas.
 */
function Specimen() {
  return null;
}

const meta = {
  title: "UI/CommandPalette",
  component: Specimen,
} satisfies Meta<typeof Specimen>;

export default meta;

const noop = () => {};

export const Open: StoryObj<typeof meta> = {
  render: () => (
    <CommandPalette
      groups={commands({
        menus: MENUS,
        tab: "songs",
        playlistId: null,
        playlists: [...BUILT_INS, ...PLAYLISTS],
        back: "Releases",
        forward: null,
        status: "playing",
        track: LIBRARY[0] ?? null,
        muted: false,
        repeatOne: false,
        zoom: 1,
        theme: "system",
        onPlayback: noop,
        onZoom: noop,
        onTheme: noop,
        onSettings: noop,
        onNewPlaylist: noop,
        onNewSmartPlaylist: noop,
        onShowTab: noop,
        onShowPlaylist: noop,
        onBack: noop,
        onForward: noop,
        onShowTrackArtist: noop,
        onShowTrackGroup: noop,
      })}
      onClose={noop}
    />
  ),
};
