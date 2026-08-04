import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeCrash, type CrashReport, lastCrash, revealCrashLog } from "../../ipc";
import { CrashNotice } from "./CrashNotice";

vi.mock("../../ipc", () => ({
  lastCrash: vi.fn(),
  acknowledgeCrash: vi.fn(),
  revealCrashLog: vi.fn(),
}));

const lastCrashMock = vi.mocked(lastCrash);
const acknowledgeCrashMock = vi.mocked(acknowledgeCrash);
const revealCrashLogMock = vi.mocked(revealCrashLog);

const REPORT: CrashReport = {
  when: 1_700_000_000,
  summary: "index out of bounds: the len is 0 but the index is 3",
  details: "when: 1700000000\nthread: player\npanic: index out of bounds\nbacktrace:\n   0: tick",
  path: "C:\\Users\\someone\\AppData\\Roaming\\dev.ljosberinn.player\\crashes.log",
};

beforeEach(() => {
  vi.clearAllMocks();
  acknowledgeCrashMock.mockResolvedValue();
  revealCrashLogMock.mockResolvedValue();
});

describe("CrashNotice", () => {
  it("says nothing when the last run ended normally", async () => {
    lastCrashMock.mockResolvedValue(null);
    render(<CrashNotice />);

    // Waited for rather than asserted immediately: the "nothing to say" case
    // renders nothing both before and after the call resolves, so an
    // assertion that ran first would pass without the answer having arrived.
    await waitFor(() => expect(lastCrashMock).toHaveBeenCalled());
    // By role rather than by container: the dialog portals to the body, so
    // the component's own subtree is empty either way and asserting on it
    // would pass whether or not a dialog had opened.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("stays quiet when the crash log cannot be read", async () => {
    // A launch that is otherwise fine should not gain an error banner because
    // the thing that reports errors could not be read.
    lastCrashMock.mockRejectedValue(new Error("the log is locked"));
    render(<CrashNotice />);

    await waitFor(() => expect(lastCrashMock).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reports the panic message, not just that something happened", async () => {
    lastCrashMock.mockResolvedValue(REPORT);
    render(<CrashNotice />);

    // `alertdialog`, not `dialog`: the difference is that a backdrop click
    // cannot dismiss it, which is the whole reason this is the Base UI part it
    // is. Asserting the role is asserting that.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/closed unexpectedly/)).toBeInTheDocument();
    expect(screen.getByText(REPORT.summary)).toBeInTheDocument();
    // The backtrace is behind a disclosure: it is what a bug report needs and
    // not what the sentence needs.
    expect(screen.queryByText(/backtrace/)).not.toBeInTheDocument();
  });

  it("shows the whole report on request, and hides it again", async () => {
    const user = userEvent.setup();
    lastCrashMock.mockResolvedValue(REPORT);
    render(<CrashNotice />);

    await user.click(await screen.findByRole("button", { name: "Show details" }));
    expect(screen.getByText(/backtrace/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText(/backtrace/)).not.toBeInTheDocument();
  });

  it("dismisses the crash rather than the session", async () => {
    const user = userEvent.setup();
    lastCrashMock.mockResolvedValue(REPORT);
    render(<CrashNotice />);

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    // The timestamp is what makes this "that crash" instead of "any crash":
    // acknowledging without it would silence the next one too.
    expect(acknowledgeCrashMock).toHaveBeenCalledWith(REPORT.when);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("closes on Escape, and counts that as having seen it", async () => {
    // The other route out of an alert dialog, and it has to mean the same
    // thing: someone who reads the message and presses Escape has seen the
    // crash, so being told about it again on the next launch would be a bug.
    const user = userEvent.setup();
    lastCrashMock.mockResolvedValue(REPORT);
    render(<CrashNotice />);

    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(acknowledgeCrashMock).toHaveBeenCalledWith(REPORT.when));
  });

  it("stays dismissed even if recording that failed", async () => {
    const user = userEvent.setup();
    lastCrashMock.mockResolvedValue(REPORT);
    acknowledgeCrashMock.mockRejectedValue(new Error("the database is locked"));
    render(<CrashNotice />);

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    // The cost of the failure is being told once more next launch, which is
    // not worth a dialog about failing to close a notice.
    await waitFor(() => expect(acknowledgeCrashMock).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("opens the log file, and says so when it cannot", async () => {
    const user = userEvent.setup();
    lastCrashMock.mockResolvedValue(REPORT);
    revealCrashLogMock.mockRejectedValue(new Error("no file manager"));
    render(<CrashNotice />);

    await user.click(await screen.findByRole("button", { name: "Show log file" }));

    expect(revealCrashLogMock).toHaveBeenCalled();
    // This one *is* worth reporting: the user asked for something and it did
    // not happen, unlike the two swallowed failures above.
    expect(await screen.findByText(/no file manager/)).toBeInTheDocument();
  });
});
