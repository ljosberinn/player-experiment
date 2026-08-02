import { describe, expect, it, vi } from "vitest";
import {
  dropIndexFor,
  hasTrackIds,
  readTrackIds,
  setDragImage,
  setTrackIds,
  TRACK_IDS_MIME,
} from "./drag";

/** A stand-in for `DataTransfer`, which jsdom does not implement usefully. */
function dataTransfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    setData: (format: string, data: string) => void store.set(format, data),
    getData: (format: string) => store.get(format) ?? "",
    get types() {
      return [...store.keys()];
    },
  };
}

describe("track drag payload", () => {
  it("round-trips the dragged ids", () => {
    const data = dataTransfer();
    setTrackIds(data, [3, 1, 2]);

    expect(readTrackIds(data)).toEqual([3, 1, 2]);
    expect(hasTrackIds(data)).toBe(true);
  });

  it("keeps the ids in the order they were dragged in", () => {
    const data = dataTransfer();
    setTrackIds(data, [9, 4, 7]);

    // Order is what "append to the playlist" writes, so it is not incidental.
    expect(readTrackIds(data)).toEqual([9, 4, 7]);
  });

  it("treats a drag from somewhere else as not ours", () => {
    const foreign = dataTransfer({ "text/plain": "hello", "text/uri-list": "https://example.com" });

    expect(hasTrackIds(foreign)).toBe(false);
    expect(readTrackIds(foreign)).toEqual([]);
  });

  it("survives a payload that is not the JSON it claims to be", () => {
    // A drop handler sees payloads it never created, so this has to be "not
    // ours" rather than an exception thrown out of an event handler.
    expect(readTrackIds(dataTransfer({ [TRACK_IDS_MIME]: "{not json" }))).toEqual([]);
    expect(readTrackIds(dataTransfer({ [TRACK_IDS_MIME]: '"a string"' }))).toEqual([]);
    expect(readTrackIds(dataTransfer({ [TRACK_IDS_MIME]: '{"ids":[1]}' }))).toEqual([]);
  });

  it("drops entries in the array that are not usable ids", () => {
    const data = dataTransfer({ [TRACK_IDS_MIME]: '[1, "2", null, 3, NaN]' });

    // NaN is not valid JSON, so that payload fails to parse entirely; the
    // point is that nothing non-numeric ever reaches the backend.
    expect(readTrackIds(dataTransfer({ [TRACK_IDS_MIME]: '[1, "2", null, 3]' }))).toEqual([1, 3]);
    expect(readTrackIds(data)).toEqual([]);
  });
});

describe("dropIndexFor", () => {
  it("puts a drop on the upper half above the row", () => {
    expect(dropIndexFor(4, 0, 22)).toBe(4);
    expect(dropIndexFor(4, 10, 22)).toBe(4);
  });

  it("puts a drop on the lower half below the row", () => {
    expect(dropIndexFor(4, 11, 22)).toBe(5);
    expect(dropIndexFor(4, 21, 22)).toBe(5);
  });

  it("can express a drop after the last row", () => {
    // Without the lower half resolving to index+1 there would be no way to
    // move something to the very end.
    expect(dropIndexFor(9, 20, 22)).toBe(10);
  });
});

describe("setDragImage", () => {
  it("carries a count rather than a picture of the table", () => {
    const setDragImageSpy = vi.fn();
    const cleanUp = setDragImage({ dataTransfer: { setDragImage: setDragImageSpy } }, 7);

    expect(setDragImageSpy).toHaveBeenCalled();
    const [badge] = setDragImageSpy.mock.calls[0] as [HTMLElement];
    expect(badge.textContent).toBe("7 songs");
    cleanUp();
  });

  it("says it in the singular for one", () => {
    const setDragImageSpy = vi.fn();
    const cleanUp = setDragImage({ dataTransfer: { setDragImage: setDragImageSpy } }, 1);

    const [badge] = setDragImageSpy.mock.calls[0] as [HTMLElement];
    expect(badge.textContent).toBe("1 song");
    cleanUp();
  });

  it("puts the badge in the document so it can be rasterized", () => {
    const setDragImageSpy = vi.fn();
    const cleanUp = setDragImage({ dataTransfer: { setDragImage: setDragImageSpy } }, 2);

    // Off-screen rather than hidden: display:none and visibility:hidden both
    // make it unrasterizable, so it would silently do nothing.
    expect(document.querySelector(".drag-badge")).not.toBeNull();

    cleanUp();
    expect(document.querySelector(".drag-badge")).toBeNull();
  });

  it("survives a DataTransfer that cannot take one", () => {
    // jsdom's DataTransfer has no setDragImage, and neither will some
    // synthetic events - a missing method must not break the drag itself.
    expect(() => setDragImage({ dataTransfer: {} }, 3)()).not.toThrow();
  });
});
