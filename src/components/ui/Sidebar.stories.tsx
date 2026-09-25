import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PLAYLISTS, playlist } from "../../../.storybook/fixtures";
import type { ViewTab } from "../../features/library/store";
import type { Playlist } from "../../ipc";
import { Icon } from "../icons/Icon";
import { LibraryNav } from "./LibraryNav";
import { Sidebar } from "./Sidebar";
import { SidebarSection } from "./SidebarSection";

/** Enough playlists that a window-high sidebar has to scroll. */
const MANY = Array.from({ length: 24 }, (_, index) =>
  playlist(10 + index, `Mix ${index + 1}`, (index * 13) % 90),
);

function Rows({ playlists }: { playlists: Playlist[] }) {
  return (
    <ul>
      {playlists.map((entry) => (
        <li key={entry.id}>
          <button type="button" className="sidebar-item" aria-label={entry.name}>
            <Icon
              name={entry.kind === "smart" ? "smart-playlist" : "playlist"}
              size={17}
              className="sidebar-icon"
            />
            <span className="sidebar-label">{entry.name}</span>
            <span className="sidebar-count">{entry.trackCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddButton({ label }: { label: string }) {
  return (
    <button type="button" className="sidebar-add" aria-label={label} title={label}>
      +
    </button>
  );
}

/**
 * One sidebar, as the window draws it: LIBRARY, then a section with its +
 * button that folds, then one long enough to scroll.
 *
 * `LibraryNav` is the real one, so the keyboard walks real rows: Tab lands on
 * the open view and the arrows go on into the playlists. With the playlist
 * store at rest it draws no built-ins.
 */
function Source() {
  const [view, setView] = useState<ViewTab>("songs");
  const [folded, setFolded] = useState({ smart: false, playlists: true, mixes: false });
  const fold = (key: keyof typeof folded) => () =>
    setFolded((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="body" style={{ height: 640 }}>
      <Sidebar>
        <LibraryNav active={view} onSelect={setView} />
        <SidebarSection
          id="story-smart"
          title="Smart Playlists"
          collapsed={folded.smart}
          onToggle={fold("smart")}
          actions={<AddButton label="New smart playlist" />}
        >
          <Rows playlists={PLAYLISTS.filter((entry) => entry.kind === "smart")} />
        </SidebarSection>
        <SidebarSection
          id="story-playlists"
          title="Playlists"
          collapsed={folded.playlists}
          onToggle={fold("playlists")}
          actions={<AddButton label="New playlist" />}
        >
          <Rows playlists={PLAYLISTS.filter((entry) => entry.kind === "static")} />
        </SidebarSection>
        <SidebarSection
          id="story-mixes"
          title="Mixes"
          collapsed={folded.mixes}
          onToggle={fold("mixes")}
        >
          <Rows playlists={MANY} />
        </SidebarSection>
      </Sidebar>
    </div>
  );
}

const meta = {
  title: "UI/Sidebar",
  component: Source,
} satisfies Meta<typeof Source>;

export default meta;

export const State: StoryObj<typeof meta> = {};
