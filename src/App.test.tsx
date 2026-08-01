import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAppInfo } from "./ipc";

vi.mock("./ipc", () => ({ getAppInfo: vi.fn() }));

const getAppInfoMock = vi.mocked(getAppInfo);

describe("App", () => {
  beforeEach(() => {
    getAppInfoMock.mockReset();
  });

  it("shows a loading state until the backend answers", () => {
    getAppInfoMock.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders the name and version reported by the backend", async () => {
    getAppInfoMock.mockResolvedValue({ name: "player", version: "0.1.0" });

    render(<App />);

    expect(await screen.findByText("player 0.1.0")).toBeInTheDocument();
  });

  it("surfaces a backend failure as an alert", async () => {
    getAppInfoMock.mockRejectedValue("database is locked");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database is locked");
  });
});
