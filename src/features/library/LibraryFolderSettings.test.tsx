import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countTracks, loadLibraryFolder, saveOrganizeLibrary, setLibraryRoot } from "../../ipc";
import { LibraryFolderSettings } from "./LibraryFolderSettings";

vi.mock("../../ipc", () => ({
  countTracks: vi.fn(async () => 0),
  defaultTrackQuery: {},
  loadLibraryFolder: vi.fn(async () => ({ root: null, organize: false })),
  saveOrganizeLibrary: vi.fn(async () => undefined),
  setLibraryRoot: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const picker = async () => vi.mocked((await import("@tauri-apps/plugin-dialog")).open);

function checkbox(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>("Organise My Library");
}

/** Picks a folder and says yes to what it costs. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole("button", { name }));
  await user.click(await screen.findByRole("button", { name: "Move Songs" }));
}

describe("the library folder section", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(loadLibraryFolder).mockResolvedValue({ root: null, organize: false });
    vi.mocked(countTracks).mockResolvedValue(8044);
    (await picker()).mockResolvedValue("D:\\Music");
  });

  it("opens on the stored folder and switch", async () => {
    vi.mocked(loadLibraryFolder).mockResolvedValue({ root: "D:\\Music", organize: true });
    const locked = vi.fn();
    render(<LibraryFolderSettings onLockChange={locked} />);

    expect(await screen.findByText("D:\\Music")).toBeInTheDocument();
    await waitFor(() => expect(checkbox().checked).toBe(true));
    // And tells the folder list below which of its rows this one is.
    expect(locked).toHaveBeenCalledWith("D:\\Music");
  });

  /// Filing with nowhere to file to is not a state the dialog can reach. The
  /// pass treats it as off in any case, which is the other half of the same
  /// rule.
  it("will not switch filing on until a folder is chosen", async () => {
    render(<LibraryFolderSettings onLockChange={vi.fn()} />);

    await waitFor(() => expect(checkbox()).toBeDisabled());
    expect(screen.getByText("None chosen")).toBeInTheDocument();
  });

  it("names what a new folder costs before it commits to it", async () => {
    const user = userEvent.setup();
    render(<LibraryFolderSettings onLockChange={vi.fn()} />);
    await waitFor(() => expect(checkbox()).toBeDisabled());

    await user.click(screen.getByRole("button", { name: "Choose…" }));

    // The count, because every file in the library is off its target the
    // moment the root changes - the picker is where that cost is committed.
    // The thousands separator is the runner's locale, so only the digits are
    // asserted.
    expect(await screen.findByText(/8.044 songs will be moved into D:\\Music/)).toBeInTheDocument();
    expect(setLibraryRoot).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Move Songs" }));
    await waitFor(() => expect(setLibraryRoot).toHaveBeenCalledWith("D:\\Music"));
    expect(await screen.findByText("D:\\Music")).toBeInTheDocument();
    await waitFor(() => expect(checkbox()).toBeEnabled());
  });

  it("moves nothing when the question is answered no", async () => {
    const user = userEvent.setup();
    render(<LibraryFolderSettings onLockChange={vi.fn()} />);
    await waitFor(() => expect(checkbox()).toBeDisabled());

    await user.click(screen.getByRole("button", { name: "Choose…" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(setLibraryRoot).not.toHaveBeenCalled();
    expect(screen.getByText("None chosen")).toBeInTheDocument();
  });

  it("does not ask about the folder that is already in use", async () => {
    vi.mocked(loadLibraryFolder).mockResolvedValue({ root: "D:\\Music", organize: false });
    const user = userEvent.setup();
    render(<LibraryFolderSettings onLockChange={vi.fn()} />);
    await screen.findByText("D:\\Music");

    await user.click(screen.getByRole("button", { name: "Change…" }));

    expect(screen.queryByRole("button", { name: "Move Songs" })).not.toBeInTheDocument();
  });

  /// In the section rather than on the status bar: it is about the folder the
  /// user has this moment chosen, and it is where they will choose another.
  it("says in the section when a folder is refused", async () => {
    vi.mocked(setLibraryRoot).mockRejectedValue("That folder is too deep inside other folders.");
    const user = userEvent.setup();
    render(<LibraryFolderSettings onLockChange={vi.fn()} />);
    await waitFor(() => expect(checkbox()).toBeDisabled());

    await choose(user, "Choose…");

    expect(await screen.findByText(/too deep inside other folders/)).toBeInTheDocument();
    expect(screen.getByText("None chosen")).toBeInTheDocument();
  });

  it("stores the switch and reports what it locks", async () => {
    vi.mocked(loadLibraryFolder).mockResolvedValue({ root: "D:\\Music", organize: false });
    const locked = vi.fn();
    const user = userEvent.setup();
    render(<LibraryFolderSettings onLockChange={locked} />);
    await waitFor(() => expect(checkbox()).toBeEnabled());

    await user.click(checkbox());
    expect(saveOrganizeLibrary).toHaveBeenCalledWith(true);
    expect(locked).toHaveBeenLastCalledWith("D:\\Music");

    // And off again releases it: the folder stays, the lock does not.
    await user.click(checkbox());
    expect(saveOrganizeLibrary).toHaveBeenLastCalledWith(false);
    expect(locked).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("D:\\Music")).toBeInTheDocument();
  });
});
