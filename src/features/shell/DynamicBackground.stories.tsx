import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "../../components/ui/Sidebar";
import type { Colour } from "../../ipc";
import { usePlayerStore } from "../player/store";
import { DynamicBackground } from "./DynamicBackground";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";

/** A warm cover: rust, ochre and a dark plum. */
const PALETTE: Colour[] = [
  { r: 184, g: 84, b: 48 },
  { r: 214, g: 162, b: 72 },
  { r: 86, g: 42, b: 88 },
];

/** The blobs behind the sidebar's veil and the content pane's wash, as the window draws them. */
function Window() {
  return (
    <div className="app">
      <DynamicBackground />
      <div className="body">
        <Sidebar />
        <main className="content">
          <p className="empty-state">The content pane.</p>
        </main>
      </div>
    </div>
  );
}

const meta = {
  title: "Features/Shell/DynamicBackground",
  component: Window,
} satisfies Meta<typeof Window>;

export default meta;

export const WithPalette: StoryObj<typeof meta> = {
  beforeEach: () => {
    usePlayerStore.setState({ palette: PALETTE });
  },
};

/** Silence, or a cover with no colours to read: nothing behind the veils. */
export const WithoutPalette: StoryObj<typeof meta> = {};

/** Colour From Album Art turned off, with a palette to ignore. */
export const Off: StoryObj<typeof meta> = {
  beforeEach: () => {
    usePlayerStore.setState({ palette: PALETTE });
    useDynamicBackgroundStore.setState({ enabled: false });
  },
};
