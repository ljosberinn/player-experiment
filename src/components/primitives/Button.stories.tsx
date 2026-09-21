import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

/**
 * Every row of the sheet's button table, on whichever ground the toolbar has
 * selected.
 *
 * Hover and press are live rather than drawn beside the rest state: the only
 * drift-free way to show a `:hover` here would be to add a story-only class to
 * `library.css`, and story scaffolding has no business in the sheet - see
 * conventions. Point at them; the specimen is the real control.
 */
function Kinds() {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {/* The sheet's own row, and its own labels. One primary in it, which
            is the rule the kind exists for. */}
        <Button kind="primary">Play all</Button>
        <Button kind="secondary">Add to playlist</Button>
        <Button kind="ghost">Get tags</Button>
        {/* The one the sheet does not draw. It is here so the row it has to
            survive - beside a Cancel, in a dialog's footer - is visible. */}
        <Button kind="destructive">Delete</Button>
        <Button disabled>Disabled</Button>
      </div>

      {/* Disabled is drawn the same whatever kind asked for it, which is only
          visible with all four beside each other. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Button kind="primary" disabled>
          Play all
        </Button>
        <Button kind="secondary" disabled>
          Add to playlist
        </Button>
        <Button kind="ghost" disabled>
          Get tags
        </Button>
        <Button kind="destructive" disabled>
          Delete
        </Button>
      </div>

      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        Rest, above. Hover and press are live. Tab to a button for its focus ring - the primary
        takes its ring back in <code>--on-accent</code>, the accent being what it is filled with.
      </p>
    </div>
  );
}

const meta = {
  title: "Primitives/Button",
  component: Kinds,
} satisfies Meta<typeof Kinds>;

export default meta;

export const Kind: StoryObj<typeof meta> = {};
