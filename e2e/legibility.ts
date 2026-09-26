import { browser } from "@wdio/globals";
import { contrast, flatten } from "./contrast";

/**
 * Each selector whose text falls under 4.5:1 against what it actually sits on,
 * as a line naming the pair. Selectors matching nothing are skipped.
 *
 * Shared because the player bar is only on screen once a song is loaded, so
 * its text is measured by a spec that runs after the library is seeded while
 * the rest of the chrome is measured by one that runs before.
 *
 * Only the foreground is named. The background is *resolved* by walking up to
 * the first ancestor that actually paints one, because naming it by hand is how
 * the first version of this check produced a false positive: it measured the
 * selected tab's white text against `.content-header` and reported 1.23:1,
 * when the tab paints its own accent fill and the real ratio is fine.
 */
export async function illegible(selectors: string[]): Promise<string[]> {
  const measured = await browser.execute(
    (all: string[]) =>
      all.map((selector) => {
        const element = document.querySelector(selector);
        if (element === null) {
          return { selector, text: "", behind: "", from: "" };
        }
        // Starts at the element itself and keeps going to the root: a
        // selected row is an 18% accent wash over the table, so the fill it
        // paints is not the colour its text actually sits on.
        let painter: Element | null = element;
        let from: Element | null = null;
        const stack: string[] = [];
        while (painter !== null) {
          const fill = getComputedStyle(painter).backgroundColor;
          if (fill !== "" && fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") {
            stack.push(fill);
            from ??= painter;
          }
          painter = painter.parentElement;
        }
        return {
          selector,
          text: getComputedStyle(element).color,
          behind: stack.length === 0 ? "" : JSON.stringify(stack),
          from: from === null ? "" : from.className.toString() || from.tagName,
        };
      }),
    selectors,
  );

  return (
    measured
      .filter((one) => one.text !== "" && one.behind !== "")
      .map((one) => ({ ...one, ratio: contrast(one.text, flatten(JSON.parse(one.behind))) }))
      // 4.5:1 is the WCAG AA threshold for body text.
      .filter((one) => one.ratio <= 4.5)
      .map(
        (one) =>
          `${one.selector} (${one.text}) on ${one.from} (${one.behind}) = ${one.ratio.toFixed(2)}:1`,
      )
  );
}
