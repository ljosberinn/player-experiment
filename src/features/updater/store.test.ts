import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdaterPorts } from "./store";
import { useUpdaterStore } from "./store";

function ports(over: Partial<UpdaterPorts> = {}): UpdaterPorts {
  return {
    check: vi.fn(async () => null),
    relaunch: vi.fn(async () => {}),
    ...over,
  };
}

/** An update the backend says is available. */
function available(version = "0.3.0", downloadAndInstall = vi.fn(async () => {})) {
  return { version, downloadAndInstall };
}

const initial = useUpdaterStore.getState();

beforeEach(() => {
  useUpdaterStore.setState({ ...initial, status: "idle", version: null, error: null });
});

describe("the updater", () => {
  it("says nothing when there is nothing to install", async () => {
    const p = ports();

    await useUpdaterStore.getState().check(p);

    // The common case by far. It must leave no trace in the UI.
    expect(useUpdaterStore.getState().status).toBe("idle");
    expect(useUpdaterStore.getState().version).toBeNull();
  });

  it("downloads without asking, then offers the restart", async () => {
    const update = available("0.3.0");
    const p = ports({ check: vi.fn(async () => update) });

    await useUpdaterStore.getState().check(p);

    // Downloading needs no decision, and asking first only means the user
    // waits after saying yes.
    expect(update.downloadAndInstall).toHaveBeenCalled();
    expect(useUpdaterStore.getState()).toMatchObject({ status: "ready", version: "0.3.0" });
  });

  it("stays quiet when the check fails", async () => {
    const p = ports({
      check: vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    });

    await useUpdaterStore.getState().check(p);

    // Being offline is the ordinary case, not a fault worth reporting. The
    // state is kept so a later tick can retry.
    expect(useUpdaterStore.getState().status).toBe("failed");
    expect(useUpdaterStore.getState().version).toBeNull();
  });

  it("retries after a failure but not while one is in flight", async () => {
    const check = vi.fn(async () => null);

    useUpdaterStore.setState({ status: "failed" });
    await useUpdaterStore.getState().check(ports({ check }));
    expect(check).toHaveBeenCalledOnce();

    useUpdaterStore.setState({ status: "downloading" });
    await useUpdaterStore.getState().check(ports({ check }));
    // A timer tick must not restart a download that is already running.
    expect(check).toHaveBeenCalledOnce();
  });

  it("does not check again once an update is ready", async () => {
    const check = vi.fn(async () => null);
    useUpdaterStore.setState({ status: "ready", version: "0.3.0" });

    await useUpdaterStore.getState().check(ports({ check }));

    // Re-checking would throw away a finished download for no gain.
    expect(check).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });

  it("restarts into the new version when asked", async () => {
    const relaunch = vi.fn(async () => {});
    useUpdaterStore.setState({ status: "ready", version: "0.3.0" });

    await useUpdaterStore.getState().install(ports({ relaunch }));

    expect(relaunch).toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("installing");
  });

  it("installs nothing that is not ready", async () => {
    const relaunch = vi.fn(async () => {});
    useUpdaterStore.setState({ status: "downloading" });

    await useUpdaterStore.getState().install(ports({ relaunch }));

    expect(relaunch).not.toHaveBeenCalled();
  });

  it("stays offerable when the restart fails", async () => {
    const relaunch = vi.fn(async () => {
      throw new Error("denied");
    });
    useUpdaterStore.setState({ status: "ready", version: "0.3.0" });

    await useUpdaterStore.getState().install(ports({ relaunch }));

    // The download is still on disk and will be applied on the next manual
    // start, so the offer must not disappear.
    expect(useUpdaterStore.getState().status).toBe("ready");
  });
});
