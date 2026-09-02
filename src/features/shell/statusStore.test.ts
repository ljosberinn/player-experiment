import { beforeEach, describe, expect, it } from "vitest";
import { dismiss, notify, report, useStatusStore } from "./statusStore";

beforeEach(() => {
  useStatusStore.setState({ message: null, notice: null });
});

describe("reporting a failure", () => {
  it("stringifies whatever the catch caught", () => {
    report(new Error("the database is locked"));

    expect(useStatusStore.getState().message).toBe("Error: the database is locked");
  });

  it("takes a bare string, which is what the backend's error event carries", () => {
    report("no audio output device");

    expect(useStatusStore.getState().message).toBe("no audio output device");
  });

  it("keeps the newest failure rather than queueing behind the first", () => {
    // One popover, so a second failure has to replace the first: holding it
    // back would show a message about something the user has moved on from.
    report("the library is locked");
    report("that file will not open");

    expect(useStatusStore.getState().message).toBe("that file will not open");
  });

  it("dismisses", () => {
    report("the library is locked");

    dismiss();

    expect(useStatusStore.getState().message).toBeNull();
  });
});

describe("the notice line", () => {
  it("holds the last thing that happened", () => {
    notify("Added 2 songs to Evening.");

    expect(useStatusStore.getState().notice).toBe("Added 2 songs to Evening.");
  });

  it("dismisses on its own, without touching the popover", () => {
    // Two slots, two lifetimes: the notice expires after a few seconds and the
    // message waits to be dismissed, so neither may clear the other.
    report("the library is locked");
    notify("Added 2 songs to Evening.");

    useStatusStore.getState().dismissNotice();

    expect(useStatusStore.getState().notice).toBeNull();
    expect(useStatusStore.getState().message).toBe("the library is locked");
  });

  it("survives a dismissed popover", () => {
    notify("Added 2 songs to Evening.");
    report("the library is locked");

    dismiss();

    expect(useStatusStore.getState().notice).toBe("Added 2 songs to Evening.");
  });
});
