import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SearchField } from "./SearchField";
import { Select } from "./Select";

const RANGES = [
  { value: "12m", label: "Last 12 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range", disabled: true },
] as const;

/**
 * The sheet's own pair, in the sheet's own row: a search field that takes the
 * width and a select that does not.
 *
 * The select's popup is the one part of this the sheet does not draw - it
 * draws a select closed - so the list borrows the context menu's panel. Open
 * it; that is the only way to see it.
 */
function Fields() {
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("12m");
  const [query, setQuery] = useState("");

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 170 }}>
          <div style={{ marginBottom: 5, color: "var(--muted)", fontSize: 11.5 }}>
            Search library
          </div>
          <SearchField
            label="Search library"
            value={query}
            placeholder="artist:Grima year>2015"
            onChange={setQuery}
          />
        </div>

        <div style={{ minWidth: 150 }}>
          <div style={{ marginBottom: 5, color: "var(--muted)", fontSize: 11.5 }}>Range</div>
          <Select label="Range" value={range} options={RANGES} onChange={setRange} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 150 }}>
          <Select label="Disabled" value={range} options={RANGES} disabled onChange={setRange} />
        </div>
        <div style={{ minWidth: 170 }}>
          <SearchField label="Disabled search" value="" disabled onChange={() => undefined} />
        </div>
      </div>

      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        Both take the accent edge the sheet draws on an active field — the select keeps it while its
        list is up. Custom range is disabled in the list: a value that exists but cannot be picked
        afresh is still shown, which is what a smart playlist saved against a disconnected account
        needs.
      </p>
    </div>
  );
}

const meta = {
  title: "Primitives/Select and SearchField",
  component: Fields,
} satisfies Meta<typeof Fields>;

export default meta;

export const Field: StoryObj<typeof meta> = {};
