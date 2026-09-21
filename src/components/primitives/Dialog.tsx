import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useContext,
} from "react";
import { Button, type ButtonKind } from "./Button";

/**
 * Which of Base UI's two dialogs is underneath.
 *
 * Not a styling choice - the two draw identically - but a behavioural one:
 * an alert cannot be dismissed by clicking its backdrop, which is the whole
 * reason a question about something irreversible is an alert. The app has two
 * of them, the delete confirmation and the crash notice.
 */
export type DialogRole = "dialog" | "alert";

/**
 * So `DialogHeader` and `DialogClose` reach the same root the popup came from.
 *
 * Base UI's `Title` and `Close` are parts of a specific root and throw outside
 * it, and making every caller repeat `role` on three components is how two of
 * them end up disagreeing.
 */
const RoleContext = createContext<DialogRole>("dialog");

/** The parts of whichever root this dialog is. */
function partsFor(role: DialogRole) {
  return role === "alert" ? AlertDialog : BaseDialog;
}

/**
 * The dialog shell: a scrim, a bordered box over it, and three regions.
 *
 * The box carries the fill, the edge and the shadow and **no padding of its
 * own** - each region pads itself, because they do not agree about what the
 * edge is worth. A paned dialog is the reason: `Settings` is a rail against a
 * pane, and the hairline between them has to run the full height of the row,
 * which it cannot if the box has inset them both.
 *
 * `variant` is the one hook `app.css` has into the box, and the three that use
 * it - `confirm`, `settings`, `lookup` - all state a width or a height.
 * Nothing else about a dialog's chrome is a caller's to decide, and
 * `App.css.test.ts` asserts that no `.dialog*` rule in `app.css` states a
 * border, a padding or a shadow.
 */
export function Dialog({
  role = "dialog",
  paned = false,
  variant,
  initialFocus,
  onClose,
  onSubmit,
  render,
  children,
}: {
  role?: DialogRole;
  /**
   * One height whatever the contents, with `DialogBody` as the only scroller.
   *
   * The lookup passed through six heights - 154px reading the files, 695px
   * confirming eleven - and a centred box moves both its edges under whatever
   * the pointer is resting on every time. A paned dialog takes a height from
   * its variant instead and lets only the body give way.
   */
  paned?: boolean;
  variant?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /**
   * Renders the popup as a `<form>`.
   *
   * The two editors want Enter anywhere inside to save, and a real submit is
   * how that happens without a key handler having to know which elements to
   * keep its hands off.
   */
  onSubmit?: () => void;
  /**
   * What the popup is, when it has to be something other than a `<div>`.
   *
   * Settings is a `Tabs.Root`, because the rail and the open panel both have
   * to be direct children of the box for the grid to place them. Passing this
   * alongside `onSubmit` is a caller asking for two elements and getting the
   * form; a dialog that is both a tab set and a form has not come up.
   */
  render?: ReactElement;
  children: ReactNode;
}) {
  const Parts = partsFor(role);
  const className = ["dialog", paned ? "paned" : null, variant].filter(Boolean).join(" ");

  return (
    // Open from the moment it is rendered: the caller decides whether the
    // dialog is up, so there is no trigger and no state in here. Every route
    // out - Escape, Cancel, the backdrop where one is allowed - is `onClose`.
    <RoleContext.Provider value={role}>
      <Parts.Root
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <Parts.Portal>
          <Parts.Backdrop className="dialog-backdrop" />
          <Parts.Popup
            className={className}
            initialFocus={initialFocus}
            render={
              onSubmit === undefined ? (
                render
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit();
                  }}
                />
              )
            }
          >
            {children}
          </Parts.Popup>
        </Parts.Portal>
      </Parts.Root>
    </RoleContext.Provider>
  );
}

/**
 * The title, the 2px rule under it, and the caption that shares its baseline.
 *
 * `caption` is the paned form's second half - "243 releases to review" - and a
 * dialog that is not paned has nowhere to put one, so passing it there is a
 * mistake the types cannot catch and the story is what shows the difference.
 */
export function DialogHeader({ title, caption }: { title: ReactNode; caption?: ReactNode }) {
  const Parts = partsFor(useContext(RoleContext));

  return (
    <div className="dialog-header">
      {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's `title`, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
      <Parts.Title render={<h2 />}>{title}</Parts.Title>
      {caption === undefined ? null : <p className="dialog-caption">{caption}</p>}
    </div>
  );
}

/**
 * The sentence the dialog is announced by, under its title.
 *
 * Base UI's `Description` rather than a paragraph, because it is what wires
 * `aria-describedby`: a confirmation announced as its title alone asks "Delete
 * playlist?" without ever saying what that does.
 */
export function DialogDescription({ children }: { children: ReactNode }) {
  const Parts = partsFor(useContext(RoleContext));

  return <Parts.Description className="dialog-summary">{children}</Parts.Description>;
}

/**
 * Everything between the two rules.
 *
 * In a paned dialog this is the one scroll area in the box; a second
 * `overflow` anywhere inside it is the regression that puts the footer back on
 * the move, and `App.css.test.ts` looks for one.
 */
export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="dialog-body">{children}</div>;
}

/**
 * The 2px rule, then the actions bottom right with the primary last.
 *
 * `lead` is the left-hand slot, and it holds one of two things: the action
 * that leaves rather than completes ("Back to queue"), or the count the dialog
 * has to state. They never appear together - a dialog either has somewhere to
 * go back to or has something to tally - so it is one slot rather than two.
 */
export function DialogFooter({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="dialog-footer">
      {/* Always drawn, empty or not: the row is `space-between`, and without a
          first child the actions would swing to the left the moment a dialog
          has nothing to say. */}
      <div className="dialog-lead">{lead}</div>
      <div className="dialog-actions">{children}</div>
    </div>
  );
}

/** The muted line a dialog puts in `lead` when it has a count to state. */
export function DialogStatus({ children }: { children: ReactNode }) {
  return <p className="dialog-status">{children}</p>;
}

/**
 * The button that shuts the dialog, whichever root it belongs to.
 *
 * Base UI's `Close` rather than an `onClick` calling `onClose`: it is the part
 * that knows how to return focus to whatever opened the dialog, and a bare
 * handler leaves the focus wherever the popup unmounted from.
 */
export function DialogClose({
  kind = "secondary",
  disabled = false,
  ref,
  children,
}: {
  kind?: ButtonKind;
  disabled?: boolean;
  ref?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const Parts = partsFor(useContext(RoleContext));

  // The label goes on the rendered button rather than on the part: `Close`
  // hands its own children down, and a `Button` is typed as needing some.
  return (
    <Parts.Close
      render={
        <Button kind={kind} disabled={disabled} ref={ref}>
          {children}
        </Button>
      }
    />
  );
}
