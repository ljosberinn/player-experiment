import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutFor, targetOwns } from "./shortcuts";

describe("shortcutFor", () => {
  it.each([
    [" ", "toggle"],
    ["MediaPlayPause", "toggle"],
    ["MediaTrackNext", "next"],
    ["MediaTrackPrevious", "previous"],
    ["ArrowRight", "seekForward"],
    ["ArrowLeft", "seekBackward"],
    ["ArrowUp", "volumeUp"],
    ["ArrowDown", "volumeDown"],
  ])("maps %s", (key, expected) => {
    expect(shortcutFor({ key })).toBe(expected);
  });

  it("ignores keys it does not own", () => {
    expect(shortcutFor({ key: "a" })).toBeNull();
    expect(shortcutFor({ key: "Enter" })).toBeNull();
    expect(shortcutFor({ key: "Tab" })).toBeNull();
  });

  it("leaves modified keys to the OS and to menu accelerators", () => {
    expect(shortcutFor({ key: " ", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: " ", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "ArrowRight", altKey: true })).toBeNull();
  });

  it("still fires with shift held, which nothing here uses", () => {
    expect(shortcutFor({ key: " ", shiftKey: true })).toBe("toggle");
  });
});

describe("isTypingTarget", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT"])("claims %s", (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it("claims contenteditable elements", () => {
    const element = document.createElement("div");
    element.contentEditable = "true";
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(element, "isContentEditable", { value: true });
    expect(isTypingTarget(element)).toBe(true);
  });

  it("leaves ordinary elements and a missing target alone", () => {
    expect(isTypingTarget(document.createElement("tr"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("targetOwns", () => {
  function range() {
    const input = document.createElement("input");
    input.type = "range";
    return input;
  }

  it("leaves a slider the arrows it moves on", () => {
    expect(targetOwns(range(), "seekForward")).toBe(true);
    expect(targetOwns(range(), "volumeUp")).toBe(true);
  });

  it("lets play/pause through a focused slider", () => {
    expect(targetOwns(range(), "toggle")).toBe(false);
  });

  it("leaves every shortcut to a text field", () => {
    expect(targetOwns(document.createElement("input"), "toggle")).toBe(true);
    expect(targetOwns(document.createElement("textarea"), "toggle")).toBe(true);
  });

  it("claims nothing on an ordinary element", () => {
    expect(targetOwns(document.createElement("tr"), "toggle")).toBe(false);
    expect(targetOwns(null, "seekForward")).toBe(false);
  });
});
