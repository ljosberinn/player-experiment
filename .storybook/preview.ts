// The globals a story inherits from the app, in the order `main.tsx` has them.
// The sheet alone is not the app's typography - the faces are imported there
// rather than from `App.css`, and without them `--font-numeric` falls back to a
// system monospace and every specimen is drawn in the wrong figures.
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-700.css";
import "../src/App.css";
// After `App.css`, which is the only reason its one rule wins.
import "./preview.css";
import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    // The window fill is on `html` and the frame inherits it, so a story needs
    // no ground of its own - but the default `padded` layout would inset every
    // specimen by a rem that the app never applies.
    layout: "fullscreen",
  },
};

export default preview;
