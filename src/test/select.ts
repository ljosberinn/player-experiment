import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

/**
 * Driving the drawn `Select` from a test.
 *
 * Phase 111 replaced the app's `<select>`s, and with them the three things
 * every test that touched one was written against: `selectOptions`, which only
 * works on a real `<select>`; `.value`, which a `<button>` does not have; and
 * the `<option>`s themselves, which used to sit in the document whether the
 * select was open or shut. A drawn select mounts its list on open, so all
 * three become a click and a read.
 *
 * Here rather than repeated per file because five specs need them, and because
 * a select that changes how it opens again should be one edit.
 */

/** The trigger, by the accessible name its label or `label` prop gives it. */
export function select(name: string | RegExp): HTMLElement {
  return screen.getByRole("combobox", { name });
}

/** What a select is showing, in place of the `.value` a `<select>` had. */
export function showing(name: string | RegExp): string {
  // The trigger holds the value *and* the chevron, and the chevron is an
  // `aria-hidden` SVG with no text - so the trigger's text content is the
  // label of the chosen item and nothing else.
  return select(name).textContent ?? "";
}

/** Opens a select and hands back the list it dropped. */
async function openList(name: string | RegExp): Promise<HTMLElement> {
  const user = userEvent.setup();

  await user.click(select(name));

  return await screen.findByRole("listbox");
}

/**
 * Shuts an open list again and waits for it to go.
 *
 * Waits on the *role* rather than on the node: Base UI leaves the popup in the
 * document after it closes, for an exit animation jsdom never finishes, and
 * hides it instead - so `waitForElementToBeRemoved` waits forever while every
 * role query has already stopped seeing it.
 */
async function shut(): Promise<void> {
  await userEvent.setup().keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

/**
 * Opens a select and picks an option, by the two names a reader would use.
 *
 * `option` is matched against the label rather than the value: the label is
 * what is on screen, and a test asserting on storage keys would go on passing
 * after the list started showing something else.
 */
export async function choose(name: string | RegExp, option: string | RegExp): Promise<void> {
  const user = userEvent.setup();

  // Scoped to the listbox this trigger dropped, so a page with two open
  // selects - or a popup that has not unmounted yet - cannot be picked from
  // by accident.
  const listbox = await openList(name);

  await user.click(within(listbox).getByRole("option", { name: option }));
}

/**
 * The labels a select is offering, with the list shut again afterwards.
 *
 * Shut, because a test that asks this of two selects in a row would otherwise
 * be clicking the second trigger through the first one's popup.
 */
export async function offered(name: string | RegExp): Promise<string[]> {
  const listbox = await openList(name);
  const labels = within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");

  await shut();

  return labels;
}

/**
 * Whether a select will let an option be picked.
 *
 * `toBeDisabled` is no use here: it reads the `disabled` *attribute*, which
 * only form elements carry, and a drawn option is a `<div role="option">` that
 * says so in ARIA instead.
 */
export async function offers(name: string | RegExp, option: string | RegExp): Promise<boolean> {
  const listbox = await openList(name);
  const pickable =
    within(listbox).getByRole("option", { name: option }).getAttribute("aria-disabled") !== "true";

  await shut();

  return pickable;
}
