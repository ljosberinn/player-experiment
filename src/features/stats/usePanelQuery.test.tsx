import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelQuery } from "./usePanelQuery";

vi.mock("../shell/statusStore", () => ({ report: vi.fn() }));

const reported = async () => vi.mocked((await import("../shell/statusStore")).report);

/** A promise plus the handle to settle it, so a test can hold one in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("usePanelQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is loading until the first answer lands", async () => {
    const first = deferred<number>();
    const { result } = renderHook(() => usePanelQuery(() => first.promise, []));

    expect(result.current).toEqual({ data: null, loading: true });

    first.resolve(7);
    await waitFor(() => expect(result.current).toEqual({ data: 7, loading: false }));
  });

  it("ignores an answer to the question before last", async () => {
    // Two ranges picked in quick succession. Without the cancel the slower of
    // the two wins whichever it was, and the panel draws the range the filter
    // bar is not showing.
    const slow = deferred<string>();
    const fast = deferred<string>();
    const { result, rerender } = renderHook(
      ({ run, key }: { run: () => Promise<string>; key: number }) => usePanelQuery(run, [key]),
      { initialProps: { run: () => slow.promise, key: 1 } },
    );

    rerender({ run: () => fast.promise, key: 2 });
    fast.resolve("this year");
    await waitFor(() => expect(result.current.data).toBe("this year"));

    slow.resolve("all time");
    await new Promise((settle) => setTimeout(settle, 0));
    expect(result.current.data).toBe("this year");
  });

  it("keeps the drawn answer while the next one is in flight", async () => {
    // Blanking every panel to a skeleton on each range change makes the whole
    // view flash; what is drawn is the answer to the question before last.
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ run, key }: { run: () => Promise<string>; key: number }) => usePanelQuery(run, [key]),
      { initialProps: { run: () => first.promise, key: 1 } },
    );

    first.resolve("all time");
    await waitFor(() => expect(result.current.data).toBe("all time"));

    rerender({ run: () => second.promise, key: 2 });
    expect(result.current).toEqual({ data: "all time", loading: true });
  });

  it("reports a failure instead of leaving the skeleton up", async () => {
    const failing = deferred<number>();
    const { result } = renderHook(() => usePanelQuery(() => failing.promise, []));

    failing.reject(new Error("no such column"));
    await waitFor(() => expect(result.current).toEqual({ data: null, loading: false }));
    expect(await reported()).toHaveBeenCalledOnce();
  });
});
