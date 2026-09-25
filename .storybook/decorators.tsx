import type { Decorator } from "@storybook/react-vite";

/** A panel on the view's own ground and at its own inset, as `StatisticsView` draws it. */
export const inStatsPanels: Decorator = (Story) => (
  <main className="content">
    <div className="stats-panels">
      <Story />
    </div>
  </main>
);
