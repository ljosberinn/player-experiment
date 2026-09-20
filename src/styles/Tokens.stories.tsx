import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

type Token = { name: string; value: string; isColor: boolean };

/**
 * Every custom property declared on `:root`, in the order the sheet declares
 * them - which is the order the palette is commented in, so the groups come out
 * for free.
 *
 * Read from the live `CSSStyleSheet` rather than written out here on purpose. A
 * hand-kept list would prove the sheet reached the frame exactly once and then
 * go quietly stale; this one cannot, and it is what 107, 108 and 109 are read
 * against while they rewrite the block underneath it.
 */
function readRootTokens(): Token[] {
  const seen = new Map<string, string>();
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
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") {
        continue;
      }
      for (const name of Array.from(rule.style)) {
        // `--lightningcss-light` and `--lightningcss-dark` are not ours.
        // Vite's minifier appends them to `:root` when it lowers
        // `color-scheme`, so the built sheet declares two properties the source
        // does not and `storybook dev` does not show - and one of them,
        // `initial`, passes for a colour and would be drawn as a swatch.
        if (name.startsWith("--") && !name.startsWith("--lightningcss-")) {
          seen.set(name, rule.style.getPropertyValue(name).trim());
        }
      }
    }
  }
  return Array.from(seen, ([name, value]) => ({
    name,
    value,
    isColor: CSS.supports("color", value),
  }));
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
            <span style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
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
