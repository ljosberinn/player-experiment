import { TaskLine } from "../../components/primitives/TaskLine";
import type { WriteProgress } from "../../ipc";

/**
 * How far a tag write has got, for the footer of the dialog that started it.
 *
 * `done === total` is every file written and the library transaction behind
 * them still running: `tags::write::apply` reports nothing while it does, and
 * over a whole library it is the longest part of the write. A total of zero is
 * the write before its first event, which knows only that it is running.
 */
export function WriteLine({ progress }: { progress: WriteProgress | null }) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const headline =
    total === 0
      ? "Writing…"
      : done === total
        ? "Updating the library…"
        : `Writing ${done.toLocaleString()} of ${total.toLocaleString()}…`;

  return (
    <div role="status">
      <TaskLine headline={headline} estimate={null} ratio={total === 0 ? 0 : done / total} />
    </div>
  );
}
