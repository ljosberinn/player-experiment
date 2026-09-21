import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUnattendedLookup, revealMainLog } from "../../ipc";
import { choose, select, showing } from "../../test/select";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";
import { useLookupStore } from "./lookupStore";
import { type SettingsCategory, SettingsDialog } from "./SettingsDialog";
import { useStatusStore } from "./statusStore";
import { useThemeStore } from "./themeStore";

vi.mock("../../ipc", () => ({
  loadDynamicBackground: vi.fn(async () => true),
  saveDynamicBackground: vi.fn(async () => undefined),
  loadZoom: vi.fn(async () => null),
  saveZoom: vi.fn(async () => undefined),
  loadTheme: vi.fn(async () => null),
  saveTheme: vi.fn(async () => undefined),
  listWatchFolders: vi.fn(async () => []),
  loadWatchInterval: vi.fn(async () => 15),
  removeWatchFolder: vi.fn(async () => undefined),
  saveWatchInterval: vi.fn(async () => undefined),
  revealMainLog: vi.fn(async () => undefined),
  loadUnattendedLookup: vi.fn(async () => false),
  saveUnattendedLookup: vi.fn(async () => undefined),
  loadLibraryFolder: vi.fn(async () => ({ root: null, organize: false })),
  saveOrganizeLibrary: vi.fn(async () => undefined),
  setLibraryRoot: vi.fn(async () => undefined),
  countTracks: vi.fn(async () => 0),
  defaultTrackQuery: {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

function checkbox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: "Colour From Album Art" });
}

/** The scrolling pane, which is the one panel mounted. */
function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".modal-body");
  if (found === null) {
    throw new Error("the dialog has no scrolling pane");
  }
  return found;
}

/** Something that belongs to one category and no other. */
const MARKERS: Record<SettingsCategory, () => HTMLElement | null> = {
  appearance: () => screen.queryByText("Interface Zoom"),
  library: () => screen.queryByLabelText("Organise My Library"),
  online: () => screen.queryByLabelText("Look Up Releases Online"),
  about: () => screen.queryByRole("button", { name: "Show Log File" }),
};

const LABELS: Record<SettingsCategory, string> = {
  appearance: "Appearance",
  library: "Library",
  online: "Online",
  about: "About",
};

describe("the Settings dialog", () => {
  beforeEach(() => {
    useDynamicBackgroundStore.setState({ enabled: true });
    useLookupStore.setState({ enabled: false });
    useThemeStore.setState({ preference: "system", ground: "light" });
  });

  it("offers the three theme choices and reports the stored one", async () => {
    const user = userEvent.setup();
    useThemeStore.setState({ preference: "dark", ground: "dark" });
    render(<SettingsDialog onClose={vi.fn()} />);

    // The label rather than the stored key since phase 111 drew the control:
    // the trigger is a button, and what it holds is the text on screen.
    expect(showing("Theme")).toBe("Dark");

    // "System" is one of them: a two-state control could not say "follow the
    // OS", and there would be no way back to it once the user had chosen.
    // The list is only in the DOM while it is open.
    await user.click(select("Theme"));

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
  });

  it("changes the ground without waiting for the write", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    await choose("Theme", "Light");

    expect(useThemeStore.getState().preference).toBe("light");
    // Through the real port, all the way to the attribute the stylesheet keys
    // off. Asserting the store alone would have left the last hop untested,
    // and that hop is the whole mechanism: nothing in React reads the ground.
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("offers four categories, and opens on Appearance", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // The popup renders as the tabs' root; it has to stay the named dialog.
    expect(screen.getByRole("dialog", { name: "Settings" })).toContainElement(
      screen.getByRole("tablist"),
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(Object.values(LABELS));
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it.each(Object.keys(MARKERS) as SettingsCategory[])(
    "shows %s's controls and none of the others'",
    async (category) => {
      const user = userEvent.setup();
      render(<SettingsDialog onClose={vi.fn()} />);

      await user.click(screen.getByRole("tab", { name: LABELS[category] }));

      expect(screen.getByRole("tab", { name: LABELS[category] })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(LABELS[category]);
      for (const [other, marker] of Object.entries(MARKERS)) {
        if (other === category) {
          expect(marker()).toBeInTheDocument();
        } else {
          expect(marker()).not.toBeInTheDocument();
        }
      }
    },
  );

  it("opens on the category it is asked for", () => {
    render(<SettingsDialog category="online" onClose={vi.fn()} />);

    // Account ▸ Connect to last.fm… lands here, not a category away.
    expect(screen.getByRole("tab", { name: "Online" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "last.fm" })).toBeInTheDocument();
  });

  it("scrolls the pane without the rail, the heading or Done", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    // The dialog keeps one size and one scroller; anything inside the pane
    // would travel with a long folder list.
    expect(pane()).not.toContainElement(screen.getByRole("tablist"));
    expect(pane()).not.toContainElement(screen.getByRole("heading", { level: 2 }));
    expect(pane()).not.toContainElement(screen.getByRole("button", { name: "Done" }));
    expect(pane()).toContainElement(screen.getByText("Interface Zoom"));
  });

  it("shows the background switch in the state the store is in", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(checkbox()).toBeChecked();
  });

  it("turns the background off, and the store with it", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);

    await user.click(checkbox());

    expect(useDynamicBackgroundStore.getState().enabled).toBe(false);
    expect(checkbox()).not.toBeChecked();
  });

  it("reflects a background that is already off", () => {
    useDynamicBackgroundStore.setState({ enabled: false });
    render(<SettingsDialog onClose={vi.fn()} />);

    // The dialog reads the store rather than holding its own copy: it can be
    // opened, closed and reopened, and the second time has to agree with the
    // first.
    expect(checkbox()).not.toBeChecked();
  });

  it("carries the interface zoom", () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("opens the activity log in the file manager", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog category="about" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Show Log File" }));

    expect(vi.mocked(revealMainLog)).toHaveBeenCalled();
  });

  it("reports a file manager that would not open, rather than failing silently", async () => {
    vi.mocked(revealMainLog).mockRejectedValueOnce(new Error("no file manager"));
    const user = userEvent.setup();
    render(<SettingsDialog category="about" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Show Log File" }));

    expect(useStatusStore.getState().message).toContain("no file manager");
  });

  it("carries the library folder above the music folders", () => {
    render(<SettingsDialog category="library" onClose={vi.fn()} />);

    // Above, because it is the stronger statement of the same thing: what the
    // app does to the library while nobody is watching.
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["Library Folder", "Music Folders"]);
    expect(screen.getByLabelText("Check For Changes")).toBeInTheDocument();
  });

  it("opts the library into looking releases up online", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog category="online" onClose={vi.fn()} />);
    const lookup = screen.getByRole("checkbox", { name: "Look Up Releases Online" });

    expect(lookup).not.toBeChecked();
    await user.click(lookup);

    expect(useLookupStore.getState().enabled).toBe(true);
    expect(lookup).toBeChecked();
  });

  it("reads the stored preference when it opens", async () => {
    vi.mocked(loadUnattendedLookup).mockResolvedValueOnce(true);
    render(<SettingsDialog category="online" onClose={vi.fn()} />);

    // Loaded on open rather than at startup: nothing outside this dialog
    // draws from it.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Look Up Releases Online" })).toBeChecked();
    });
  });
});
