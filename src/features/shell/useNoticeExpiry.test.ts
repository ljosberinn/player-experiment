import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoticeExpiry } from "./useNoticeExpiry";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNoticeExpiry", () => {
  it("clears the value once ms has passed", () => {
    const clear = vi.fn();
    renderHook(() => useNoticeExpiry("Updated 1 song.", clear, 4000));

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(clear).toHaveBeenCalledOnce();
  });

  it("does nothing while there is no value", () => {
    const clear = vi.fn();
    renderHook(() => useNoticeExpiry(null, clear, 4000));

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(clear).not.toHaveBeenCalled();
  });

  it("restarts the timer for a value that replaces one still on screen", () => {
    const clear = vi.fn();
    const { rerender } = renderHook(({ value }) => useNoticeExpiry(value, clear, 4000), {
      initialProps: { value: "Updated 1 song." },
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender({ value: "Updated 2 songs." });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Would have fired at the original 4s mark without a restart.
    expect(clear).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clear).toHaveBeenCalledOnce();
  });

  it("cancels the timer on unmount", () => {
    const clear = vi.fn();
    const { unmount } = renderHook(() => useNoticeExpiry("Updated 1 song.", clear, 4000));

    unmount();
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(clear).not.toHaveBeenCalled();
  });
});
