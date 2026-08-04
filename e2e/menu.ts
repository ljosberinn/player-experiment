import { browser } from "@wdio/globals";

/**
 * Driving the menu bar, for the specs that need what is inside it.
 *
 * Shared since phase 34 rather than repeated: the actions three specs reach for
 * - Add Folder, Rescan - were toolbar buttons a selector away, and are now two
 * clicks and a popup. Three copies of that sequence would be three things to
 * fix the next time the bar moves.
 *
 * Selectors go through roles rather than class names. A menubar trigger and the
 * items inside its popup share `role="menuitem"`, so the trigger lookup is
 * scoped to the bar; without that, opening "File" could match an entry called
 * File inside some other menu.
 */

/** Opens a top-level menu and waits for its popup. */
export async function openMenu(name: string): Promise<void> {
  await browser.$(`//*[@role='menubar']//*[@role='menuitem'][normalize-space()='${name}']`).click();
  await browser
    .$(`//*[@role='menu'][@aria-label='${name}']`)
    .waitForExist({ timeout: 10_000, timeoutMsg: `the ${name} menu never opened` });
}

/** Opens a menu and chooses one of its entries. */
export async function chooseFromMenu(menu: string, item: string): Promise<void> {
  await openMenu(menu);
  await browser
    .$(`//*[@role='menu'][@aria-label='${menu}']//*[@role='menuitem'][normalize-space()='${item}']`)
    .click();
}

/** The labels inside an open menu, in order. */
export function itemsOf(name: string): Promise<string[]> {
  return browser.execute((menu: string) => {
    const popup = document.querySelector(`[role='menu'][aria-label='${menu}']`);
    if (popup === null) {
      return [];
    }
    return Array.from(popup.querySelectorAll("[role='menuitem']")).map((item) =>
      (item.textContent ?? "").trim(),
    );
  }, name);
}

/** Closes whatever menu is open, if one is. */
export async function closeMenu(): Promise<void> {
  await browser.keys("Escape");
  await browser.$("//*[@role='menu']").waitForExist({ timeout: 10_000, reverse: true });
}
