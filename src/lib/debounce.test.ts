import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("debounce", () => {
  it("waits before running", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("collapses a burst into one call with the last arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    // What typing "abc" into the search box looks like.
    debounced("a");
    vi.advanceTimersByTime(50);
    debounced("ab");
    vi.advanceTimersByTime(50);
    debounced("abc");
    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("runs again for a call that arrives after the wait", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    vi.advanceTimersByTime(200);
    debounced("b");
    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("drops a pending call on cancel", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it("cancelling with nothing pending is harmless", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced.cancel();
    debounced("a");
    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("runs a pending call immediately on flush, and only once", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("a");
    debounced.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("flushing with nothing pending does nothing", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
