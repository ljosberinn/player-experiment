import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Switch } from "./Switch";

/** Both states of the sheet's switch, plus the one it does not draw. */
function States() {
  const [scrobble, setScrobble] = useState(true);
  const [offline, setOffline] = useState(false);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <Switch label="Scrobble" checked={scrobble} onChange={setScrobble} />
        <Switch label="Offline" checked={offline} onChange={setOffline} />
        <Switch label="Disabled" checked={false} disabled onChange={() => undefined} />
      </div>

      {/* Where the app would actually put one: a settings row with the label
          at the far left and the control at the right, named by `id` rather
          than by a label of its own. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          maxWidth: 320,
          padding: "8px 0",
          borderTop: "1px solid var(--chrome-border)",
          borderBottom: "1px solid var(--chrome-border)",
          fontSize: 13,
        }}
      >
        <label htmlFor="story-switch">Colour From Album Art</label>
        <Switch id="story-switch" checked={scrobble} onChange={setScrobble} />
      </div>

      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        The off track carries a <code>--track-border</code> edge the sheet does not draw: without it
        the whole control is 1.69:1 on the chrome. The knob is <code>--muted</code> on both grounds
        rather than the ground's own colour, which on light is 1.62:1 on its own track.
      </p>
    </div>
  );
}

const meta = {
  title: "Primitives/Switch",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
