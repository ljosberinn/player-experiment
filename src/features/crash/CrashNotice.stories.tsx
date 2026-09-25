import type { Meta, StoryObj } from "@storybook/react-vite";
import { crashHandlers } from "../../../.storybook/handlers";
import { CrashNotice } from "./CrashNotice";

const meta = {
  title: "Features/Crash",
  component: CrashNotice,
  parameters: { ipc: crashHandlers },
} satisfies Meta<typeof CrashNotice>;

export default meta;

/** The launch after a panic. */
export const Crashed: StoryObj<typeof meta> = {};

/** Every other launch: nothing to draw. */
export const NoCrash: StoryObj<typeof meta> = {
  parameters: { ipc: { last_crash: () => null } },
};
