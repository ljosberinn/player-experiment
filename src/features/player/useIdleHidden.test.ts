import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "./store";
import { IDLE_HIDE_MS, useIdleHidden } from "./useIdleHidden";

function set(state: Partial<ReturnType<typeof usePlayerStore.getState>>) {
  act(() => {
    usePlayerStore.setState(state);
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useIdleHidden", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.setState({ status: "stopped", positionMs: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides after five paused minutes, not before", () => {
    const { result } = renderHook(() => useIdleHidden());
    set({ status: "paused" });

    wait(IDLE_HIDE_MS - 1);
    expect(result.current).toBe(false);

    wait(1);
    expect(result.current).toBe(true);
  });

  it("counts a launch that restores a paused song from the start", () => {
    usePlayerStore.setState({ status: "paused" });
    const { result } = renderHook(() => useIdleHidden());

    wait(IDLE_HIDE_MS);
    expect(result.current).toBe(true);
  });

  it("never hides while playing", () => {
    const { result } = renderHook(() => useIdleHidden());
    set({ status: "playing" });

    wait(IDLE_HIDE_MS * 2);
    expect(result.current).toBe(false);
  });

  it("restarts the clock on a resume and a pause", () => {
    const { result } = renderHook(() => useIdleHidden());
    set({ status: "paused" });
    wait(IDLE_HIDE_MS - 1);

    set({ status: "playing" });
    wait(1);
    set({ status: "paused" });
    wait(IDLE_HIDE_MS - 1);
    expect(result.current).toBe(false);

    wait(1);
    expect(result.current).toBe(true);
  });

  it("restarts the clock on a seek while paused", () => {
    const { result } = renderHook(() => useIdleHidden());
    set({ status: "paused", positionMs: 10_000 });
    wait(IDLE_HIDE_MS - 1);

    set({ positionMs: 15_000 });
    wait(IDLE_HIDE_MS - 1);
    expect(result.current).toBe(false);
  });

  it("shows the bar again on a play or a seek after hiding", () => {
    const { result } = renderHook(() => useIdleHidden());
    set({ status: "paused", positionMs: 10_000 });
    wait(IDLE_HIDE_MS);
    expect(result.current).toBe(true);

    // The arrow keys and Previous move a paused song without changing status.
    set({ positionMs: 0 });
    expect(result.current).toBe(false);

    wait(IDLE_HIDE_MS);
    set({ status: "playing" });
    expect(result.current).toBe(false);
  });
});
