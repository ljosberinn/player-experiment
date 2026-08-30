import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseGroup } from "../../ipc";
import { BrowseView } from "./BrowseView";
import { useLibraryStore } from "./store";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(),
  libraryStats: vi.fn(async () => ({ tracks: 0, durationMs: 0, bytes: 0, missing: 0 })),
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

/**
 * The observer callbacks the view has registered, so a test can resize.
 *
 * The setup file's `ResizeObserver` never calls back - jsdom has no layout for
 * it to report - so a test that wants a resize has to stub the size and then
 * fire the callback itself.
 */
let resizes: Array<(entries: unknown[]) => void> = [];

beforeEach(() => {
  vi.restoreAllMocks();
  stubLayout();
  resizes = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        resizes.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useLibraryStore.setState({ ...initial, groups: [], groupsLoading: false, search: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function groups(count: number): BrowseGroup[] {
  return Array.from({ length: count }, (_, index) => group({ key: `Group ${index}` }));
}

function rowsIn(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(".browse-row")];
}

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

  it("reflows the album grid when the container changes width", () => {
    useLibraryStore.setState({ groups: groups(8) });
    stubLayout(600, 200);

    const { container } = render(<BrowseView kind="albums" />);

    // 200px fits one 178px tile.
    expect(rowsIn(container)).toHaveLength(8);

    stubLayout(600, 800);
    act(() => {
      for (const resize of resizes) {
        resize([]);
      }
    });

    // 800px fits four, so the same eight albums are two rows.
    expect(rowsIn(container)).toHaveLength(2);
  });

  it("keeps the album at the top of the view there across a reflow", () => {
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, 800);

    const { container } = render(<BrowseView kind="albums" />);
    const scroll = screen.getByTestId("browse-scroll");
    // Four columns, so row 5 starts at group 20.
    scroll.scrollTop = 5 * 235;

    stubLayout(600, 400);
    act(() => {
      for (const resize of resizes) {
        resize([]);
      }
    });

    // Two columns now, and group 20 is row 10. Without the correction the
    // offset would still say row 5, which is group 10 under the new width.
    expect(scroll.scrollTop).toBe(10 * 235);
    expect(rowsIn(container)).not.toHaveLength(0);
  });

  it("stripes the artist and genre lists by data index", () => {
    useLibraryStore.setState({ groups: groups(5) });

    const { container } = render(<BrowseView kind="artists" />);

    // Parity of the row's place in the data, not of its place in the DOM: the
    // DOM holds the visible window, which slides as the list scrolls.
    expect(rowsIn(container).map((row) => row.classList.contains("odd"))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("leaves the album grid unstriped", () => {
    useLibraryStore.setState({ groups: groups(5) });

    const { container } = render(<BrowseView kind="albums" />);

    // Tiles, not rows. A band of colour behind every other line of covers is
    // striping the layout rather than the data.
    expect(rowsIn(container).some((row) => row.classList.contains("odd"))).toBe(false);
  });

  it("says nothing while the groups are still loading", () => {
    useLibraryStore.setState({ groups: [], groupsLoading: true });

    render(<BrowseView kind="albums" />);

    // "No songs yet" flashing up before the first result would be a lie.
    expect(screen.queryByText("No songs yet")).not.toBeInTheDocument();
  });
});
