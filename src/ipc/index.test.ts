import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { getAppInfo } from "./index";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("getAppInfo", () => {
  it("invokes the get_app_info command and returns its payload", async () => {
    invokeMock.mockResolvedValue({ name: "player", version: "0.1.0" });

    await expect(getAppInfo()).resolves.toEqual({ name: "player", version: "0.1.0" });
    expect(invokeMock).toHaveBeenCalledWith("get_app_info");
  });
});
