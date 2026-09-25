import type { Meta, StoryObj } from "@storybook/react-vite";
import { Streak } from "./Streak";

const days = (value: number) => `${value.toLocaleString()} ${value === 1 ? "day" : "days"}`;

/** In the reader's own date format, as `StreakPanel` writes it. */
const span = (from: Date, to: Date) => `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`;

/** A run at its record, one short of it, none at all, and before the answer lands. */
function States() {
  return (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 32,
      }}
    >
      <Streak
        current={23}
        longest={23}
        span={span(new Date(2026, 8, 3), new Date(2026, 8, 25))}
        days={[true, true, true, true, true, true, true]}
        format={days}
      />
      <Streak
        current={4}
        longest={61}
        span={span(new Date(2024, 0, 2), new Date(2024, 2, 2))}
        days={[true, false, false, true, true, true, true]}
        format={days}
      />
      <Streak
        current={0}
        longest={0}
        days={[false, false, false, false, false, false, false]}
        format={days}
      />
      <Streak current={undefined} longest={undefined} days={[]} format={days} />
    </div>
  );
}

const meta = {
  title: "Primitives/Streak",
  component: States,
} satisfies Meta<typeof States>;

export default meta;

export const State: StoryObj<typeof meta> = {};
