import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseGroup } from "../../ipc";
import { BrowseView } from "./BrowseView";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0 })),
  queryTracks: vi.fn(async () => []),
  allTrackIds: vi.fn(async () => []),
  browseGroups: vi.fn(async () => []),
  coverUrl: (hash: string) => `cover-url:${hash}`,
}));

function group(over: Partial<BrowseGroup> = {}): BrowseGroup {
  return {
    key: "Shields",
    secondary: "Grizzly Bear",
    trackCount: 10,
    durationMs: 600_000,
    coverHash: null,
    year: 2012,
    ...over,
  };
}

const initial = useLibraryStore.getState();

/**
 * jsdom reports every element as zero-sized, so the virtualizer would render
 * no rows and the grid would compute zero columns. Pin a real viewport.
 */
function stubLayout(height = 600, width = 320) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height,
    width,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  useLibraryStore.setState({ ...initial, groups: [], groupsLoading: false, search: "" });
});

describe("BrowseView", () => {
  it("labels an album with its title, artist and totals", () => {
    useLibraryStore.setState({ groups: [group()] });

    render(<BrowseView kind="albums" />);

    expect(screen.getByText("Shields")).toBeInTheDocument();
    expect(screen.getByText("Grizzly Bear")).toBeInTheDocument();
    expect(screen.getByText(/2012 · 10 songs/)).toBeInTheDocument();
  });

  it("names the untagged group instead of rendering a blank tile", () => {
    useLibraryStore.setState({ groups: [group({ key: null, secondary: null })] });

    render(<BrowseView kind="albums" />);

    expect(screen.getByText("Unknown Album")).toBeInTheDocument();
    expect(screen.getByText("Unknown Artist")).toBeInTheDocument();
  });

  it("shows a cover when there is one and nothing broken when there is not", () => {
    useLibraryStore.setState({ groups: [group({ coverHash: "abc" })] });
    // Queried directly rather than by role: the cover is decorative - the
    // album title sits right beside it - so it carries an empty alt and
    // therefore has no img role to find it by.
    const { container, rerender } = render(<BrowseView kind="albums" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "cover-url:abc");

    useLibraryStore.setState({ groups: [group({ coverHash: null })] });
    rerender(<BrowseView kind="albums" />);

    // Not an <img> with a placeholder source: that is a request that fails and
    // an icon chosen by the browser.
    expect(container.querySelector("img")).toBeNull();
  });

  it("gives artists and genres no cover and no subtitle", () => {
    useLibraryStore.setState({ groups: [group({ secondary: "Grizzly Bear" })] });

    const { container } = render(<BrowseView kind="artists" />);

    expect(screen.queryByText("Grizzly Bear")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens the group that was activated", async () => {
    const user = userEvent.setup();
    const openGroup = vi.fn(async () => undefined);
    useLibraryStore.setState({ groups: [group()], tab: "albums", openGroup });

    render(<BrowseView kind="albums" />);
    await user.click(screen.getByRole("button", { name: /Shields/ }));

    expect(openGroup).toHaveBeenCalledWith(expect.objectContaining({ key: "Shields" }));
  });

  it("is reachable from the keyboard, being the way into a group", async () => {
    const user = userEvent.setup();
    const openGroup = vi.fn(async () => undefined);
    useLibraryStore.setState({ groups: [group()], tab: "albums", openGroup });

    render(<BrowseView kind="albums" />);
    await user.tab();
    await user.keyboard("{Enter}");

    expect(openGroup).toHaveBeenCalled();
  });

  it("tells an empty library apart from a search that matched nothing", () => {
    useLibraryStore.setState({ groups: [], search: "" });
    const { rerender } = render(<BrowseView kind="albums" />);
    expect(screen.getByText("No songs yet")).toBeInTheDocument();

    useLibraryStore.setState({ groups: [], search: "zzz" });
    rerender(<BrowseView kind="albums" />);
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it("says nothing while the groups are still loading", () => {
    useLibraryStore.setState({ groups: [], groupsLoading: true });

    render(<BrowseView kind="albums" />);

    // "No songs yet" flashing up before the first result would be a lie.
    expect(screen.queryByText("No songs yet")).not.toBeInTheDocument();
  });
});
