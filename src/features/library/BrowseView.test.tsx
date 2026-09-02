import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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

/** `.browse-body`'s `padding: 0 30px 30px` in `App.css`. */
const BODY_PADDING = 60;

/**
 * jsdom reports every element as zero-sized, so the virtualizer would render
 * no rows and the grid would compute zero columns. Pin a real viewport.
 *
 * `width` is the width of the *section*, which is the box a row of tiles has
 * to fit in. The scroll container around it reports that plus its padding, the
 * way a real one does - measuring that box instead is what made the grid
 * overflow sideways.
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
    get(this: HTMLElement) {
      return this.classList.contains("browse-body") ? width + BODY_PADDING : width;
    },
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
  useLibraryStore.setState({
    ...initial,
    groups: [],
    groupsLoading: false,
    search: "",
    browseOffsets: { albums: 0, artists: 0, genres: 0 },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function groups(count: number): BrowseGroup[] {
  return Array.from({ length: count }, (_, index) => group({ key: `Group ${index}` }));
}

/** What the store writes when a search changes what the tabs list. */
function forgetOffsets(): void {
  useLibraryStore.setState((state) => ({
    browseOffsets: { albums: 0, artists: 0, genres: 0 },
    browseListToken: state.browseListToken + 1,
  }));
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

    // 200px fits one 168px tile and nothing of a second.
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

  it("counts the columns against the row's width, not the padding around it", () => {
    useLibraryStore.setState({ groups: groups(8) });
    // Two tiles need 346px and three need 524, so a 520px row holds two. The
    // container reports 580, which is where a third tile came from - and it
    // then hung 4px past the last one the user could see.
    stubLayout(600, 520);

    const { container } = render(<BrowseView kind="albums" />);

    expect(rowsIn(container)[0]?.querySelectorAll(".browse-tile")).toHaveLength(2);
    expect(rowsIn(container)).toHaveLength(4);
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

  it("measures the container that appears after the empty state", () => {
    stubLayout(600, 800);
    useLibraryStore.setState({ groups: [], groupsLoading: false });

    const { container } = render(<BrowseView kind="albums" />);
    expect(screen.getByText("No songs yet")).toBeInTheDocument();

    act(() => {
      useLibraryStore.setState({ groups: groups(8) });
    });

    // 800px fits four tiles, so eight albums are two rows. Eight rows would
    // mean the grid never measured the container it only just grew.
    expect(rowsIn(container)).toHaveLength(2);
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

describe("where each tab was left", () => {
  /** Four tiles fit at 800px, so a row is four albums. */
  const WIDE = 800;

  it("opens the same tab where it was scrolled to", () => {
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    const first = render(<BrowseView kind="albums" />);
    const scroll = screen.getByTestId("browse-scroll");
    // Row 8 of four columns: group 32 is at the top.
    scroll.scrollTop = 8 * 235;
    act(() => {
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    first.unmount();

    expect(useLibraryStore.getState().browseOffsets.albums).toBe(32);

    render(<BrowseView kind="albums" />);
    expect(screen.getByTestId("browse-scroll").scrollTop).toBe(8 * 235);
  });

  it("opens a different tab at the top rather than at the other one's offset", () => {
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    const albums = render(<BrowseView kind="albums" />);
    const scroll = screen.getByTestId("browse-scroll");
    scroll.scrollTop = 8 * 235;
    act(() => {
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    albums.unmount();

    render(<BrowseView kind="artists" />);

    // The whole bug: one container, so the list opened at the grid's offset -
    // and the reflow correction then rewrote it in the grid's row height.
    expect(screen.getByTestId("browse-scroll").scrollTop).toBe(0);
  });

  it("remembers the group rather than the pixel, so a resize between visits holds", () => {
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    const first = render(<BrowseView kind="albums" />);
    const scroll = screen.getByTestId("browse-scroll");
    scroll.scrollTop = 8 * 235;
    act(() => {
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    first.unmount();

    // Two columns now, so group 32 is row 16 rather than row 8.
    stubLayout(600, 400);
    render(<BrowseView kind="albums" />);

    expect(screen.getByTestId("browse-scroll").scrollTop).toBe(16 * 235);
  });

  it("waits for the groups before restoring, and does not restore twice", () => {
    useLibraryStore.setState({ groups: [], groupsLoading: false });
    useLibraryStore.getState().rememberBrowseOffset("albums", 32);
    stubLayout(600, WIDE);

    render(<BrowseView kind="albums" />);
    // The empty state has no container at all, so there is nothing to scroll.
    expect(screen.queryByTestId("browse-scroll")).toBeNull();

    act(() => {
      useLibraryStore.setState({ groups: groups(80) });
    });
    const scroll = screen.getByTestId("browse-scroll");
    expect(scroll.scrollTop).toBe(8 * 235);

    // A later group list is the user scrolling somewhere else's problem, not a
    // second restore of a position they have moved on from.
    scroll.scrollTop = 0;
    act(() => {
      useLibraryStore.setState({ groups: groups(60) });
    });
    expect(scroll.scrollTop).toBe(0);
  });

  it("leaves a restored offset alone on the first measurement of a mount", () => {
    // The trap: `columns` falls back to 1 until the width is known, so the
    // first commit at four columns looks like a reflow - which against a
    // restored offset would divide it by four.
    useLibraryStore.getState().rememberBrowseOffset("albums", 32);
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    render(<BrowseView kind="albums" />);

    expect(screen.getByTestId("browse-scroll").scrollTop).toBe(8 * 235);
  });

  it("survives the extra mount and unmount StrictMode runs in development", () => {
    useLibraryStore.getState().rememberBrowseOffset("albums", 32);
    // Arriving after the mount, which is the ordering that broke it: the first
    // mount has no rows to restore into, so the simulated unmount that follows
    // it recorded a scroll position of zero over the offset being waited for.
    useLibraryStore.setState({ groups: [], groupsLoading: true });
    stubLayout(600, WIDE);

    render(
      <StrictMode>
        <BrowseView kind="albums" />
      </StrictMode>,
    );
    act(() => {
      useLibraryStore.setState({ groups: groups(80), groupsLoading: false });
    });

    expect(useLibraryStore.getState().browseOffsets.albums).toBe(32);
    expect(screen.getByTestId("browse-scroll").scrollTop).toBe(8 * 235);
  });

  it("goes back to the top when a search changes what every tab lists", () => {
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    const open = render(<BrowseView kind="albums" />);
    const scroll = screen.getByTestId("browse-scroll");
    scroll.scrollTop = 8 * 235;
    act(() => {
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    act(() => forgetOffsets());

    // The tab on screen has already read the offsets, so a clearing is a
    // message it has to be given rather than one it will go and fetch.
    expect(scroll.scrollTop).toBe(0);

    // And the index it was left on points into a list that is gone.
    open.unmount();
    expect(useLibraryStore.getState().browseOffsets.albums).toBe(0);
  });

  it("keeps a restored offset rather than writing a zero back over it", () => {
    useLibraryStore.getState().rememberBrowseOffset("albums", 32);
    useLibraryStore.setState({ groups: groups(80) });
    stubLayout(600, WIDE);

    // Opened and left again without touching the scrollbar.
    render(<BrowseView kind="albums" />).unmount();

    expect(useLibraryStore.getState().browseOffsets.albums).toBe(32);
  });
});
