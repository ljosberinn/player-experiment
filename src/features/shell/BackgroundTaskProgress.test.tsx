import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTask } from "../../ipc";
import { onTaskProgress } from "../../ipc";
import { BackgroundTaskProgress } from "./BackgroundTaskProgress";
import { useBackgroundTaskStore } from "./backgroundTaskStore";

vi.mock("../../ipc", () => ({
  onTaskProgress: vi.fn(),
}));

const onTaskProgressMock = vi.mocked(onTaskProgress);

/** The handler the component registers, so a test can drive the channel. */
let emit: ((task: BackgroundTask | null) => void) | undefined;
const stop = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  emit = undefined;
  onTaskProgressMock.mockImplementation(async (handler) => {
    emit = handler;
    return stop;
  });
  // A module singleton: a task left running by one test would otherwise still
  // be on screen at the start of the next.
  useBackgroundTaskStore.setState({ task: null });
});

async function mounted() {
  const view = render(<BackgroundTaskProgress />);
  await waitFor(() => expect(emit).toBeDefined());
  return view;
}

describe("BackgroundTaskProgress", () => {
  it("says nothing while nothing is running", async () => {
    await mounted();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("names the task, how far it has got and how much longer", async () => {
    await mounted();

    act(() => {
      emit?.({ label: "Looking up releases", done: 402, total: 8044, etaMs: 45 * 3_600_000 });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Looking up releases · 5.00% · about 45 hours left",
    );
  });

  /** The producer says `null` when it stops, whatever stopped it. */
  it("goes away when the task ends", async () => {
    await mounted();
    act(() => {
      emit?.({ label: "Looking up releases", done: 402, total: 8044, etaMs: null });
    });

    act(() => {
      emit?.(null);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = await mounted();

    unmount();

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });
});
