import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "./Icon";
import { ICONS, type IconName } from "./registry";

/** Every size a call site draws at, from the nudge caret to the play button. */
const SIZES = [10, 11, 12, 13, 14, 15, 17, 19, 20, 24];

/** Read off the registry, so an icon added there shows up here unasked. */
const NAMES = Object.keys(ICONS) as IconName[];

/** Every icon at every size, in `--text` on the window ground. */
function Sheet() {
  return (
    <table style={{ margin: 24, borderCollapse: "collapse", color: "var(--text)", fontSize: 12 }}>
      <thead>
        <tr>
          <th />
          {SIZES.map((size) => (
            <th
              key={size}
              scope="col"
              style={{ padding: "0 10px 10px", color: "var(--muted)", fontWeight: 400 }}
            >
              {size}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {NAMES.map((name) => (
          <tr key={name} style={{ borderTop: "1px solid var(--chrome-border)" }}>
            <th
              scope="row"
              style={{ padding: "6px 16px 6px 0", textAlign: "left", fontWeight: 400 }}
            >
              <code>{name}</code>
            </th>
            {SIZES.map((size) => (
              <td key={size} style={{ padding: "6px 10px", textAlign: "center" }}>
                <Icon name={name} size={size} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const meta = {
  title: "Primitives/Icon",
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;

export const Every: StoryObj<typeof meta> = {};
