import { useEffect } from "react";
import { Icon } from "../../components/icons/Icon";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { useTagsourceStore } from "./store";

/** The sidebar's icon box, which `.sidebar-icon` sizes to match. */
const ICON_SIZE = 15;

/**
 * The releases the unattended pass would not write, as a row in the source
 * list.
 *
 * Under the playlists because it is the same kind of thing: somewhere to go,
 * with a count beside it. Clicking it opens the lookup dialog on the queue -
 * a release at a time, Skip moving to the next - which is the flow that dialog
 * was already built around.
 *
 * Present only when there is something in it. A row that says nought for the
 * months before the pass has queued anything is a permanent reminder of a
 * feature that has nothing to say.
 *
 * **A queue emptied by setting everything aside is the row's other state.**
 * Setting a release aside has to have a way back or it is a trap, and the way
 * back cannot be a menu on a row that has hidden itself - nor one on a
 * disabled button, which is an element a browser sends no events to at all. So
 * the row says what there is to do: `Needs Review` while there is a queue,
 * `Set Aside` when the only thing left to do with these releases is put them
 * back.
 *
 * It subscribes on its own behalf rather than being handed a count. A pass
 * runs for the better part of two days and moves this number every twenty
 * seconds; read from `App` that would re-render the window each time.
 */
export function ReviewQueue() {
  const review = useTagsourceStore((s) => s.review);
  const aside = useTagsourceStore((s) => s.aside);
  const loadCounts = useTagsourceStore((s) => s.loadCounts);
  const watchCounts = useTagsourceStore((s) => s.watchCounts);
  const openReview = useTagsourceStore((s) => s.openReview);
  const restoreAside = useTagsourceStore((s) => s.restoreAside);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    // `watchCounts` resolves to its own teardown, which may land after unmount.
    let stop: (() => void) | undefined;
    let cancelled = false;
    void watchCounts().then((off) => {
      if (cancelled) {
        off();
      } else {
        stop = off;
      }
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [watchCounts]);

  if (review === 0 && aside === 0) {
    return null;
  }

  const queued = review > 0;
  const label = queued ? "Needs Review" : "Set Aside";

  return (
    <div className="sidebar-section">
      <ul>
        <ContextMenu
          label={`${label} actions`}
          // The way back while there is still a queue to work through. It is
          // the row's own click once the queue has emptied.
          items={[
            {
              label: `Bring Back ${aside} Set Aside`,
              disabled: aside === 0 || !queued,
              onSelect: () => void restoreAside(),
            },
          ]}
          render={<li className="sidebar-row" />}
        >
          <button
            type="button"
            className="sidebar-item"
            // Named for the destination rather than its size, like a playlist
            // row: the count moves every twenty seconds while a pass runs, and
            // an item whose announced name keeps changing is worse to use than
            // one that stays put. It stays visible.
            aria-label={label}
            title={queued ? undefined : "Put these back in the review queue"}
            onClick={() => void (queued ? openReview() : restoreAside())}
          >
            <Icon name="review" size={ICON_SIZE} className="sidebar-icon" />
            <span className="sidebar-label">{label}</span>
            <span className="sidebar-count">{queued ? review : aside}</span>
          </button>
        </ContextMenu>
      </ul>
    </div>
  );
}
