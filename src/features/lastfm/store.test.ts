import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lastfmBeginConnect,
  lastfmCompleteConnect,
  lastfmDisconnect,
  lastfmImport,
  lastfmStatus,
  type WriteProgress,
} from "../../ipc";
import { useStatusStore } from "../shell/statusStore";
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, useLastfmStore } from "./store";

vi.mock("../../ipc", () => ({
  lastfmStatus: vi.fn(async () => ({ configured: true, username: null, queued: 0, import: null })),
  lastfmBeginConnect: vi.fn(async () => ({
    token: "tok",
    authorizeUrl: "https://www.last.fm/api/auth/?api_key=KEY&token=tok",
  })),
  lastfmCompleteConnect: vi.fn(async () => null),
  lastfmDisconnect: vi.fn(async () => undefined),
  lastfmImport: vi.fn(),
  onLastfmImport: vi.fn(async (handler: (progress: WriteProgress) => void) => {
    importHandler = handler;
    return () => {
      importHandler = null;
    };
  }),
  onLastfmDisconnected: vi.fn(async (handler: () => void) => {
    disconnectedHandler = handler;
    return () => {
      disconnectedHandler = null;
    };
  }),
  onLastfmQueued: vi.fn(async (handler: (depth: number) => void) => {
    queuedHandler = handler;
    return () => {
      queuedHandler = null;
    };
  }),
}));

/** The handler the mocked `onLastfmDisconnected` last registered. */
let disconnectedHandler: (() => void) | null = null;
let queuedHandler: ((depth: number) => void) | null = null;
let importHandler: ((progress: WriteProgress) => void) | null = null;

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

const asMock = vi.mocked;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useLastfmStore.setState({
    configured: false,
    username: null,
    connecting: false,
    queued: 0,
    error: null,
    imported: null,
    importing: false,
    importProgress: null,
  });
  useStatusStore.setState({ message: null, notice: null });
  asMock(lastfmStatus).mockResolvedValue({
    configured: true,
    username: null,
    queued: 0,
    import: null,
  });
  asMock(lastfmBeginConnect).mockResolvedValue({
    token: "tok",
    authorizeUrl: "https://www.last.fm/api/auth/?api_key=KEY&token=tok",
  });
  asMock(lastfmCompleteConnect).mockResolvedValue(null);
  asMock(lastfmDisconnect).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the last.fm store", () => {
  it("starts with nothing, which is what an app that has not read the setting should offer", () => {
    const state = useLastfmStore.getState();
    expect(state.configured).toBe(false);
    expect(state.username).toBe(null);
  });

  it("loads the stored status", async () => {
    asMock(lastfmStatus).mockResolvedValue({
      configured: true,
      username: "listener",
      queued: 3,
      import: null,
    });

    await useLastfmStore.getState().load();

    expect(useLastfmStore.getState().username).toBe("listener");
    expect(useLastfmStore.getState().configured).toBe(true);
  });

  it("carries the backlog the status reported", async () => {
    asMock(lastfmStatus).mockResolvedValue({
      configured: true,
      username: "listener",
      queued: 3,
      import: null,
    });

    await useLastfmStore.getState().load();

    expect(useLastfmStore.getState().queued).toBe(3);
  });

  it("follows the backlog as the scrobbler drains it", async () => {
    await useLastfmStore.getState().watch();

    queuedHandler?.(7);
    expect(useLastfmStore.getState().queued).toBe(7);

    // Including back to nothing: a count the pane cannot clear is a count that
    // worries the user forever.
    queuedHandler?.(0);
    expect(useLastfmStore.getState().queued).toBe(0);
  });

  it("says nothing when the status cannot be read", async () => {
    asMock(lastfmStatus).mockRejectedValue(new Error("database is locked"));

    await useLastfmStore.getState().load();

    // No error on screen: the app has simply not connected an account, which
    // is the state it also starts in.
    expect(useLastfmStore.getState().error).toBe(null);
    expect(useLastfmStore.getState().configured).toBe(false);
  });

  it("opens the browser at the page last.fm named, and nowhere it built itself", async () => {
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(openUrl).toHaveBeenCalledWith("https://www.last.fm/api/auth/?api_key=KEY&token=tok");
    expect(useLastfmStore.getState().connecting).toBe(true);

    useLastfmStore.getState().cancelConnect();
  });

  it("keeps asking until the user has finished in the browser", async () => {
    asMock(lastfmCompleteConnect)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("listener");

    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(lastfmCompleteConnect).toHaveBeenCalledTimes(3);
    expect(lastfmCompleteConnect).toHaveBeenLastCalledWith("tok");
    expect(useLastfmStore.getState().username).toBe("listener");
    expect(useLastfmStore.getState().connecting).toBe(false);
  });

  it("stops asking once it has an answer", async () => {
    asMock(lastfmCompleteConnect).mockResolvedValue("listener");

    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(lastfmCompleteConnect).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than polling for the token's whole hour", async () => {
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS);

    expect(useLastfmStore.getState().connecting).toBe(false);
    expect(useLastfmStore.getState().username).toBe(null);
    expect(useLastfmStore.getState().error).toMatch(/not authorised in time/);

    const calls = asMock(lastfmCompleteConnect).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(asMock(lastfmCompleteConnect).mock.calls.length).toBe(calls);
  });

  it("cancelling stops the poll for good", async () => {
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const calls = asMock(lastfmCompleteConnect).mock.calls.length;

    useLastfmStore.getState().cancelConnect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);

    expect(useLastfmStore.getState().connecting).toBe(false);
    expect(asMock(lastfmCompleteConnect).mock.calls.length).toBe(calls);
  });

  it("a second Connect retires the first, so one browser trip cannot answer for another", async () => {
    // The failure this guards: press Connect, wait, press it again. Without a
    // generation counter the first loop is still running against a token the
    // user has abandoned, and whichever lands first wins.
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    asMock(lastfmBeginConnect).mockResolvedValue({
      token: "tok-2",
      authorizeUrl: "https://www.last.fm/api/auth/?api_key=KEY&token=tok-2",
    });
    asMock(lastfmCompleteConnect).mockResolvedValue("listener");

    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(useLastfmStore.getState().username).toBe("listener");
    expect(lastfmCompleteConnect).toHaveBeenLastCalledWith("tok-2");
  });

  it("reports a connect that failed outright", async () => {
    asMock(lastfmBeginConnect).mockRejectedValue(new Error("could not reach last.fm"));

    await useLastfmStore.getState().connect();

    expect(useLastfmStore.getState().connecting).toBe(false);
    expect(useLastfmStore.getState().error).toMatch(/could not reach last.fm/);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("disconnecting forgets the account and any trip in progress", async () => {
    useLastfmStore.setState({ username: "listener" });
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(0);

    await useLastfmStore.getState().disconnect();
    const calls = asMock(lastfmCompleteConnect).mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(lastfmDisconnect).toHaveBeenCalled();
    expect(useLastfmStore.getState().username).toBe(null);
    expect(useLastfmStore.getState().connecting).toBe(false);
    expect(asMock(lastfmCompleteConnect).mock.calls.length).toBe(calls);
  });

  it("forgets the account when the backend says the key was rejected", async () => {
    // Not something the user did: the key was revoked from last.fm's own
    // settings screen, and the scrobbler thread found out. The Account menu is
    // claiming an account that no longer works until this lands.
    useLastfmStore.setState({ configured: true, username: "listener" });
    await useLastfmStore.getState().watch();

    disconnectedHandler?.();

    expect(useLastfmStore.getState().username).toBe(null);
    expect(useLastfmStore.getState().error).toMatch(/Connect again/);
    // Still a build that can connect - it is the account that went, not the
    // key this binary was compiled with.
    expect(useLastfmStore.getState().configured).toBe(true);
  });

  it("a rejection lands even mid-trip, and stops the poll", async () => {
    await useLastfmStore.getState().watch();
    void useLastfmStore.getState().connect();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const calls = asMock(lastfmCompleteConnect).mock.calls.length;

    disconnectedHandler?.();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(useLastfmStore.getState().connecting).toBe(false);
    expect(asMock(lastfmCompleteConnect).mock.calls.length).toBe(calls);
  });

  it("keeps the account when disconnecting fails, rather than lying about it", async () => {
    useLastfmStore.setState({ username: "listener" });
    asMock(lastfmDisconnect).mockRejectedValue(new Error("database is locked"));

    await useLastfmStore.getState().disconnect();

    expect(useLastfmStore.getState().username).toBe("listener");
    expect(useLastfmStore.getState().error).toMatch(/database is locked/);
  });

  describe("importing a history", () => {
    const DONE = { username: "listener", through: 1_700_000_000, resumable: false };

    it("records where the import got to and says how many plays it added", async () => {
      asMock(lastfmImport).mockResolvedValue({ imported: 1234, state: DONE });

      await useLastfmStore.getState().importHistory("listener", false);

      expect(lastfmImport).toHaveBeenCalledWith("listener", false);
      expect(useLastfmStore.getState().imported).toEqual(DONE);
      expect(useLastfmStore.getState().importing).toBe(false);
      expect(useStatusStore.getState().notice).toContain(`${(1234).toLocaleString()} plays`);
    });

    it("follows the progress while it runs and forgets it after", async () => {
      await useLastfmStore.getState().watch();
      let finish: (value: { imported: number; state: typeof DONE }) => void = () => {};
      asMock(lastfmImport).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

      const running = useLastfmStore.getState().importHistory("listener", false);
      importHandler?.({ done: 200, total: 1000 });
      expect(useLastfmStore.getState().importing).toBe(true);
      expect(useLastfmStore.getState().importProgress).toEqual({ done: 200, total: 1000 });

      // A second press while one runs is not a second import.
      await useLastfmStore.getState().importHistory("listener", true);
      expect(lastfmImport).toHaveBeenCalledTimes(1);

      finish({ imported: 0, state: DONE });
      await running;
      expect(useLastfmStore.getState().importProgress).toBe(null);
    });

    it("reports a failure and picks up the resume point it left behind", async () => {
      asMock(lastfmImport).mockRejectedValue("last.fm stopped answering. Import again to resume.");
      const stopped = { username: "listener", through: null, resumable: true };
      asMock(lastfmStatus).mockResolvedValue({
        configured: true,
        username: null,
        queued: 0,
        import: stopped,
      });

      await useLastfmStore.getState().importHistory("listener", false);

      expect(useStatusStore.getState().message).toMatch(/Import again to resume/);
      expect(useLastfmStore.getState().imported).toEqual(stopped);
      expect(useLastfmStore.getState().importing).toBe(false);
    });
  });
});
