import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";

/**
 * The three states of a box and the two of a radio, on whichever ground the
 * toolbar has selected.
 *
 * Live rather than drawn beside each other: the states are chosen by the
 * input's own `:checked` and `:indeterminate`, and a specimen that faked them
 * with a class would be documenting a rule the sheet does not have. Click
 * them.
 */
function States() {
  const [organise, setOrganise] = useState(true);
  const [compilations, setCompilations] = useState(false);
  const [mixed, setMixed] = useState(false);
  const [scope, setScope] = useState("all");

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* The sheet's own row, and its own labels. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <Checkbox label="Organise library" checked={organise} onChange={setOrganise} />
        <Checkbox label="Include compilations" checked={compilations} onChange={setCompilations} />
        <Checkbox label="Mixed" checked={mixed} mixed={!mixed} onChange={setMixed} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <Radio
          name="scope"
          value="all"
          label="All songs"
          checked={scope === "all"}
          onChange={setScope}
        />
        <Radio
          name="scope"
          value="matched"
          label="Matched only"
          checked={scope === "matched"}
          onChange={setScope}
        />
      </div>

      {/* Disabled is the one state worth drawing beside the others: it dims
          the whole row rather than the mark, which is only visible where
          there is a label to dim with it. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <Checkbox label="Ticked and disabled" checked disabled onChange={() => undefined} />
        <Checkbox label="Empty and disabled" checked={false} disabled onChange={() => undefined} />
        <Radio
          name="off"
          value="off"
          label="Disabled"
          checked={false}
          disabled
          onChange={() => undefined}
        />
      </div>

      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        Every mark is 15px inside a 24px target — drag a selection across the row to see where one
        ends and the next begins. Tab for the focus ring, which sits on the mark rather than on the
        target.
      </p>
    </div>
  );
}

const meta = {
  title: "Primitives/Checkbox and Radio",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
