import type { Meta, StoryObj } from "@storybook/react-vite";
import { screen, userEvent, within } from "storybook/test";
import { rowItems } from "../../../.storybook/fixtures";
import { ContextMenu } from "./ContextMenu";

const region = {
  display: "grid",
  placeItems: "center",
  height: 160,
  border: "1px dashed var(--chrome-border)",
  borderRadius: 8,
  color: "var(--muted)",
} as const;

/**
 * Two rows' menus, built by `rowMenuItems` as `SongTable` builds them.
 *
 * The first opens itself: items, separators, the two shortcuts, and submenus
 * that open on hover. The second is a song with no artist or title and no
 * playlist to add it to, so Love is greyed with its hint and Add to Playlist
 * says why it is empty.
 */
function Regions() {
  return (
    <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <ContextMenu items={rowItems()} render={<div style={region} />}>
        Right-click: a tagged song
      </ContextMenu>
      <ContextMenu
        items={rowItems({
          playlists: [],
          track: { artist: null, album_artist: null, album: null },
          loving: { loved: false, keyed: false, onToggle: () => {} },
        })}
        render={<div style={region} />}
      >
        Right-click: an untagged song
      </ContextMenu>
    </div>
  );
}

const meta = {
  title: "UI/ContextMenu",
  component: Regions,
} satisfies Meta<typeof Regions>;

export default meta;

export const Open: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const target = within(canvasElement).getByText("Right-click: a tagged song");
    const box = target.getBoundingClientRect();
    await userEvent.pointer({
      keys: "[MouseRight]",
      target,
      coords: { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 },
    });
    await screen.findByRole("menu");
  },
};
