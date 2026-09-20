import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

/**
 * What jsdom can actually see.
 *
 * The drawing is in `library.css` and no stylesheet is applied here, so every
 * assertion below is about markup a caller would otherwise have to get right
 * by hand at each site - which is the reason the primitives exist.
 */
describe("Button", () => {
  it("is not a submit button unless it is asked to be", () => {
    // A bare `<button>` inside a form submits it. That is how a dialog's
    // Cancel comes to save, and the default here is what stops every future
    // caller from having to remember.
    render(<Button>Cancel</Button>);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
  });

  it("does not act when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button kind="primary" disabled onClick={onClick}>
        Play all
      </Button>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("is named by its label rather than by its glyph", () => {
    // The icon is `aria-hidden`, as every icon in this app is, so the label
    // is the only accessible name there is - and it is announced once rather
    // than twice.
    render(<IconButton icon="play" label="Play" />);

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("claims a toggle state only when it has one", async () => {
    // `aria-pressed="false"` is a claim that this is a toggle currently off.
    // Most of these are not toggles at all, and a screen reader saying "not
    // pressed" about a Play button is worse than saying nothing.
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="play" label="Play" onClick={onClick} />);

    const plain = screen.getByRole("button", { name: "Play" });
    expect(plain).not.toHaveAttribute("aria-pressed");

    await user.click(plain);
    expect(onClick).toHaveBeenCalledOnce();

    render(<IconButton icon="repeat-one" label="Repeat one" pressed={false} />);

    expect(screen.getByRole("button", { name: "Repeat one" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
