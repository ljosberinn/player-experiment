import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

type Token = { name: string; value: string; isColor: boolean };

/**
 * Every custom property the sheet declares on a `:root`, in declaration order -
 * which is the order the palette is commented in, so the groups come out free.
 *
 * The *names* come from the live `CSSStyleSheet` and the *values* from
 * `getComputedStyle`, and the split is deliberate. Since phase 108 there are
 * three `:root` blocks - one shared, one per ground - so a rule's own
 * `style.getPropertyValue` reports whichever block it was read from rather
 * than what is actually drawn. Resolving against `documentElement` instead
 * gives the value in force on the ground the toolbar has selected, which is
 * the only value worth putting on a specimen sheet.
 *
 * Read from the sheet rather than written out here for the same reason as
 * before: a hand-kept list would prove the sheet reached the frame exactly
 * once and then go quietly stale.
 */
function readRootTokens(): Token[] {
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet throws on `cssRules`. None of ours is, but a
      // Storybook addon's might be, and one addon must not empty the sheet.
      continue;
    }
    for (const rule of Array.from(rules)) {
      // `includes` rather than equality: the two ground blocks are
      // `:root[data-theme="…"]`, and the light one is a selector list.
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(":root")) {
        continue;
      }
      for (const name of Array.from(rule.style)) {
        // `--lightningcss-light` and `--lightningcss-dark` are not ours.
        // Vite's minifier appends them to `:root` when it lowers
        // `color-scheme`, so the built sheet declares two properties the source
        // does not and `storybook dev` does not show - and one of them,
        // `initial`, passes for a colour and would be drawn as a swatch.
        if (name.startsWith("--") && !name.startsWith("--lightningcss-")) {
          names.add(name);
        }
      }
    }
  }

  const resolved = getComputedStyle(document.documentElement);
  return Array.from(names, (name) => {
    const value = resolved.getPropertyValue(name).trim();
    return { name, value, isColor: CSS.supports("color", value) };
  });
}

/** Two grounds and an ink behind each swatch, so an alpha token reads as one. */
function Swatch({ token }: { token: Token }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        width: 72,
        height: 32,
        border: "1px solid var(--chrome-border)",
      }}
    >
      {["var(--sidebar)", "var(--surface)", "var(--text)"].map((behind) => (
        <div key={behind} style={{ background: behind }}>
          <div style={{ width: "100%", height: "100%", background: token.value }} />
        </div>
      ))}
    </div>
  );
}

function TokenSheet() {
  // The sheet is only in the document once the module graph has run, so this
  // cannot be read during the first render.
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => {
    setTokens(readRootTokens());

    // Re-read when the toolbar flips the ground. Watching the attribute rather
    // than taking the Storybook global as an argument keeps the story ignorant
    // of how the ground got set: it is the same `data-theme` the app's own
    // `themeStore` writes, so this specimen reflects the mechanism it
    // documents rather than a parallel one.
    const observer = new MutationObserver(() => {
      setTokens(readRootTokens());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div style={{ padding: 24, color: "var(--text)" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600 }}>Tokens</h1>
      <p style={{ margin: "0 0 20px", color: "var(--muted)" }}>
        {/* Every weight `main.tsx` imports is drawn here on purpose: a specimen
            that only ever set 400 would pass with the other two missing. */}
        <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{tokens.length}</span>{" "}
        custom properties on <code style={{ fontWeight: 600 }}>:root</code>. One face draws all of
        it; figures are tabular wherever they line up against each other.
      </p>
      <div style={{ display: "grid", gap: 1, background: "var(--chrome-border)" }}>
        {tokens.map((token) => (
          <div
            key={token.name}
            style={{
              display: "grid",
              gridTemplateColumns: "88px 220px 1fr",
              alignItems: "center",
              gap: 16,
              padding: "6px 8px",
              background: "var(--surface)",
            }}
          >
            {token.isColor ? <Swatch token={token} /> : <span />}
            <span>{token.name}</span>
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {token.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Tokens",
  component: TokenSheet,
} satisfies Meta<typeof TokenSheet>;

export default meta;

export const Sheet: StoryObj<typeof meta> = {};
